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

export type RegimenVariant = {
  style: string;
  regimens: string[];
  rationale: string;
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
  },
};

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
- Treat the supplied Ghana STG/EML records as the first reference when they cover the condition or drug — prefer them when present.
- When the supplied records are thin, silent, or simply don't cover the case (this is common for STIs, complicated/recurrent UTIs, RTIs, hypertensive emergencies/urgencies, animal and dog bites, less textbook presentations, etc.), do NOT say there isn't enough information and do NOT push the clinician to "confirm in the Ghana STG" — instead answer fully and confidently from established international clinical practice (WHO guidance, Ghana Health Service updates, and mainstream evidence-based guidelines such as US CDC/IDSA or UK NICE), and simply name which tradition a regimen reflects (e.g. "Ghana STG", "WHO", "CDC/IDSA", "standard practice") rather than hedging.
- Give complete, directly usable pharmacological AND non-pharmacological management for whatever condition or drug is asked about, including complex or specialist-adjacent conditions, rather than deferring or truncating the answer.
- Never invent a dose/route/frequency/duration that isn't grounded in the supplied source or genuinely standard, citable clinical practice.
- Clearly distinguish probable from confirmed diagnoses, and flag emergencies, pregnancy concerns, severe disease and dangerous vital signs plainly within the content itself.
- Do not fabricate patient-specific dose calculations.
- Do not pad every item with "verify locally" or similar hedges — the application shows one overall safety notice already; your job is the most complete, confident, directly usable clinical answer you can give.
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
