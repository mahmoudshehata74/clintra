# Design: clinical corrections after a visit is completed

Status: design only. Nothing here is built; every statement below is a
plan, to be reviewed before a migration is written.

## 1. Goal

Once a visit is completed, its doctor (or the owner) can still correct the
visit form — complaint and diagnosis — but only with a written reason, and
the version it replaces is kept in an append-only, synced revisions table.
The patient's timeline marks the visit "تم التعديل" with its full history;
nothing financial changes, and a correction made offline queues and syncs
like any other change.

## 2. Today

`web/src/db/visitForm.ts`'s `saveVisitFormField` autosaves each field on
blur, whatever the visit's status: "a late edit after completion is
deliberately allowed". The edit is an ordinary audited, synced update of
`visit_form_data` (`visit_id`, `form_definition_id`, `data` jsonb, `rev`),
so the audit log holds the before and after, but nothing marks the visit as
changed, nothing asks why, and the server accepts any update its RLS allows
(`visit_form_data_scope`, through the visit's org, location and practitioner
scope).

## 3. How it works

### 3.1 Online and offline alike

The correction is two (or three) ordinary sync ops in one group, written in
one Dexie transaction by a new writer, `correctVisitForm(db, visitId,
values, reason)` in `web/src/db/visitCorrections.ts`:

