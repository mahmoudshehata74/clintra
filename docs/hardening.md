# Phase 10 — hardening: acceptance criteria measurement

This document measures v1 against every acceptance criterion in the
specification's section 11 (معايير القبول), one section per criterion, and
records the result. **This is a measurement pass, not a fix pass** — a
failing or unmeasurable criterion is recorded here, not corrected in this
task.

## Summary

Of 9 criteria: **6 pass** by automated measurement, **1 fails** by automated
measurement (app-open latency, environment-sensitive — see below), and **2
cannot be fully automated** (the 8-hour offline drill and the 30-scenario
simulated day), for which this document specifies the exact manual drill
instead. No correctness bug was found in the application while writing the
measurement specs — two apparent failures during authoring both turned out
to be flawed test assumptions, not application defects: an offline/sync test
that assumed a booking always inserts a new row (see section 8 — the
booking flow correctly reuses a freed cancelled/no-show visit's row instead)
caught locally, and a search test with an ambiguous locator (the exact
search query also appeared, as a substring, in the unrelated "+ new
patient" prompt row) that only surfaced on CI, since the race between the
two matching elements happened to resolve the same way on every local run.
Both were fixed before this document's numbers were finalized.

| # | Criterion | Method | Result | Verdict |
|---|---|---|---|---|
| 1 | Existing patient booking: 3 taps, ≤3s | Auto | 3 taps, ~0.4–0.7s | ✅ Pass |
| 2 | New patient booking: ≤6s | Auto | ~0.5–0.7s | ✅ Pass |
| 3 | App opens on today: ≤1s | Auto | 0.75s–2.3s (host-dependent) | ❌ Fail (see caveat) |
| 4 | Search by name, 5000 patients: <0.5s | Auto | ~0.16–0.43s | ✅ Pass |
| 5 | Marking arrival: 1 tap | Auto (regression) | 1 tap | ✅ Pass |
| 6 | Moving to tomorrow: ≤3 taps | Auto | 3 taps | ✅ Pass |
| 7 | Offline: 8 hours, zero data loss | Manual drill (documented below) | Not yet run | ⏳ Pending manual run |
| 8 | Sync after disconnect: no duplication, no loss | Auto | Converges correctly | ✅ Pass (with architecture caveat) |
| 9 | Simulated clinic day: 30 scenarios, zero errors | Manual drill (checklist below) | Not yet run | ⏳ Pending manual run |

All automated criteria live in `web/e2e/hardening.spec.ts`, kept separate
from the interaction-correctness specs so a slow or loaded CI run degrades a
number here rather than corrupting an unrelated test's timeout budget. It
runs once, on the `desktop` Playwright project only (see
`playwright.config.ts`'s `testIgnore` on `mobile`) — timing numbers measured
twice on the same engine at a different viewport would not be a second data
point, only doubled CPU contention.

---

## 1. Existing patient booking: 3 taps, 3 seconds or fewer

**Measurement**: automated, `web/e2e/hardening.spec.ts` → `"existing patient
booking: 3 taps, under 3 seconds"`. Reuses the exact 3-tap flow already
proven in `web/e2e/booking-sheet.spec.ts` (tap an empty slot → tap the
patient result → tap confirm) and additionally times the whole sequence
with a wall clock.

**Result**: 3 taps, measured wall-clock time **~435–621ms** across several
runs — roughly 5–7× under budget.

**Verdict**: ✅ Pass.

**بالعربي**: حجز مريض قديم بيتم بثلاث لمسات بالظبط، وبيستغرق أقل من نصف ثانية
في المتوسط — بعيد جدًا عن حد الثلاث ثوانٍ المطلوب في المواصفة.

---

## 2. New patient booking: 6 seconds or fewer

**Measurement**: automated, same file, `"new patient booking completes in
under 6 seconds"`. Flow: tap an empty slot → type a new name → tap "+ مريض
جديد" → tap "إضافة" (submit, phone left empty — the specification's
"name is the only required field" rule) → tap "احجز" (confirm). 4 taps
total, though the specification only sets a time budget for this one, not a
tap count.

**Result**: **~508–686ms** — about 9–12× under the 6-second budget.

**Verdict**: ✅ Pass.

**بالعربي**: حجز مريض جديد (باسم بس، من غير رقم) بياخد أقل من ثانية، بعيد جدًا
عن حد الست ثواني.

---

## 3. Opening the app on today: 1 second or fewer

**Measurement**: automated, same file, `"opening the app renders today's
view within 1 second on a cold cache"`. `App.tsx` mounts `DayScreen`
unconditionally — `LockScreen` is a sibling overlay on top of it, never a
gate in front of it — so the practitioner switcher becomes visible purely
once the seed and static-data load finish, independent of whether a PIN
session exists. The test navigates fresh (Playwright gives every test its
own browser context, i.e. a genuinely cache-cold profile) and times from
navigation start to that switcher becoming visible.

**Result**: this is the one criterion that did **not** measure cleanly.
Across repeated runs on the machine this suite was authored on:
- In true isolation (this test alone, one worker, nothing else competing
  for the CPU): a stable **~750–800ms** — comfortably under budget.
- Run alongside the rest of the suite, or repeated back-to-back: **1.1s to
  2.3s** — over budget, sometimes by more than 2×.

That swing is far wider than ordinary Playwright worker parallelism would
explain on its own. The honest reading is that this number is **sensitive
to host CPU load** in a way the actual booking/search/move criteria above
are not (those have 5–12× headroom; this one has none). Because of that
sensitivity, `hardening.spec.ts`'s automated check for this one criterion
only asserts a loose 5-second regression guard (catching a genuine 5×
regression) — the strict 1-second number is judged here, by a human reading
real measurements, not by an assertion that would otherwise flip between
green and red based on host noise unrelated to the app.

**Verdict**: ❌ **Fails as currently measured** on this development machine.
Whether it fails on the actual target hardware (a tablet, running the built
PWA, not a shared dev sandbox) is unknown and is exactly the gap a
stopwatch-on-real-hardware measurement (per the specification's own
"measured with a stopwatch, not a feeling" principle) would close. See the
failing-criteria section at the end for what would need to happen next.

**بالعربي**: فتح التطبيق على شاشة اليوم بياخد من ٠.٧٥ لـ ٢.٣ ثانية حسب حمل
الجهاز وقت القياس — الرقم مش مستقر، وده نفسه المشكلة: المعيار محتاج يتقاس على
تابلت حقيقي بساعة توقيت زي ما المواصفة بتقول، مش على جهاز تطوير مشغول بحاجات
تانية في نفس الوقت.

---

## 4. Search by name: under 0.5 second with 5000 patients

**Measurement**: automated, same file, `"search by name returns a result
under 0.5 second with 5000 patients"`. `searchPatients()`
(`web/src/db/patientSearch.ts`) does a full `db.patients.toArray()` scan on
every query — there is no name index used for substring search — so this is
a genuine worst-case: the test seeds 4,994 filler patients plus one
distinctively-named target directly through IndexedDB (bypassing the app's
own create flow, which would make fixture setup itself the slow part),
bringing the total to exactly 5,000, then types the target's full name into
the booking sheet's search field and times from that keystroke to the
result row appearing — which includes the UI's own 120ms input debounce
(`SEARCH_DEBOUNCE_MS` in `BookingSheet.tsx`), not just the raw query
function. Nothing is cleaned up afterward: the browser context (and its
IndexedDB) is torn down by Playwright the moment the test ends, the same as
every other spec's isolation.

**Result**: **~160–430ms** across runs (higher under parallel-worker CPU
contention, same as the app-open number in section 3, but always comfortably
inside budget here), including the 120ms debounce — at least 15% headroom
even in the slowest observed run, in this worst case (a match effectively at
the end of an unindexed linear scan).

**Verdict**: ✅ Pass. Comfortable now, but worth flagging: this scales
linearly with patient count and is not indexed. It is not a problem at 5,000
patients; whether it stays comfortable at 20,000+ (a plausible multi-year
count for a busy general clinic) has not been measured and would be worth
another data point before assuming it stays fine forever.

**بالعربي**: البحث بالاسم وسط ٥٠٠٠ مريض بياخد أقل من ربع ثانية، حتى في أسوأ
حالة (المريض المطلوب آخر واحد في القايمة) — بعيد عن حد نص الثانية، لكن الطريقة
بتفحص كل المرضى في كل مرة من غير فهرس، فلو العدد كبر أوي (عشرين ألف مريض مثلاً)
محتاج يتقاس تاني.

---

## 5. Marking arrival: one tap

**Measurement**: automated regression, same file, `"marking arrival is
exactly one tap"`. Already exercised at the interaction-correctness level
in `web/e2e/day-slots.spec.ts`; this is a deliberately minimal, standalone
lock in the hardening file itself, so the acceptance-criteria suite does not
depend on an unrelated correctness spec to prove this one number. A single
`.click()` on the booked row advances it straight to arrived.

**Result**: 1 tap, by construction (the test contains exactly one `.click()`
between the "booked" and "arrived" assertions).

**Verdict**: ✅ Pass.

**بالعربي**: تسجيل وصول المريض بيتم بدوسة واحدة بس، زي ما المواصفة طالبة.

---

## 6. Moving an appointment to tomorrow: 3 taps or fewer

**Measurement**: automated, same file, `"moving an appointment to tomorrow
takes 3 taps or fewer"`. Flow: tap the row's ellipsis (⋯) → tap "نقل لميعاد
تاني" → tap a slot in tomorrow's group in the move sheet (`moveVisit()`
runs immediately on that tap, no separate confirm step). `MoveVisitSheet`
renders one group per day from today through today+7, in order, skipping
any day with zero empty slots (`moveTargets.ts`); the seeded day always has
some remaining slots (so it renders at index 0) and tomorrow has no
bookings on it at all (so it always has slots and always renders right
after, at index 1) — the test picks that group specifically rather than
assuming a fixed slot count.

**Result**: 3 taps, by construction.

**Verdict**: ✅ Pass.

**بالعربي**: نقل ميعاد لبكرة بياخد ثلاث لمسات بالظبط: القائمة، اختيار "نقل"،
ثم اختيار الميعاد الجديد — تحت الحد المسموح.

---

## 7. Offline operation: 8 hours, zero data loss

**Measurement**: **cannot be fully automated** — this app's write path
(`db/mutate.ts`) is IndexedDB-only and never awaits a network call, so there
is nothing an automated test can meaningfully "fail" here beyond what
section 8 already exercises over a much shorter window. An 8-hour clock is
also impractical to hold open in CI. What automation *can't* substitute for
is real device behavior over real elapsed time: OS-level power management,
browser tab eviction/suspension, IndexedDB storage-quota pressure, and a
human actually forgetting to reopen the tab — none of which a Playwright
run reproduces.

**Manual drill** (run this on the actual deployed URL, on the target
tablet, not a desktop browser):

1. Open the app, log in, confirm today's grid is visible and populated.
2. Turn off Wi-Fi at the OS level (not devtools) — a genuine radio-off
   disconnect, matching how a clinic's real internet drop would look.
3. Confirm the header's connectivity chip flips to "شغّال محلي" (local-only)
   within a few seconds.
4. Over a **real 8-hour window** (a full clinic shift, ideally — do not
   compress this into a rapid burst; part of what this measures is
   long-elapsed-time survivability, not just "can it write once offline"),
   perform a realistic day's mix of operations: several bookings (existing
   and new patients), the one-tap status advances (arrived → in_room →
   completed) for each, at least one cancel and one no-show, a walk-in, an
   invoice with a partial payment, and a cash close at the end. Leave the
   tablet's screen locked/unlocked at points during the window the way
   staff actually would, rather than keeping the tab continuously
   foregrounded.
