import { id } from "../domain/id";
import { buildMessageLink } from "../domain/messageLink";
import {
  findMessageTemplate,
  isEditableTemplateKey,
  isMessageTemplateKey,
  TEMPLATE_BODY_MAX_LENGTH,
  templateBodyLength,
} from "../domain/messageTemplates";
import { normalizeEgyptianPhone } from "../domain/phone";
import { Role } from "../domain/role";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { getDeviceBinding } from "./deviceRegistration";
import { mutate } from "./mutate";
import { AuditAction, type Membership, type Message, type MessageChannel, type MessageTemplate } from "./types";

/**
 * Every refusal the message writers below can throw, as the thrown Error's
 * message. Each is raised before anything is written.
 */
export const MessageError = {
  PatientNotFound: "patient_not_found",
  /** The patient has no phone on record, or one that is not a valid Egyptian number. */
  PatientHasNoPhone: "patient_has_no_phone",
  VisitNotFound: "visit_not_found",
  /** The body is empty once trimmed. */
  BodyRequired: "message_body_required",
  TemplateUnknown: "template_unknown",
  MessageNotFound: "message_not_found",
} as const;

export type MessageError = (typeof MessageError)[keyof typeof MessageError];

export const TemplateError = {
  /** The acting membership is not an owner. */
  NotOwner: "not_owner",
  /** The key is unknown, or custom, which has no override. */
  NotEditable: "template_not_editable",
  /** The body is empty once trimmed. */
  BodyRequired: "template_body_required",
  /** The body is longer than TEMPLATE_BODY_MAX_LENGTH characters. */
  BodyTooLong: "template_body_too_long",
} as const;

export type TemplateError = (typeof TemplateError)[keyof typeof TemplateError];

export interface RecordMessageAttemptInput {
  patientId: string;
  visitId?: string | null;
  templateKey: string;
  channel: MessageChannel;
  /** The rendered text, as the screen will hand it to WhatsApp or SMS. */
  body: string;
}

export interface RecordMessageAttemptResult {
  message: Message;
  /** The wa.me or sms: link to open for it (domain/messageLink.ts). */
  link: string;
  auditLogId: string;
}

/**
 * Records that the app is opening WhatsApp or SMS for a message, and returns
 * the row and the link to open (docs/schema.md's v19 additions). The row is
 * written now, with attempted_at — there is no provider, so whether it was
 * actually sent is marked by hand later (markMessageSent).
 *
 * The body is stored trimmed, and the link carries exactly that text. The
 * phone is the patient's own, normalised to E.164. The location is the
 * visit's when one is given, otherwise this device's. Refuses, writing
 * nothing: an empty body, an unknown template key, a missing patient or
 * visit, and a patient with no usable phone (`patient_has_no_phone`).
 *
 * Audited as "فتح رسالة واتساب" / "فتح رسالة SMS", naming the patient — never
 * the body or the phone.
 */
export async function recordMessageAttempt(
  db: ClintraDatabase,
  input: RecordMessageAttemptInput,
): Promise<RecordMessageAttemptResult> {
  const body = input.body.trim();
  if (body === "") {
    throw new Error(MessageError.BodyRequired);
  }
  if (!isMessageTemplateKey(input.templateKey)) {
    throw new Error(MessageError.TemplateUnknown);
  }

  const actor = await resolveActingMembership(db);
  const device = await getDeviceBinding(db);

  return db.transaction("rw", [db.patients, db.visits, db.messages, db.audit_log, db.sync_ops], async () => {
    const patient = await db.patients.get(input.patientId);
    if (!patient) {
      throw new Error(MessageError.PatientNotFound);
    }
    const normalized = patient.phone === null ? null : normalizeEgyptianPhone(patient.phone);
    if (normalized === null || !normalized.ok) {
      throw new Error(MessageError.PatientHasNoPhone);
    }

    const visitId = input.visitId ?? null;
    const visit = visitId === null ? undefined : await db.visits.get(visitId);
    if (visitId !== null && !visit) {
      throw new Error(MessageError.VisitNotFound);
    }

    const now = new Date().toISOString();
    const message: Message = {
      id: id(),
      org_id: patient.org_id,
      location_id: visit?.location_id ?? device.location_id,
      patient_id: patient.id,
      visit_id: visitId,
      template_key: input.templateKey,
      channel: input.channel,
      phone: normalized.value,
      body,
      attempted_at: now,
      marked_sent_at: null,
      created_by: actor.id,
      created_at: now,
      rev: 1,
    };
    const link = buildMessageLink(message.channel, message.phone, message.body);

    const auditLogId = await mutate(db, {
      table: db.messages,
      entity: "messages",
      entityId: message.id,
      action: AuditAction.Create,
      before: null,
      after: message,
      actorMembershipId: actor.id,
      orgId: message.org_id,
    });
    return { message, link, auditLogId };
  });
}

