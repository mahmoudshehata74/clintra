import { beforeEach, describe, expect, it } from "vitest";
import { setActiveMembershipId } from "../auth/session";
import { describeAuditVerb } from "../domain/auditVerb";
import { id } from "../domain/id";
import { effectiveBody, MESSAGE_TEMPLATES } from "../domain/messageTemplates";
import { Role } from "../domain/role";
import { auditGroupOf } from "../screens/day/auditLogFilters";
import { describeSyncReview } from "../sync/reviewSummary";
import { ClintraDatabase } from "./database";
import { getDeviceBinding } from "./deviceRegistration";
import {
  markMessageSent,
  MessageError,
  recordMessageAttempt,
  resetTemplate,
  saveTemplateBody,
  TemplateError,
  unmarkMessageSent,
} from "./messages";
import { seedDatabase } from "./seed";
import { AuditAction, MessageChannel, type Patient, type SyncReview } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-messages-test-${crypto.randomUUID()}`);
});

async function addPatient(phone: string | null): Promise<Patient> {
  const org = (await db.organizations.toArray())[0];
  const patient: Patient = {
    id: id(),
    org_id: org.id,
    full_name: "كريم فتحي",
    phone,
    gender: null,
    birth_year: null,
    note: null,
    created_at: new Date().toISOString(),
    rev: 1,
  };
  await db.patients.add(patient);
  return patient;
}

async function signInOwner(): Promise<void> {
  const owner = (await db.memberships.toArray()).find((m) => m.role === Role.Owner);
  if (!owner) throw new Error("no seeded owner");
  setActiveMembershipId(owner.id);
}

/** Audit rows in the order they were written (seq); sync ops in primary-key order, so compare those order-free. */
async function writesFor(entity: string) {
  return {
    auditRows: (await db.audit_log.toArray()).filter((row) => row.entity === entity).sort((a, b) => a.seq - b.seq),
    syncOps: (await db.sync_ops.toArray()).filter((op) => op.entity === entity),
  };
}

const BODY = "مرحباً كريم،\nاتأكد حجزك 📅 & #1";

describe("recordMessageAttempt", () => {
  it("stores the row with the patient's E.164 phone, returns its link, and writes one audit row and one sync op", async () => {
    await seedDatabase(db);
    const patient = await addPatient("+201001234567");
    const device = await getDeviceBinding(db);

    const before = Date.now();
    const { message, link, auditLogId } = await recordMessageAttempt(db, {
      patientId: patient.id,
      templateKey: "booking_confirmation",
      channel: MessageChannel.WhatsApp,
      body: `  ${BODY}\n `,
    });

    expect(await db.messages.get(message.id)).toEqual(message);
    expect(message).toMatchObject({
      org_id: patient.org_id,
      location_id: device.location_id,
      patient_id: patient.id,
      visit_id: null,
      template_key: "booking_confirmation",
      channel: "whatsapp",
      phone: "+201001234567",
      body: BODY,
      marked_sent_at: null,
      rev: 1,
    });
    expect(new Date(message.attempted_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(message.created_at).toBe(message.attempted_at);
    expect(link).toBe(`https://wa.me/201001234567?text=${encodeURIComponent(BODY)}`);

    const { auditRows, syncOps } = await writesFor("messages");
    expect(auditRows.map((row) => row.id)).toEqual([auditLogId]);
    expect(auditRows[0].action).toBe(AuditAction.Create);
    expect(syncOps).toHaveLength(1);
    expect(syncOps[0].payload).toEqual(message);
  });

  it("normalises a patient phone stored in a local form, and opens SMS with sms:", async () => {
    await seedDatabase(db);
    const patient = await addPatient("0100 123 4567");

    const { message, link } = await recordMessageAttempt(db, {
      patientId: patient.id,
      templateKey: "custom",
      channel: MessageChannel.Sms,
      body: "a\nb",
    });

    expect(message.phone).toBe("+201001234567");
    expect(link).toBe("sms:+201001234567?body=a%0Ab");
  });

  it("takes the visit's location when a visit is given", async () => {
    await seedDatabase(db);
    const patient = await addPatient("+201001234567");
    const visit = (await db.visits.toArray())[0];
    await db.visits.update(visit.id, { location_id: "another-location" });

    const { message } = await recordMessageAttempt(db, {
      patientId: patient.id,
      visitId: visit.id,
      templateKey: "appointment_reminder",
      channel: MessageChannel.WhatsApp,
      body: BODY,
    });

    expect([message.visit_id, message.location_id]).toEqual([visit.id, "another-location"]);
  });

  it.each<[string, string | null, string, string, string]>([
    ["no phone", null, "booking_confirmation", BODY, MessageError.PatientHasNoPhone],
    ["a blank phone", "   ", "booking_confirmation", BODY, MessageError.PatientHasNoPhone],
    ["a phone that is not an Egyptian number", "12345", "booking_confirmation", BODY, MessageError.PatientHasNoPhone],
    ["an empty body", "+201001234567", "booking_confirmation", "", MessageError.BodyRequired],
    ["a blank body", "+201001234567", "custom", " \n\t ", MessageError.BodyRequired],
    ["an unknown template key", "+201001234567", "promo", BODY, MessageError.TemplateUnknown],
  ])("refuses %s, writing nothing", async (_label, phone, templateKey, body, error) => {
    await seedDatabase(db);
    const patient = await addPatient(phone);

    await expect(
      recordMessageAttempt(db, { patientId: patient.id, templateKey, channel: MessageChannel.WhatsApp, body }),
    ).rejects.toThrow(error);

    expect(await db.messages.count()).toBe(0);
    const { auditRows, syncOps } = await writesFor("messages");
    expect([auditRows.length, syncOps.length]).toEqual([0, 0]);
  });

  it("refuses a missing patient or visit", async () => {
    await seedDatabase(db);
    const patient = await addPatient("+201001234567");
    const base = { templateKey: "custom", channel: MessageChannel.Sms, body: "x" };

    await expect(recordMessageAttempt(db, { ...base, patientId: id() })).rejects.toThrow(MessageError.PatientNotFound);
    await expect(recordMessageAttempt(db, { ...base, patientId: patient.id, visitId: id() })).rejects.toThrow(
      MessageError.VisitNotFound,
    );
    expect(await db.messages.count()).toBe(0);
  });
});

