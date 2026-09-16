import { GoogleGenAI } from "@google/genai";

export const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Gemini call helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

export function isQuotaError(error: unknown) {
  return errorStatus(error) === 429;
}

export function isTemporaryError(error: unknown) {
  const status = errorStatus(error);
  return status === 500 || status === 503;
}

export async function generateJson<T>(
  ai: GoogleGenAI,
  model: string,
  schema: unknown,
  prompt: string
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[Gemini] ${model} attempt ${attempt}/2`);

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      });

      if (!response.text) {
        throw new Error("Gemini returned an empty response.");
      }

      return JSON.parse(response.text) as T;
    } catch (error) {
      lastError = error;

      console.error(`[Gemini] ${model} attempt ${attempt} failed:`, error);

      if (isQuotaError(error)) throw error;
      if (!isTemporaryError(error)) throw error;
      if (attempt === 1) await sleep(2000);
    }
  }

  throw lastError;
}

export function getModels() {
  return {
    primaryModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite",
  };
}

// ---------------------------------------------------------------------------
// Shared treatment-plan shape: organized by treatment LINE (1st, 2nd, 3rd...)
// rather than by facility level (B2/C).
// ---------------------------------------------------------------------------

export type TreatmentLine = {
  label: string;
  order: number;
  regimens: string[];
  when_to_use: string;
};

export type RegimenVariant = {
  style: string;
  regimens: string[];
  rationale: string;
};

export type Paediatric = {
  dosing: string[]; // mg/kg and age bands, as reference text
  age_floor?: string; // "Not for use under 8 years"
  neonatal_note?: string;
};

export type PregnancyLactation = {
  pregnancy: string; // by trimester where it differs
  lactation: string;
};

export type Plan = {
  condition: string;
  lines: TreatmentLine[];
  regimen_variants: RegimenVariant[];
  alternatives: string[];
  contraindications: string[];
  cautions: string[];
  monitoring: string[];
  extended_info: string[];
  paediatric?: Paediatric;
  pregnancy_lactation?: PregnancyLactation;
  adjuncts?: string[];
};

export const treatmentLineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "order", "regimens", "when_to_use"],
  properties: {
    label: { type: "string" },
    order: { type: "integer" },
    regimens: { type: "array", items: { type: "string" } },
    when_to_use: { type: "string" },
  },
};

export const regimenVariantSchema = {
  type: "object",
  additionalProperties: false,
  required: ["style", "regimens", "rationale"],
  properties: {
    style: { type: "string" },
    regimens: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
};

export const paediatricSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dosing"],
  properties: {
    dosing: { type: "array", items: { type: "string" } },
    age_floor: { type: "string", nullable: true },
    neonatal_note: { type: "string", nullable: true },
  },
};

export const pregnancyLactationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pregnancy", "lactation"],
  properties: {
    pregnancy: { type: "string" },
    lactation: { type: "string" },
  },
};

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "condition",
    "lines",
    "regimen_variants",
    "alternatives",
    "contraindications",
    "cautions",
    "monitoring",
    "extended_info",
    "paediatric",
    "pregnancy_lactation",
    "adjuncts",
  ],
  properties: {
    condition: { type: "string" },
    lines: { type: "array", items: treatmentLineSchema },
    regimen_variants: { type: "array", items: regimenVariantSchema },
    alternatives: { type: "array", items: { type: "string" } },
    contraindications: { type: "array", items: { type: "string" } },
    cautions: { type: "array", items: { type: "string" } },
    monitoring: { type: "array", items: { type: "string" } },
    extended_info: { type: "array", items: { type: "string" } },
    paediatric: paediatricSchema,
    pregnancy_lactation: pregnancyLactationSchema,
    adjuncts: { type: "array", items: { type: "string" } },
  },
};

export const LOOKUP_DEPTH_RULES = `
PAEDIATRIC, PREGNANCY AND ADJUNCT DEPTH (reference text, not a patient calculation):
- Populate "paediatric.dosing" fully from standard practice: mg/kg per dose, age bands, maximum daily dose. The STG extract does not carry dose schedules, so use established paediatric practice. State weight-based dosing as a RULE ("15 mg/kg/dose, max 500 mg, TDS") — never resolve it into a figure for a particular child.
- Set "paediatric.age_floor" when the drug or regimen has one ("Not for use under 8 years"), and "neonatal_note" where neonates differ.
- "pregnancy_lactation.pregnancy" should state trimester-specific guidance where it differs; "lactation" should say whether the regimen is compatible with breastfeeding.
- "adjuncts" lists the symptomatic cover typically given alongside this treatment (antipyretic, analgesic, antiemetic, ORS/zinc, antihistamine, antispasmodic) — short lines, only those that genuinely apply.
`;

export const TREATMENT_STRUCTURE_RULES = `
TREATMENT STRUCTURE RULES (organize by treatment LINE, never by facility level):
- Organize the treatment for each condition by TREATMENT LINE: First-line, Second-line, Third-line, and further lines if the guideline supports one (e.g. "Severe/refractory", "Alternative if allergic"). Do NOT organize treatment around facility levels such as B2 or C.
- Order lines the way a clinician actually escalates through them (order 1 = tried first).
- For each line give: the specific regimen(s) (drug, strength/dose, route, frequency, duration where available), and a short "when_to_use" note explaining why a clinician would move to that line (e.g. first-line contraindicated, allergy, treatment failure, disease severity, non-availability).
- If the supplied source does not explicitly label lines, infer a reasonable First-line / Second-line split from the best-supported regimen(s) and say so plainly in "when_to_use".
- Facility-level or availability differences may still be mentioned as context inside "when_to_use" or "cautions", but must never be the primary way treatment is grouped.
`;

export const REGIMEN_VARIANT_RULES = `
REGIMEN VARIANTS (alternative evidence-based approaches):
- In "regimen_variants", offer up to about four named alternative approaches beyond the primary lines above, where genuinely different reasonable options exist — e.g. a shorter higher-intensity course vs. a longer standard course, an option chosen for faster symptom relief, a broader-first vs. narrower-first strategy, or the equivalent regimen from a different guideline tradition (Ghana STG vs. WHO vs. CDC/IDSA vs. NICE) where they meaningfully differ.
- Each variant needs a short descriptive "style" label, its "regimens", and a one-line "rationale" naming why/when a clinician might prefer it and which tradition/source it reflects (e.g. "Ghana STG", "WHO", "CDC/IDSA", "shorter-course evidence").
- Only include variants that are real, defensible clinical options — never invent one just to fill the array. An empty array is correct when there is genuinely only one reasonable approach.
`;

export const EXTENDED_INFO_RULES = `
EXTENDED CLINICAL KNOWLEDGE — LEARNING DEEP-DIVE (shown collapsed, expanded on click):
- In "extended_info", give summarized, high-yield teaching bullets — one or two sentences each, not paragraphs — covering whichever of these are relevant: likely causative organism(s)/etiology, why the recommended regimen works against them, resistance patterns worth knowing, non-drug management, red flags/complications to watch for, typical prognosis, and when/why to escalate or refer.
- Draw on your general medical knowledge freely here — it is supplementary education alongside the grounded treatment above, not a source-verified prescription. Do not introduce unverified doses/regimens here that contradict the grounded "lines".
- Be specific and genuinely instructive rather than repeating the grounded lines in different words. An empty array is only correct if there is truly nothing useful to add.
`;

export const CLINICAL_GROUNDING_RULES = `
CLINICAL GROUNDING RULES:
- Prefer the supplied Ghana STG records when they cover the condition or drug, and name that source.
- When the supplied records are thin or silent — common for STIs, complicated UTIs, RTIs, hypertensive emergencies, animal bites — answer fully from established international practice (WHO, CDC/IDSA, NICE, standard practice) and name which. Never refuse, and never tell the clinician to go and check the STG themselves.
- Never invent a dose, route, frequency or duration that is not grounded in the supplied source or genuinely standard practice.
- Never compute a specific patient's milligram figure. State the rule; the application does the arithmetic.
- Flag emergencies, pregnancy concerns and dangerous vital signs plainly within the content itself.
- Do not append "verify locally" to individual items — the page carries one safety notice.
`;

// ---------------------------------------------------------------------------
// Postgres full-text search results (supabase/004_search.sql)
// ---------------------------------------------------------------------------

export type ConditionHit = {
  id: number;
  condition: string;
  symptoms: string | null;
  signs: string | null;
  investigations: string | null;
  treatment: string | null;
  referral_criteria: string | null;
  source_pages: string | null;
  printed_page: string | null;
  rank: number;
};

export type MedicationHit = {
  id: number;
  drug: string;
  formulation: string | null;
  strength: string | null;
  level_of_care: string | null;
  contraindications: string | null;
  cautions: string | null;
  eml_page: string | null;
  category: string | null;
  rank: number;
};

export const asConditionHits = (data: unknown): ConditionHit[] =>
  Array.isArray(data) ? (data as ConditionHit[]) : [];

export const asMedicationHits = (data: unknown): MedicationHit[] =>
  Array.isArray(data) ? (data as MedicationHit[]) : [];

/**
 * Turns prose (an STG treatment paragraph) into individual search terms.
 * websearch_to_tsquery ANDs every word in a term, so a whole sentence matches
 * nothing useful — single salient words are what actually hit the index.
 */
export function termsFromText(text: unknown, limit = 12): string[] {
  return [
    ...new Set(
      clean(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 5)
    ),
  ].slice(0, limit);
}

