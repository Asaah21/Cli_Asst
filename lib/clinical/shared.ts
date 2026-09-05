import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Text ranking helpers (shared by the full assessment flow and the
// standalone condition lookup flow).
// ---------------------------------------------------------------------------

export const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

export const tokens = (value: unknown): string[] =>
  [
    ...new Set(
      clean(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((x) => x.length >= 4)
    ),
  ].slice(0, 80);

export const scoreText = (query: string, text: string) => {
  const queryTerms = new Set(tokens(query));
  const textTerms = new Set(tokens(text));

  let score = 0;

  for (const term of queryTerms) {
    if (textTerms.has(term)) score++;
  }

  return score;
};

export function rankByScore<T>(
  items: T[],
  query: string,
  toText: (item: T) => string,
  limit: number
) {
  return items
    .map((item) => ({ item, score: scoreText(query, toText(item)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

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

export type Plan = {
  condition: string;
  lines: TreatmentLine[];
  alternatives: string[];
  contraindications: string[];
  cautions: string[];
  monitoring: string[];
  extended_info: string[];
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

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "condition",
    "lines",
    "alternatives",
    "contraindications",
    "cautions",
    "monitoring",
    "extended_info",
  ],
  properties: {
    condition: { type: "string" },
    lines: { type: "array", items: treatmentLineSchema },
    alternatives: { type: "array", items: { type: "string" } },
    contraindications: { type: "array", items: { type: "string" } },
    cautions: { type: "array", items: { type: "string" } },
    monitoring: { type: "array", items: { type: "string" } },
    extended_info: { type: "array", items: { type: "string" } },
  },
};

export const TREATMENT_STRUCTURE_RULES = `
TREATMENT STRUCTURE RULES (organize by treatment LINE, never by facility level):
- Organize the treatment for each condition by TREATMENT LINE: First-line, Second-line, Third-line, and further lines if the guideline supports one (e.g. "Severe/refractory", "Alternative if allergic"). Do NOT organize treatment around facility levels such as B2 or C.
- Order lines the way a clinician actually escalates through them (order 1 = tried first).
- For each line give: the specific regimen(s) supported by the supplied STG/EML records (drug, strength/dose, route, frequency, duration where available), and a short "when_to_use" note explaining why a clinician would move to that line (e.g. first-line contraindicated, allergy, treatment failure, disease severity, non-availability).
- If the supplied source does not explicitly label lines, infer a reasonable First-line / Second-line split from what IS supported (the primary recommended regimen becomes first-line; documented alternatives for allergy/failure/severity become second-line, etc.) and say so plainly in "when_to_use".
- Facility-level or availability differences may still be mentioned as context inside "when_to_use" or "cautions", but must never be the primary way treatment is grouped.
`;

export const EXTENDED_INFO_RULES = `
EXTENDED CLINICAL KNOWLEDGE (beyond the supplied STG/EML excerpt):
- In "extended_info" for each plan, add genuinely useful clinical background that goes beyond what was in the supplied source: mechanism of action of the key drug classes, non-drug management, patient counselling points, red-flag progression to watch for, typical prognosis, and when/why to escalate or refer.
- Draw on your general medical knowledge for this section — it is supplementary education for the clinician, not a source-verified prescription. Do not introduce unverified doses/regimens here that contradict the grounded "lines" above.
- Be specific and informative rather than repeating the grounded lines in different words. Empty or generic filler is not acceptable — if you genuinely have nothing useful to add, return an empty array.
`;

export const SOURCE_RULES = `
CRITICAL SOURCE RULES:
- Use the supplied STG records as the primary source for treatment, investigation and referral information.
- Use the supplied EML records for medication availability.
- Never invent a medicine, dose, route, frequency or duration that is not supported by the supplied source or well-established standard practice for that exact regimen.
- If the supplied source does not contain enough information for a line, say so in "when_to_use" and add "Verify in the current official Ghana STG/EML." to source_notes.
- Clearly distinguish probable diagnoses from confirmed diagnoses.
- Flag emergencies, pregnancy concerns, severe disease and dangerous vital-sign abnormalities.
- Do not fabricate patient-specific dose calculations.
- Current official Ghana guidance may supersede older supplied material; state clearly when verification against the current official source is needed.
`;

export type ConditionRecord = {
  id: number;
  condition: string;
  chapter_number?: string | null;
  chapter?: string | null;
  printed_page?: string | null;
  source_pages?: string | null;
  symptoms?: string | null;
  signs?: string | null;
  investigations?: string | null;
  treatment?: string | null;
  referral_criteria?: string | null;
  section_text?: string | null;
};

export type MedicationRecord = {
  id?: number;
  drug: string;
  formulation?: string | null;
  strength?: string | null;
  level_of_care?: string | null;
  contraindications?: string | null;
  cautions?: string | null;
  eml_page?: string | null;
  category?: string | null;
};