describe("markMessageSent / unmarkMessageSent", () => {
  async function recorded() {
    await seedDatabase(db);
    const patient = await addPatient("+201001234567");
    return (
      await recordMessageAttempt(db, {
        patientId: patient.id,
        templateKey: "booking_confirmation",
        channel: MessageChannel.WhatsApp,
        body: BODY,
      })
    ).message;
  }

  it("sets and clears marked_sent_at and nothing else, each with one audit row and one sync op carrying base_rev", async () => {
    const message = await recorded();

    const markId = await markMessageSent(db, message.id);
    const marked = await db.messages.get(message.id);
    expect(markId).not.toBeNull();
    expect(marked?.marked_sent_at).not.toBeNull();
    expect({ ...marked, marked_sent_at: null }).toEqual(message);

    const unmarkId = await unmarkMessageSent(db, message.id);
    expect(unmarkId).not.toBeNull();
    expect(await db.messages.get(message.id)).toEqual(message);

    const { auditRows, syncOps } = await writesFor("messages");
    expect(auditRows.map((row) => row.action)).toEqual([AuditAction.Create, AuditAction.Update, AuditAction.Update]);
    expect(syncOps.map((op) => `${op.action}:${op.base_rev}`).sort()).toEqual(["create:null", "update:1", "update:1"]);
  });

  it("writes nothing when the mark is already in that state", async () => {
    const message = await recorded();

    expect(await unmarkMessageSent(db, message.id)).toBeNull();
    await markMessageSent(db, message.id);
    expect(await markMessageSent(db, message.id)).toBeNull();

    expect((await writesFor("messages")).auditRows).toHaveLength(2);
  });

  it("refuses a message that does not exist", async () => {
    await seedDatabase(db);
    await expect(markMessageSent(db, id())).rejects.toThrow(MessageError.MessageNotFound);
    await expect(unmarkMessageSent(db, id())).rejects.toThrow(MessageError.MessageNotFound);
  });

  it("read in the audit log by channel and mark, under the visits filter, never with the body or phone", async () => {
    const message = await recorded();
    await markMessageSent(db, message.id);
    await unmarkMessageSent(db, message.id);
    const patient = await db.patients.get(message.patient_id);
    if (!patient) throw new Error("no patient");
    await recordMessageAttempt(db, { patientId: patient.id, templateKey: "custom", channel: MessageChannel.Sms, body: "x" });

    const rows = (await writesFor("messages")).auditRows;
    const verbs = rows.map(describeAuditVerb);
    expect(verbs).toEqual(["فتح رسالة واتساب", "علّم الرسالة إنها اتبعتت", "شال علامة الإرسال", "فتح رسالة SMS"]);
    for (const verb of verbs) {
      expect(verb).not.toContain("كريم");
      expect(verb).not.toContain("1234567");
    }
    expect(auditGroupOf("messages")).toBe("visits");
  });
});