5. At the end of the 8 hours, confirm every operation performed is still
   visible exactly once, with correct data (patient names, amounts, status
   history) — check the audit log (سجل التدقيق) as the authoritative
   timeline, not just the day grid.
6. Turn Wi-Fi back on. Confirm the chip flips to "متصل" (online).
7. Record: did anything need a page reload to appear correct? Did the tab
   ever visibly freeze, crash, or reload itself unprompted during the 8
   hours? Was any operation from step 4 missing or duplicated at step 5?

**Result**: not yet run — this is a real-device, real-time drill outside
what an agent session can execute. Recording it here so it can actually be
run and its result filled in.

**Verdict**: ⏳ Pending manual run.

**بالعربي**: الشغل من غير نت لمدة ٨ ساعات لازم يتجرب فعليًا على تابلت حقيقي
بقطع شبكة الواي فاي فعلاً، مش في بيئة اختبار آلي — الخطوات مكتوبة فوق بالتفصيل
عشان يتم تنفيذها وتسجيل النتيجة.

---

## 8. Sync after disconnect: no duplication, no loss

**Measurement**: automated, `web/e2e/hardening.spec.ts` → `"offline work is
never lost locally, and a resend after reconnecting does not duplicate the
record"`, using the real sync engine (`sync/engine.ts`) and its fake
"server" (`sync/fakeTransport.ts`, a second real IndexedDB database,
`clintra-fake-server` — not a mock) rather than hand-constructed unit
fixtures, so this exercises the full UI-to-transport pipeline end to end.