1. *(only if the completed visit has no form row yet)* `visit_form_data`
   create with the general form's empty values (`{"complaint": "",
   "diagnosis": ""}`);
2. `visit_form_revisions` create: `previous_data` (the stored `data`),
   `new_data`, `reason` (trimmed), `revision_no` (the visit's last + 1),
   `replaced_rev` (the stored row's `rev`), `corrected_by` (the acting
   membership), `corrected_at`, `device_id`;
3. `visit_form_data` update to `new_data`, `base_rev` = `replaced_rev`.

All three share one `group_id`, so the server applies them whole or not at
all (`SyncPushController::applyGroup`, `api/docs/rls.md` "A group applies
whole or not at all"). Online, they go up on the next sync cycle; offline,
they wait in `sync_ops` like any other write, behind any earlier op on the
same row (same-entity order), and go up when the device reconnects. The
device shows the corrected text at once, with "تم التعديل", in both cases.

The writer refuses, before writing anything (and the workspace shows the
line under the form):

| Refusal | Line |
|---|---|
| `not_completed` | (none: the ordinary autosave applies before completion) |
| `not_allowed` | "تعديل الزيارة بعد ما تتقفل لدكتور الزيارة أو صاحب العيادة بس" |
| `reason_required` | "اكتب سبب التعديل (3 حروف على الأقل)" |
| `reason_too_long` | "السبب طويل، خليه 500 حرف أو أقل" |
| `unchanged` | "مفيش تغيير عن النسخة الحالية" |

`saveVisitFormField` refuses (`visit_completed`) once the visit is
completed, so the autosave stops at completion: from then the form is read
only, with "تعديل" for those allowed.

### 3.2 On the server

`SyncOpApplier` gains `applyCorrectionRule`, run with the other rules
before any write:

- `visit_form_revisions`: create only. An update or delete is `rejected` /
  `revision_immutable`. A create must sit in a group whose next op is the
  `visit_form_data` update of the same row, with `base_rev` =
  `replaced_rev` and `data` = `new_data`, and whose only other op is the
  optional empty create; anything else in the group — an invoice, a
  payment, a visit status, any other entity — is `rejected` /
  `correction_invalid`, so a correction can never carry a financial change.
  If the stored row's `rev` is no longer `replaced_rev`, the create is
  `rejected` / `conflict_stale_rev` (section 3.4).
- `visit_form_data` on a completed visit: an update that changes `data`
  without that revision before it in the group is `rejected` /
  `correction_required`; a delete is `correction_required`; a create whose
  values are not all empty is `correction_required`.
- `corrected_by` joins `SyncableTables::ACTOR_COLUMNS`: today held to the
  organization (`actor_not_in_org`), and the visit's practitioner's
  membership or an owner, else `rejected` / `correction_not_allowed`. With
  the identity design it must also be the proven person
  (`actor_mismatch`), and the insert policy pins it (6.4).
- `device_id` is the token's device, whatever the payload says (as for
  device audit rows).

Two triggers hold the same rules in the database for every role (6.3), so a
writer that skips the applier cannot change a completed visit's form or
fake a revision. Their `55000` messages map to the reasons above; the
applier's closed-day mapping (`conflict_day_closed`) keeps matching only its
own message.

### 3.3 The timeline and the history

The patient profile's timeline (`PatientProfile.tsx`, `.pt-event.visit`)
shows a chip "تم التعديل" on a visit with at least one revision; tapping it
opens "سجل التعديلات": newest first, each revision with its date and time,
"عدّلها {name}", "السبب: {reason}", and for each field that changed
("الشكوى", "التشخيص") the text "قبل" and "بعد". The visit workspace shows
the same chip next to the form and "سجل التعديلات ({n})". As today, an
assistant or manager sees no complaint or diagnosis — and so neither the
chip nor the history (open question 5).

### 3.4 Two devices correcting the same visit

Both write their correction offline against the same stored `rev`. The
first group to reach the server is accepted; it raises the row's `rev`. The
second group's revision names the old `rev` as `replaced_rev`: the applier
refuses it `conflict_stale_rev`, the group is refused whole (no revision,
no update, no ledger or audit row stays), and every entity it named is
`blocked` for the rest of that push. The second device then pulls the
first correction, shows it, and lists its own in the sync review with its
lost text and "افتح الزيارة": "حد عدّل نموذج الزيارة ده قبلك من جهاز تاني،
فتعديلك ماتحفظش. افتح الزيارة وشوف آخر نسخة، ولو لسه محتاج تعدّل اعمل
«تعديل» تاني." Nothing is merged automatically: clinical text is not merged
by a machine. The unique `(visit_form_data_id, revision_no)` is a second
guard if two inserts ever raced past the `rev` check.

The same review applies when another device *completes* the visit while this
one, offline, still autosaves: the late update arrives without a revision,
is refused `correction_required`, and reads "الزيارة دي اتقفلت قبل ما
التعديل ده يوصل، والتعديل بعد القفل محتاج سبب. افتح الزيارة واعمل «تعديل»."
with its text kept.

## 4. What does not change

- No invoice, invoice item, payment, cash close, visit status, prescription
  or care plan is read for a change or written by a correction; a group
  carrying any of them is refused (3.2).
- A printed prescription stays locked (`prescription_printed`); its
  diagnosis snapshot is what was printed. A correction does not reprint it.
- Edits before completion autosave exactly as today, with no reason and no
  revision.
- Existing `visit_form_data` rows and audit rows are not rewritten.

## 5. Threat model

| Attacker | Can | Cannot |
|---|---|---|
| **Stolen device** | Whatever the device's signed-in people can, as the identity design describes: with code access, write a correction in the name of a doctor who has a credential there, until the device is revoked. | Erase or rewrite history: revisions are append-only on the server (no UPDATE or DELETE grant or policy) and the previous text is kept in the revision itself. Hide a correction: the timeline shows every one. |
| **Stolen token** | Today (before the identity design): push a correction naming any doctor of the organization as `corrected_by`, since the actor is a claim. | After the identity design: anything — every op needs the person's proof. At any time: correct a visit outside the token's RLS scope, or change anything financial through a correction. |
| **Malicious staff member** | A doctor: correct their own completed visits, with a reason, visibly, under their own name. The owner: correct any. | An assistant, a manager or another doctor: correct a visit (applier and trigger refuse). Anyone: change a completed visit's form without a revision (trigger), delete or edit a revision, backfill a fake "previous" text (the trigger compares `previous_data` with the stored row). |
| **Compromised admin account** | Nothing: the platform admin's roles hold no privilege on `visit_form_data` or `visit_form_revisions` (`docs/design-platform-admin.md`). A support device: read revisions only if the owner allowed clinical text. | Write a correction: a support device is read-only. |

## 6. Planned statements

One migration for the table and its policies, one for the triggers; each
with a `down()`.

### 6.1 Table

```sql
CREATE TABLE visit_form_revisions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
  visit_form_data_id uuid NOT NULL REFERENCES visit_form_data(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no >= 1),
  replaced_rev integer NOT NULL CHECK (replaced_rev >= 1),
  previous_data jsonb NOT NULL,
  new_data jsonb NOT NULL,
  reason varchar(500) NOT NULL CHECK (char_length(btrim(reason)) >= 3 AND reason = btrim(reason)),
  corrected_by uuid NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
  corrected_at timestamptz NOT NULL,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
  rev integer NOT NULL DEFAULT 1,
  CONSTRAINT visit_form_revisions_number_unique UNIQUE (visit_form_data_id, revision_no),
  CHECK (new_data IS DISTINCT FROM previous_data)
);
CREATE INDEX visit_form_revisions_visit ON visit_form_revisions (visit_id);
CREATE TRIGGER visit_form_revisions_enforce_rev BEFORE INSERT OR UPDATE ON visit_form_revisions
  FOR EACH ROW EXECUTE FUNCTION enforce_row_rev();