describe("saveTemplateBody / resetTemplate", () => {
  it("creates an override, trimmed, for the owner; then updates it; equal to the default deletes it", async () => {
    await seedDatabase(db);
    await signInOwner();
    const owner = (await db.memberships.toArray()).find((m) => m.role === Role.Owner);

    const createId = await saveTemplateBody(db, "appointment_reminder", "  نص المالك {{patient_name}}\n");
    const created = await db.message_templates.where("key").equals("appointment_reminder").first();
    expect(createId).not.toBeNull();
    expect(created).toMatchObject({
      key: "appointment_reminder",
      body: "نص المالك {{patient_name}}",
      org_id: owner?.org_id,
      updated_by: owner?.id,
      rev: 1,
    });
    expect(effectiveBody("appointment_reminder", created)).toBe("نص المالك {{patient_name}}");

    await saveTemplateBody(db, "appointment_reminder", "نص تاني");
    const updated = await db.message_templates.get(created?.id ?? "");
    expect(updated?.body).toBe("نص تاني");

    const reset = await saveTemplateBody(db, "appointment_reminder", ` ${MESSAGE_TEMPLATES[1].defaultBody} `);
    expect(reset).not.toBeNull();
    expect(await db.message_templates.count()).toBe(0);

    const { auditRows, syncOps } = await writesFor("message_templates");
    expect(auditRows.map((row) => row.action)).toEqual([AuditAction.Create, AuditAction.Update, AuditAction.Delete]);
    expect(syncOps.map((op) => `${op.action}:${op.base_rev}`).sort()).toEqual(["create:null", "delete:1", "update:1"]);
  });

  it("writes nothing for the current override's body, or the default with no override", async () => {
    await seedDatabase(db);
    await signInOwner();

    expect(await saveTemplateBody(db, "balance_reminder", MESSAGE_TEMPLATES[4].defaultBody)).toBeNull();
    await saveTemplateBody(db, "balance_reminder", "نص");
    expect(await saveTemplateBody(db, "balance_reminder", " نص ")).toBeNull();

    expect((await writesFor("message_templates")).auditRows).toHaveLength(1);
  });

  it.each<[string, string, string, string]>([
    ["an empty body", "booking_confirmation", "", TemplateError.BodyRequired],
    ["a blank body", "booking_confirmation", " \n ", TemplateError.BodyRequired],
    ["a body over 4000 characters", "booking_confirmation", "ب".repeat(4001), TemplateError.BodyTooLong],
    ["custom, which has no override", "custom", "نص", TemplateError.NotEditable],
    ["an unknown key", "promo", "نص", TemplateError.NotEditable],
  ])("refuses %s, writing nothing", async (_label, key, body, error) => {
    await seedDatabase(db);
    await signInOwner();

    await expect(saveTemplateBody(db, key, body)).rejects.toThrow(error);
    expect(await db.message_templates.count()).toBe(0);
    expect((await writesFor("message_templates")).auditRows).toHaveLength(0);
  });

  it("accepts 4000 characters, counting an emoji as one", async () => {
    await seedDatabase(db);
    await signInOwner();

    await saveTemplateBody(db, "booking_confirmation", `${"ب".repeat(3999)}📅`);
    expect(await db.message_templates.count()).toBe(1);
  });

  it("refuses anyone but the owner, for save and reset", async () => {
    await seedDatabase(db);
    // The test harness's default actor is the seeded assistant.

    await expect(saveTemplateBody(db, "booking_confirmation", "نص")).rejects.toThrow(TemplateError.NotOwner);
    await expect(resetTemplate(db, "booking_confirmation")).rejects.toThrow(TemplateError.NotOwner);
    expect((await writesFor("message_templates")).auditRows).toHaveLength(0);
  });

  it("resetTemplate deletes the override, and is a no-op without one", async () => {
    await seedDatabase(db);
    await signInOwner();
    await saveTemplateBody(db, "post_visit_followup", "نص");

    expect(await resetTemplate(db, "post_visit_followup")).not.toBeNull();
    expect(await db.message_templates.count()).toBe(0);
    expect(await resetTemplate(db, "post_visit_followup")).toBeNull();
    await expect(resetTemplate(db, "custom")).rejects.toThrow(TemplateError.NotEditable);
  });

  it("reads in the audit log by template name under the settings filter, never with the body", async () => {
    await seedDatabase(db);
    await signInOwner();
    await saveTemplateBody(db, "care_plan_session_reminder", "نص سري");
    await saveTemplateBody(db, "care_plan_session_reminder", "نص سري تاني");
    await resetTemplate(db, "care_plan_session_reminder");

    const verbs = (await writesFor("message_templates")).auditRows.map(describeAuditVerb);
    expect(verbs).toEqual([
      "عدّل قالب «تذكير جلسة خطة»",
      "عدّل قالب «تذكير جلسة خطة»",
      "رجّع قالب «تذكير جلسة خطة» للأصل",
    ]);
    expect(verbs.join()).not.toContain("سري");
    expect(auditGroupOf("message_templates")).toBe("settings");
  });
});

describe("the sync review summary", () => {
  function review(entity: string, reason: string): SyncReview {
    return {
      id: crypto.randomUUID(),
      op_id: crypto.randomUUID(),
      entity,
      entity_id: crypto.randomUUID(),
      reason,
      payload: null,
      needs_review: true,
      created_at: new Date().toISOString(),
      action: AuditAction.Update,
      base_rev: 1,
    };
  }

  it("names a refused message or template write in Arabic", () => {
    expect(describeSyncReview(review("messages", "message_immutable"))).toBe(
      "رسالة — الرسالة دي اتسجّلت ومينفعش تتغيّر أو تتمسح، غير علامة الإرسال",
    );
    expect(describeSyncReview(review("messages", "message_invalid"))).toBe(
      "رسالة — الرسالة دي ناقصة أو غلط: لازم يكون ليها نص ورقم موبايل صحيح",
    );
    expect(describeSyncReview(review("message_templates", "template_invalid"))).toBe(
      "قالب رسالة — القالب ده مش صالح: لازم يكون ليه نص، 4000 حرف بالكتير",
    );
  });
});