**Important architecture caveat**: `context.setOffline()` (Playwright's
network-condition emulation) genuinely flips the app's own connectivity
indicator, because that reads `navigator.onLine` — but it does **not**
block `FakeTransport`, because `FakeTransport` is a second in-browser
IndexedDB database, not a network call. Nothing in `sync/engine.ts` gates
on online status either — it pushes on a timer, on tab-visibility, and
immediately after every local write, unconditionally. This is correct and
expected for the current pre-Laravel architecture (there is no real network
dependency yet to interrupt), but it means this test cannot hold a real
network partition open the way it will once `HttpTransport` exists. **Once
`HttpTransport` ships, this test should be redone with an intercepted
network route (`page.route()`) that actually rejects requests during the
"offline" window**, which `setOffline` cannot exercise against a fake
in-memory transport.

Given that, what this test actually proves, and how:

1. **No local data loss while offline**: with the connectivity chip showing
   "local-only," book a patient into a slot. The write must land locally
   regardless of connectivity, since `mutate()` never awaits a network
   round-trip. Verified by reading the `visits` object store directly via a
   raw IndexedDB connection before and after, and confirming a row changed.
   (This surfaced a genuine subtlety worth noting: `bookExistingPatientVisit`
   reuses an existing cancelled/no-show visit's own row — same `id` — when
   the tapped slot is one it previously occupied, rather than always
   inserting a fresh row, so a naive "count went up by exactly one" check is
   the wrong assertion; the test diffs each row's full content instead. This
   was caught and fixed during authoring — see the summary above.)
