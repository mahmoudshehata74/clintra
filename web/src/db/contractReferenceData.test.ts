import { describe, expect, it } from "vitest";
import { CONTRACT_FORM_DEFINITIONS, CONTRACT_SPECIALTY_TEMPLATES, ensureContractReferenceData } from "./contractReferenceData";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import { findGeneralFormDefinition } from "./visitForm";

const fresh = () => new ClintraDatabase(`clintra-contract-reference-test-${crypto.randomUUID()}`);

describe("ensureContractReferenceData", () => {
  it("gives a device with none of them the contract rows, with no sync op or audit row", async () => {
    const db = fresh();
    await expect(findGeneralFormDefinition(db)).rejects.toThrow("general_specialty_template_not_found");

    await ensureContractReferenceData(db);

    expect(await db.specialty_templates.toArray()).toEqual(CONTRACT_SPECIALTY_TEMPLATES);
    expect(await db.form_definitions.toArray()).toEqual(CONTRACT_FORM_DEFINITIONS);
    expect((await findGeneralFormDefinition(db)).id).toBe(CONTRACT_FORM_DEFINITIONS[0].id);
    expect(await db.sync_ops.count()).toBe(0);
    expect(await db.audit_log.count()).toBe(0);
  });

  it("leaves rows already present as they are, and runs any number of times", async () => {
    const db = fresh();
    await seedDatabase(db);
    const templates = await db.specialty_templates.toArray();
    const definitions = await db.form_definitions.toArray();

    await ensureContractReferenceData(db);
    await ensureContractReferenceData(db);

    expect(await db.specialty_templates.toArray()).toEqual(templates);
    expect(await db.form_definitions.toArray()).toEqual(definitions);
  });

  it("matches the rows the demo seed writes", async () => {
    const db = fresh();
    await seedDatabase(db);
    expect(await db.specialty_templates.get(CONTRACT_SPECIALTY_TEMPLATES[0].id)).toEqual(CONTRACT_SPECIALTY_TEMPLATES[0]);
    expect(await db.form_definitions.get(CONTRACT_FORM_DEFINITIONS[0].id)).toEqual(CONTRACT_FORM_DEFINITIONS[0]);
  });
});