```

`rev` exists because every syncable table's pull carries one; a revision is
never updated, so it stays 1.

### 6.2 RLS and grants (append-only, as `device_audit_log`)

```sql
ALTER TABLE visit_form_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_form_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON visit_form_revisions FROM PUBLIC;
GRANT SELECT, INSERT ON visit_form_revisions TO clintra_app;

CREATE POLICY visit_form_revisions_select ON visit_form_revisions FOR SELECT
  USING (org_id = current_org()
         AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                          AND location_id IN (SELECT * FROM allowed_locations())
                          AND practitioner_id IN (SELECT * FROM allowed_practitioners())));

CREATE POLICY visit_form_revisions_insert ON visit_form_revisions FOR INSERT
  WITH CHECK (org_id = current_org()
              AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                               AND location_id IN (SELECT * FROM allowed_locations())
                               AND practitioner_id IN (SELECT * FROM allowed_practitioners()))
              AND corrected_by IN (SELECT id FROM memberships WHERE org_id = current_org())
              AND device_id IN (SELECT id FROM device WHERE org_id = current_org()));
```

No UPDATE or DELETE policy, and no UPDATE or DELETE grant: a refused
statement fails with `42501` on the grant. As for `device_audit_log`, no
trigger refuses deletes for every role, because `clintra_fixtures`
(test-only) is what the Pest cleanup and the live run's organization removal
delete through. Each `IN` sits inside an `AND` with `org_id =
current_org()`, so nothing is reachable without a membership.

When the identity design lands, the insert policy pins the corrector to the
proven person:

```sql
ALTER POLICY visit_form_revisions_insert ON visit_form_revisions
  WITH CHECK (org_id = current_org()
              AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                               AND location_id IN (SELECT * FROM allowed_locations())
                               AND practitioner_id IN (SELECT * FROM allowed_practitioners()))
              AND corrected_by = current_membership()
              AND device_id IN (SELECT id FROM device WHERE org_id = current_org()));
```

### 6.3 Triggers

```sql
-- A revision must describe the stored row exactly, on a completed visit, by its doctor or an owner.
CREATE FUNCTION visit_form_revision_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_form_id uuid;
  v_form_visit uuid;
  v_form_data jsonb;
  v_form_rev integer;
  v_visit record;
  v_actor record;
BEGIN
  SELECT id, visit_id, data, rev INTO v_form_id, v_form_visit, v_form_data, v_form_rev
    FROM visit_form_data WHERE id = NEW.visit_form_data_id FOR UPDATE;
  SELECT id, org_id, status, practitioner_id INTO v_visit FROM visits WHERE id = v_form_visit;
  IF v_form_id IS NULL OR v_visit.id IS NULL OR v_visit.id <> NEW.visit_id OR v_visit.org_id <> NEW.org_id
     OR v_visit.status <> 'completed'
     OR v_form_rev <> NEW.replaced_rev
     OR v_form_data IS DISTINCT FROM NEW.previous_data
     OR NEW.revision_no <> coalesce((SELECT max(revision_no) FROM visit_form_revisions
                                     WHERE visit_form_data_id = NEW.visit_form_data_id), 0) + 1 THEN
    RAISE EXCEPTION 'correction_invalid' USING ERRCODE = '55000';
  END IF;
  SELECT id, org_id, role, practitioner_id INTO v_actor FROM memberships WHERE id = NEW.corrected_by AND is_active;
  IF v_actor.id IS NULL OR v_actor.org_id <> NEW.org_id
     OR NOT (v_actor.role = 'owner' OR v_actor.practitioner_id IS NOT DISTINCT FROM v_visit.practitioner_id) THEN
    RAISE EXCEPTION 'correction_not_allowed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visit_form_revisions_check BEFORE INSERT ON visit_form_revisions
  FOR EACH ROW EXECUTE FUNCTION visit_form_revision_check();

-- A completed visit's form changes only through a revision written just before, for exactly this change.
CREATE FUNCTION visit_form_data_completed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND status = 'completed') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM jsonb_each_text(NEW.data) AS e WHERE e.value <> '') THEN
      RAISE EXCEPTION 'correction_required' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.data IS NOT DISTINCT FROM OLD.data THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM visit_form_revisions r
                 WHERE r.visit_form_data_id = OLD.id AND r.replaced_rev = OLD.rev AND r.new_data = NEW.data) THEN
    RAISE EXCEPTION 'correction_required' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visit_form_data_completed_guard BEFORE INSERT OR UPDATE ON visit_form_data
  FOR EACH ROW EXECUTE FUNCTION visit_form_data_completed_guard();