2. **Convergence once reachable**: after flipping back online, poll until
   the local `sync_ops` row for that visit shows a `synced_at` timestamp,
   then confirm the fake server's `visits` table has that exact row, exactly
   once.
3. **No duplication on a forced resend**: reset that same `sync_ops` row's
   `synced_at` back to `null` directly (simulating "the device does not
   know whether its earlier push actually reached the server," which is
   precisely the scenario `op_id` deduplication exists for — see
   `docs/schema.md`'s sync rules), then trigger another sync cycle. Confirm
   the fake server's `visits` table still has exactly one row for that
   visit afterward, not two.

This full-stack version complements, rather than replaces, the existing
focused unit coverage in `sync/fakeTransport.test.ts` ("dedups by op_id:
resending the exact same op does not double-write") and `sync/engine.test.ts`
(accepted/duplicate/rejected/ordering/never-concurrent, plus a genuine
two-device slot-collision race against two real `FakeTransport` instances) —
those already exhaustively cover the transport and engine contracts in
isolation; this test proves the same contract holds when driven through the
real UI end to end.

**Result**: passes consistently. No duplication, no loss, in either
direction of the reconnect.

**Verdict**: ✅ Pass, with the architecture caveat above recorded for when
`HttpTransport` exists.

**بالعربي**: البيانات ما بتتفقدش محليًا وقت انقطاع الشبكة، والمزامنة بترجع
تظبط نفسها من غير تكرار حتى لو نفس العملية اتبعتت تاني بالغلط — لكن مهم نعرف
إن الاختبار ده بيقيس الجزء المتاح دلوقتي بس (مفيش سيرفر حقيقي لسه)، ولازم
يتعاد بطريقة تقطع الشبكة فعلًا لما الـ API الحقيقي يشتغل.

---

## 9. Simulated clinic day: 30 scenarios, zero errors

**Measurement**: **cannot be automated** — the specification is explicit
that this drill requires two humans (one on the tablet as the assistant,
one acting as patients over the phone, not face to face) and a real,
unannounced mid-drill network cut, repeated until it runs with zero moments
of confusion. That is a human usability and training measure, not a
correctness check a script can stand in for; a script would only prove the
30 written scenarios don't throw exceptions, not that a real assistant
under time pressure gets through them smoothly.

**The 30-scenario checklist** (grouped for readability; run in one
continuous sitting, on the deployed app, as a single simulated day):

*Booking (1–7)*
1. Book an existing patient by name into an empty slot.
2. Book a brand-new patient (name only, no phone — "من غير رقم").
3. Book a second family member sharing the exact same phone number as an
   existing patient.
4. Search for a patient by a misspelled/variant name (e.g. ى vs ي, or ة vs
   ه) and confirm the fold still finds them.
5. Attempt to book two different patients into the same slot at (almost)
   the same time — confirm the second gets "الميعاد ده اتحجز لسه من ثانية,"
   not a silent double-booking.
6. Book a patient with no upcoming appointment at all (a true first visit,
   no booking history to show).
7. Trigger the overbook flow once the day's slots are genuinely full.

*Modifications (8–13)*
8. Move a booked appointment to tomorrow.
9. Move a booked appointment to a day later in the week.
10. Cancel a visit with reason "المريض ألغى."
11. Cancel a visit with reason "العيادة ألغت."
12. Mark a visit no-show explicitly (not merged with cancelled).
13. Record a doctor delay (15/30/60 minutes) and confirm the rest of the
    day's display accounts for it.

*Attendance and the visit itself (14–18)*
14. Walk in a patient with no prior booking; confirm they're auto-marked
    arrived and slotted into the nearest opening.
15. Advance a patient booked → arrived → in_room → completed, one tap each.
16. Open the general visit form on an in_room visit, fill both fields, and
    confirm the muted "اتحفظ" indicator appears after each field's blur.
17. Complete a visit with the visit form left empty; confirm the muted
    "الزيارة اتقفلت من غير تسجيل" hint appears and nothing blocks
    completion.
18. Undo a one-tap status mark within the five-minute window, and confirm a
    second attempt after the window (or after another change) is refused.

*Money (19–23)*
19. Complete a visit and confirm its invoice is generated automatically,
    unpaid.
20. Record a partial payment; confirm the invoice flips to "partial" and
    the remaining balance is visibly flagged.
21. Record the remaining balance; confirm the invoice flips to "paid."
22. Attempt to void an invoice that already has a payment recorded; confirm
    it's refused with the reason shown, not silently allowed.
23. Print a receipt for a payment and confirm the print-header warning
    appears (not a fabricated default clinic header).

*Day-level operations (24–27)*
24. Switch a practitioner's schedule between slots mode and queue mode
    (owner/settings) mid-simulation and confirm no visit data is lost.
25. Add a patient to the queue directly (queue-mode day) and confirm their
    expected-wait estimate appears once at least two consultations have
    completed that day.
26. Print tomorrow's day sheet ("ورقة الغد") and confirm it lists names and
    numbers, not today's list.
27. Close the day's cash: enter a collected total that deliberately
    mismatches the expected total, and confirm the difference-reason field
    is required before the close is accepted.

*Resilience and audit (28–30)*
28. **Mid-drill, with no warning to the person on the tablet**, disconnect
    the network entirely. Continue performing 3–4 of the scenarios above
    while offline; confirm the connectivity chip reflects it and nothing
    visibly breaks. Reconnect later in the drill and confirm everything
    synced with no duplication (cross-check the audit log's entity/action
    filters).
29. Lock the device (idle timeout or manual), then unlock as a *different*
    staff member (owner vs assistant) and confirm the next few actions are
    attributed to the new person in the audit log, not the previous one.
30. Open the audit log at the end of the day and confirm every one of the
    above actions appears with a specific, human-readable verb (not a
    generic "عدّل") and the correct actor — this is the drill's own
    built-in cross-check that nothing above was silently lost or
    misattributed.

**Result**: not yet run.

**Verdict**: ⏳ Pending manual run. Per the specification, this drill is
mandatory before any real installation and must be repeated until it passes
without a single moment of confusion — a one-time clean pass is not
sufficient on its own if it took visible hesitation to get there.

**بالعربي**: يوم العيادة المصطنع بالثلاثين سيناريو المذكورين فوق لازم يتنفذ
بشخصين حقيقيين (واحد على التابلت وواحد بيمثل المرضى بالتليفون فعلاً)، مع قطع
نت مفاجئ في المنتصف، ويتكرر لحد ما يعدي من غير أي لحظة ارتباك — مش حاجة ممكن
تتقاس آليًا.

---

## Failing / pending criteria

| Criterion | Status | What would need to change |
|---|---|---|
| **3. App opens on today: ≤1s** | ❌ Fails as measured on this dev machine (0.75s–2.3s observed) | Re-measure on the actual target tablet hardware, idle, with a stopwatch — this dev sandbox's shared/variable CPU makes it an unreliable stand-in for the specification's own "measured with a stopwatch" methodology. If it's still over budget on real hardware, look at the boot critical path in `DayScreen.tsx`'s load effect (seed check → device registration → four sequential `Promise.all` reads) for anything that can be parallelized further or deferred past first paint. |
| **7. Offline: 8 hours, zero data loss** | ⏳ Not yet run | Needs a human to actually run the manual drill in section 7 above, on the target tablet, over a real 8-hour window. |
| **9. Simulated clinic day: 30 scenarios** | ⏳ Not yet run | Needs two humans to run the checklist in section 9 above, including the unannounced mid-drill network cut, repeated until zero confusion. |
| **8. Sync after disconnect** (informational, not failing) | ✅ Passes, but only proves what the current architecture has to prove | Once `HttpTransport` replaces `FakeTransport`, redo this test with `page.route()` intercepting and rejecting requests during the "offline" window, since `setOffline` does not affect `FakeTransport` at all. |

Nothing above was fixed in this task, per the brief: these are recorded for
a separate decision on which to pursue.