/** Sets or clears marked_sent_at — the only field of a message that ever changes. Null when it already held that state. */
async function setMarkedSent(db: ClintraDatabase, messageId: string, sent: boolean): Promise<string | null> {
  const actor = await resolveActingMembership(db);

  return db.transaction("rw", db.messages, db.audit_log, db.sync_ops, async () => {
    const before = await db.messages.get(messageId);
    if (!before) {
      throw new Error(MessageError.MessageNotFound);
    }
    if ((before.marked_sent_at !== null) === sent) {
      return null;
    }

    const after: Message = { ...before, marked_sent_at: sent ? new Date().toISOString() : null };
    return mutate(db, {
      table: db.messages,
      entity: "messages",
      entityId: messageId,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actor.id,
      orgId: before.org_id,
    });
  });
}

/**
 * Marks a message as sent ("اتبعتت"), by hand. Audited as "علّم الرسالة إنها
 * اتبعتت". Writes nothing and returns null when it is already marked.
 */
export function markMessageSent(db: ClintraDatabase, messageId: string): Promise<string | null> {
  return setMarkedSent(db, messageId, true);
}

/**
 * Clears a message's sent mark. Audited as "شال علامة الإرسال". Writes nothing
 * and returns null when it is not marked.
 */
export function unmarkMessageSent(db: ClintraDatabase, messageId: string): Promise<string | null> {
  return setMarkedSent(db, messageId, false);
}

async function actingOwner(db: ClintraDatabase): Promise<Membership> {
  const actor = await resolveActingMembership(db);
  if (actor.role !== Role.Owner) {
    throw new Error(TemplateError.NotOwner);
  }
  return actor;
}

function deleteOverride(db: ClintraDatabase, override: MessageTemplate, actor: Membership): Promise<string> {
  return mutate(db, {
    table: db.message_templates,
    entity: "message_templates",
    entityId: override.id,
    action: AuditAction.Delete,
    before: override,
    after: null,
    actorMembershipId: actor.id,
    orgId: override.org_id,
  });
}

/**
 * Saves the organization's own body for an editable template (an override).
 * The body is trimmed; an empty one is refused (`template_body_required`),
 * and so is one over 4000 characters (`template_body_too_long`). A body equal
 * to the default deletes the override instead of storing a copy of it (and
 * does nothing when there is none). A body equal to the current override
 * writes nothing. Owner only (`not_owner`), enforced here — the server does
 * not check who edits, as for every other settings write (api/docs/rls.md's
 * "Messages and message templates"). Custom and unknown keys have no
 * override (`template_not_editable`).
 *
 * Returns the audit_log id of the write, or null when nothing was written.
 * Audited as "عدّل قالب «{name}»", or "رجّع قالب «{name}» للأصل" when the
 * override is deleted — never the body.
 */
export async function saveTemplateBody(db: ClintraDatabase, key: string, body: string): Promise<string | null> {
  const definition = findMessageTemplate(key);
  if (!definition || !isEditableTemplateKey(key)) {
    throw new Error(TemplateError.NotEditable);
  }
  const trimmed = body.trim();
  if (trimmed === "") {
    throw new Error(TemplateError.BodyRequired);
  }
  if (templateBodyLength(trimmed) > TEMPLATE_BODY_MAX_LENGTH) {
    throw new Error(TemplateError.BodyTooLong);
  }
  const actor = await actingOwner(db);

  return db.transaction("rw", db.message_templates, db.audit_log, db.sync_ops, async () => {
    const existing = await db.message_templates.where("key").equals(key).first();

    if (trimmed === definition.defaultBody) {
      return existing ? deleteOverride(db, existing, actor) : null;
    }
    if (existing?.body === trimmed) {
      return null;
    }

    const now = new Date().toISOString();
    const after: MessageTemplate = existing
      ? { ...existing, body: trimmed, updated_by: actor.id, updated_at: now }
      : { id: id(), org_id: actor.org_id, key, body: trimmed, updated_by: actor.id, updated_at: now, rev: 1 };
    return mutate(db, {
      table: db.message_templates,
      entity: "message_templates",
      entityId: after.id,
      action: existing ? AuditAction.Update : AuditAction.Create,
      before: existing ?? null,
      after,
      actorMembershipId: actor.id,
      orgId: after.org_id,
    });
  });
}

/**
 * "Reset to default": deletes the organization's override for a key, so the
 * default that ships with the app applies again. Owner only (`not_owner`).
 * Returns null, writing nothing, when there is no override.
 */
export async function resetTemplate(db: ClintraDatabase, key: string): Promise<string | null> {
  if (!isEditableTemplateKey(key)) {
    throw new Error(TemplateError.NotEditable);
  }
  const actor = await actingOwner(db);

  return db.transaction("rw", db.message_templates, db.audit_log, db.sync_ops, async () => {
    const existing = await db.message_templates.where("key").equals(key).first();
    return existing ? deleteOverride(db, existing, actor) : null;
  });
}
