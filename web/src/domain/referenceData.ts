import referenceData from "../../../contract/reference-data.json";

/**
 * Fixed ids for v1's one system-wide reference row set — the "general"
 * specialty_templates row and its current form_definitions row — read from
 * contract/reference-data.json, never generated locally. System-wide
 * reference rows are server-owned (see contract/README.md): every device's
 * seed must write the exact same ids the API's own migrations seed, or a
 * synced practitioner/visit_form_data row would point at an id that only
 * ever existed on one device.
 */
export const GENERAL_SPECIALTY_TEMPLATE_ID: string = referenceData.specialty_templates[0].id;
export const GENERAL_FORM_DEFINITION_ID: string = referenceData.form_definitions[0].id;