```

Both run as the invoker, so their reads go through the caller's own RLS:
a writer who cannot see the visit cannot pass them. The guard fires before
`visit_form_data_enforce_rev` (trigger names fire in alphabetical order),
so `OLD.rev` is the row's real rev. A delete of a completed visit's form is
refused by the applier (`correction_required`); no trigger blocks deletes,
for the fixtures reason above.

## 7. Sync impact

- **New syncable table.** `visit_form_revisions` joins
  `SyncableTables::NAMES` and `DIRECT_ORG_ID_TABLES` (it carries `org_id`),
  `corrected_by` joins `ACTOR_COLUMNS`, and the web's
  `sync/syncableTables.ts`. Pull carries it like any row (jsonb columns
  `previous_data`, `new_data` decoded in `SyncPayload::JSON_COLUMNS`). The
  bootstrap gains a stage after schedule exceptions, windowed by the visit's
  date (`visit_id IN (SELECT id FROM visits WHERE visit_date BETWEEN …)`),
  appended so an existing cursor keeps its meaning. The device audit push
  accepts the entity (it is in `NAMES`).
- **Rejection reasons and review lines** (`reviewSummary.ts`; the entity
  label "تعديل نموذج زيارة"):

  | Reason | Arabic review line |
  |---|---|
  | `correction_required` | الزيارة دي اتقفلت قبل ما التعديل ده يوصل، والتعديل بعد القفل محتاج سبب. افتح الزيارة واعمل «تعديل» |
  | `correction_not_allowed` | تعديل الزيارة بعد ما تتقفل لدكتور الزيارة أو صاحب العيادة بس |
  | `correction_invalid` | التعديل ده مش مطابق لآخر نسخة من نموذج الزيارة، أو معاه تغييرات تانية، فماتحفظش |
  | `revision_immutable` | سجل التعديلات مينفعش يتغيّر أو يتمسح |
  | `conflict_stale_rev` on a correction group | حد عدّل نموذج الزيارة ده قبلك من جهاز تاني، فتعديلك ماتحفظش. افتح الزيارة وشوف آخر نسخة، ولو لسه محتاج تعدّل اعمل «تعديل» تاني |

  A refused correction group is one review row (as refused queue groups
  are today, `sync/syncGroups.ts`), keeping the lost text and offering
  "افتح الزيارة".
- **Ordering.** Fixed inside the group: [empty create], revision, update —
  the revision must exist when the update's trigger looks for it, and the
  revision's own trigger must see the row before the update. The device
  writes them in that order in one transaction; `sync_ops.created_at` is
  strictly increasing per tab, so they push in write order. Same-entity
  blocking holds: a refused correction blocks later ops on that form row in
  the push.
- **The seq lock.** Unchanged: the push holds the organization's lock for
  the whole request, so the group's ledger rows take consecutive `seq`
  values in commit order and a pull sees all of them or none. Pulled pages
  apply in one Dexie transaction, so a device never shows a revision without
  the corrected row, or the reverse.

## 8. Migration of existing devices and data

1. **Web first.** A release that knows the table (new Dexie store
   `visit_form_revisions: "id, visit_id, visit_form_data_id"`, the next
   version — 28 if this lands before the identity design), the correction
   writer, the timeline chip and history, the review lines, and that stops
   autosaving after completion. An older device that pulls a revision before
   updating stores nothing it does not know (unknown entities are skipped by
   the pull applier — to confirm in the implementation; if not, this step
   is what makes the order mandatory).
2. **Server second.** The table, policies and applier rules can ship with
   step 1; the `visit_form_data_completed_guard` trigger ships in a second
   deploy once every device runs step 1 (the PWA updates itself on next
   load; the owner's settings can show "{n} أجهزة لسه على نسخة قديمة" from
   `device` rows' last-seen version). Until then a device on the old
   version can still save a late edit, as today.
3. **Existing data.** Nothing is backfilled. Late edits made before this
   change are in the audit log as ordinary updates and are not turned into
   revisions: a revision always carries a reason, and they have none.
4. **Existing tests.** Any e2e or vitest case that edits a completed
   visit's form by autosave changes with the behaviour: it is rewritten to
   correct with a reason, and a new case asserts the autosave is refused.
   That is the decision this design asks for, not a weakened test.

## 9. UI screens touched

- **Visit workspace** (screen 10, and the doctor's current visit): after
  completion, "الشكوى" and "التشخيص" read only, with "تعديل" (doctor of the
  visit, owner) opening "تعديل نموذج الزيارة": both fields, "سبب التعديل"
  (required), "حفظ التعديل", "إلغاء"; the refusal lines of 3.1; the chip
  "تم التعديل" and "سجل التعديلات ({n})".
- **History sheet** "سجل التعديلات": per revision the date and time,
  "عدّلها {name}", "السبب: …", "قبل" / "بعد" for "الشكوى" and "التشخيص".
- **Patient profile timeline** (screen 18): the chip on a corrected visit;
  tapping it opens the history.
- **Audit log**: a revision reads "عدّل نموذج زيارة مكتملة" (`auditVerb.ts`),
  scoped by its visit (`isAuditRowInScope` treats a row with no location or
  practitioner field as organization-wide, so the revision needs the same
  join-based scope check the visit form has).
- **Sync review**: the five lines of section 7.

## 10. Tests planned

- **Pest.** Shape: every column, check, the unique constraint, the index,
  both RLS flags, both policies' deparsed text, the grants (`clintra_app`
  exactly SELECT and INSERT; no UPDATE or DELETE), both triggers attached.
  Triggers, through `clintra_app` with a membership set: a revision with the
  right `previous_data` and `replaced_rev` on a completed visit, by its
  doctor and by the owner, accepted; a wrong `previous_data`, a stale
  `replaced_rev`, a skipped `revision_no`, a visit not completed, another
  doctor, an assistant — each refused with its message; a completed visit's
  form updated without a revision refused, with the revision accepted; an
  empty create on a completed visit accepted and a non-empty one refused;
  `UPDATE` and `DELETE` on revisions refused `42501`. Push: the two- and
  three-op groups accepted and pulled; a group carrying an invoice or a
  payment refused whole, nothing written; a revision update or delete
  `revision_immutable`; two devices' corrections of one row, the second
  refused `conflict_stale_rev` with no revision left; a late autosave on a
  completed visit `correction_required`; bootstrap carries revisions in its
  window. Cross-org: organization B can neither insert a revision for A's
  visit nor read one, by push or directly; a member listed for another
  location reads none. Nothing financial: invoice, invoice item, payment and
  cash close counts and revs unchanged across every correction test.
- **vitest.** `correctVisitForm`: the ops, their order and `group_id`, the
  revision's fields, each refusal; `saveVisitFormField` refusing after
  completion; the history model (fields changed, newest first); the timeline
  chip model; the review lines and the refused group's single row; the Dexie
  upgrade.
- **e2e (desktop and mobile).** The doctor completes a visit, the form turns
  read only, "تعديل" with no reason is refused, with a reason saves, the
  chip and history show "قبل" / "بعد"; an assistant sees neither the button
  nor the chip; the owner corrects another doctor's visit; a correction made
  while `FakeTransport` is offline shows at once and syncs on return.
- **test:live.** A corrects a completed visit; B shows the chip and the
  history with A's reason. Both offline correct the same visit; A reconnects
  first; B is asked to review once with its text kept, and shows A's
  version.

## 11. Size

**L — about 10-14 working days.** Two migrations; the applier rule and the
trigger-message mapping; a bootstrap stage; the web writer, workspace
changes, history sheet, timeline chip, review lines and Dexie version;
tests as above, including rewriting the existing late-edit cases.

## 12. Open questions

1. **A grace window after completion with no reason?** Recommended: none.
   Completion is a deliberate step; a window would bring back silent edits
   with a clock the server cannot trust.
2. **Reason length?** Recommended: required, 3 to 500 characters, trimmed.
3. **Who may correct?** Recommended: the visit's own doctor and the owner;
   not another doctor, an assistant or a manager.
4. **What does a correction cover?** Recommended: the visit form only
   (complaint, diagnosis). The doctor's note (`visits.note`) and unprinted
   prescriptions keep today's rules; a printed prescription stays locked.
5. **Who sees "تم التعديل" and the history?** Recommended: whoever sees the
   clinical text today (the doctor and the owner; with the identity design,
   holders of `clinical.view`), not assistants or managers.
6. **Corrections on an archived patient's visit?** Recommended: allowed,
   like opening their profile.
7. **Rollout order?** Recommended: the web release first, the
   `visit_form_data_completed_guard` trigger in a second deploy once every
   device has updated (section 8).
8. **Ship before the identity design?** Recommended: yes, with
   `corrected_by` held to the visit's doctor or an owner of the organization
   (a claim, the known gap); tighten the insert policy to
   `current_membership()` when the identity design lands (6.2).
9. **A limit on the number of corrections?** Recommended: none; each is
   kept and shown.
10. **Concurrent corrections?** Recommended: the first to reach the server
    wins; the other is refused whole, shown in the review with its text, and
    never merged automatically.
