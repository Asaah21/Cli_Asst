import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  clean,
  generateJson,
  getModels,
  isQuotaError,
  asMedicationHits,
  MedicationHit,
} from "@/lib/clinical/shared";

type DrugLookupInput = {
  drug: string;
};

type DrugForm = {
  formulation: string;
  strength: string;
  level_of_care: string;
};

type DrugDose = {
  indication: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  source: string;
};

type PaediatricDose = {
  age_band: string;
  dose: string;
  frequency: string;
  max: string;
  note?: string;
};

type DrugLookupResult = {
  drug: string;
  overview: string;
  forms: DrugForm[];
  dosages: DrugDose[];
  paediatric_dosing: PaediatricDose[];
  pregnancy_lactation: { pregnancy: string; lactation: string };
  renal_hepatic: string[];
  interactions: string[];
  contraindications: string[];
  cautions: string[];
  related_drugs: string[];
  extended_info: string[];
  source_notes: string[];
};

const formSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formulation", "strength", "level_of_care"],
  properties: {
    formulation: { type: "string" },
    strength: { type: "string" },
    level_of_care: { type: "string" },
  },
};

const doseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["indication", "dose", "route", "frequency", "duration", "source"],
  properties: {
    indication: { type: "string" },
    dose: { type: "string" },
    route: { type: "string" },
    frequency: { type: "string" },
    duration: { type: "string" },
    source: { type: "string" },
  },
};

const paediatricDoseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["age_band", "dose", "frequency", "max"],
  properties: {
    age_band: { type: "string" },
    dose: { type: "string" },
    frequency: { type: "string" },
    max: { type: "string" },
    note: { type: "string", nullable: true },
  },
};

const drugLookupSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "drug",
    "overview",
    "forms",
    "dosages",
    "paediatric_dosing",
    "pregnancy_lactation",
    "renal_hepatic",
    "interactions",
    "contraindications",
    "cautions",
    "related_drugs",
    "extended_info",
    "source_notes",
  ],
  properties: {
    drug: { type: "string" },
    overview: { type: "string" },
    forms: { type: "array", items: formSchema },
    dosages: { type: "array", items: doseSchema },
    paediatric_dosing: { type: "array", items: paediatricDoseSchema },
    pregnancy_lactation: {
      type: "object",
      additionalProperties: false,
      required: ["pregnancy", "lactation"],
      properties: {
        pregnancy: { type: "string" },
        lactation: { type: "string" },
      },
    },
    renal_hepatic: { type: "array", items: { type: "string" } },
    interactions: { type: "array", items: { type: "string" } },
    contraindications: { type: "array", items: { type: "string" } },
    cautions: { type: "array", items: { type: "string" } },
    related_drugs: { type: "array", items: { type: "string" } },
    extended_info: { type: "array", items: { type: "string" } },
    source_notes: { type: "array", items: { type: "string" } },
  },
};

function localDrugFallback(input: DrugLookupInput, matched: MedicationHit[]): DrugLookupResult {
  const top = matched[0];

  return {
    drug: top?.drug ?? input.drug,
    overview: top
      ? "AI reasoning is temporarily unavailable. Showing the raw matched EML record(s) for clinician review."
      : "AI reasoning is temporarily unavailable and no close EML match was found for this drug.",
    forms: matched.slice(0, 8).map((m) => ({
      formulation: clean(m.formulation) || "Not specified",
      strength: clean(m.strength) || "Not specified",
      level_of_care: clean(m.level_of_care) || "Not specified",
    })),
    dosages: [],
    paediatric_dosing: [],
    pregnancy_lactation: { pregnancy: "", lactation: "" },
    renal_hepatic: [],
    interactions: [],
    contraindications: matched.flatMap((m) => (m.contraindications ? [clean(m.contraindications)] : [])).slice(0, 6),
    cautions: matched.flatMap((m) => (m.cautions ? [clean(m.cautions)] : [])).slice(0, 6),
    related_drugs: [],
    extended_info: [],
    source_notes: [
      "AI unavailable.",
      "Dosing was not returned because it could not be verified. Refer to the current EML/product literature.",
    ],
  };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const input = (await req.json()) as DrugLookupInput;
    const drugQuery = clean(input?.drug);

    if (!drugQuery) {
      return NextResponse.json({ error: "A drug name is required." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    const { primaryModel, fallbackModel } = getModels();
    const ai = new GoogleGenAI({ apiKey });

    // ---------------------------------------------------------
    // 1. Retrieve candidate EML medication records for this drug
    // ---------------------------------------------------------

    const { data: medicationData, error: medicationError } = await supabase.rpc("search_medications", {
      terms: [drugQuery],
      n: 10,
    });

    if (medicationError) {
      console.error("[drug] search_medications failed:", medicationError);
      return NextResponse.json(
        {
          error:
            "Medicine search is unavailable — has supabase/004_search.sql been applied to this project?",
        },
        { status: 500 }
      );
    }

    const matched = asMedicationHits(medicationData);

    // ---------------------------------------------------------
    // 2. Single-stage AI lookup for a brief description, forms and dosages
    // ---------------------------------------------------------

    const prompt = `
You are a clinical decision-support assistant for a Ghanaian health facility.

A clinician has typed a drug name directly and wants a quick reference: what it is, what forms/strengths are available, and how it is typically dosed.

CLINICAL GROUNDING RULES:
- The supplied EML records are the first reference for which formulations, strengths and levels of care are actually stocked locally — use them for "forms" when present. If a formulation/strength isn't in the supplied records, don't claim it's locally stocked, but still mention it if it's a real, commonly used form.
- The supplied EML records do NOT contain dosing schedules. Populate "dosages" fully from well-established standard clinical dosing practice for that exact drug — do not hold back or say dosing is unavailable.
- Where genuinely different dosing approaches exist (e.g. a shorter higher-dose course vs. a longer standard course, single-dose vs. multi-day, adult vs. pediatric, an alternative from a different guideline tradition), give multiple entries in "dosages" rather than picking just one, and name the tradition/source each reflects in that entry's "source" field (e.g. "Ghana EML/standard practice", "WHO", "CDC/IDSA", "shorter-course option").
- If the named drug does not closely match any supplied EML record, answer fully from general clinical knowledge anyway — say plainly in "overview" that it wasn't found in the supplied EML extract, but do not refuse or truncate the rest of the answer over that.
- Never state a specific patient's dose calculation; give standard adult (and, if relevant, standard pediatric/pregnancy caution) dosing ranges only.
- List genuine contraindications and cautions; do not fabricate ones not supported by the supplied records or well-established practice.
- Do not pad every entry with "verify locally" — the app already shows one overall safety notice; give the most complete, directly usable answer you can.
- "related_drugs" should list other supplied EML entries that are therapeutic alternatives or commonly confused/similarly named drugs, if any.

REFERENCE DEPTH (this is a reference tool — fill these substantively, never with one generic line):
- "paediatric_dosing": one entry per age band the drug is actually dosed by (e.g. "Neonate", "1-5 years", "Over 12 years"), each with dose (state weight-based dosing as a RULE, e.g. "15 mg/kg/dose"), frequency, max, and a note where one matters. There is no patient here — never resolve a rule into a specific figure.
- "pregnancy_lactation": trimester-specific guidance where it differs, and whether it is compatible with breastfeeding.
- "renal_hepatic": dose adjustment guidance. Empty array when no adjustment is needed.
- "interactions": clinically significant interactions only, at most 6.
- "contraindications" and "cautions": fill both substantively.

EXTENDED CLINICAL KNOWLEDGE — LEARNING DEEP-DIVE (shown collapsed, expanded on click):
- In "extended_info", give summarized, high-yield teaching bullets — one or two sentences each, not paragraphs: drug class and mechanism of action, common indications, key side effects, and patient counselling points.
- Draw on your general medical knowledge freely here. It is supplementary education, not a source-verified prescription.

DRUG QUERY:
${drugQuery}

CANDIDATE EML RECORDS:
${JSON.stringify(matched)}

Return the structured result. "overview" should be 2-3 sentences: what the drug is and its main use(s).
`;

    let result: DrugLookupResult;
    let aiModelUsed = primaryModel;

    try {
      result = await generateJson<DrugLookupResult>(ai, primaryModel, drugLookupSchema, prompt);
    } catch (primaryError) {
      console.error("[Gemini] Drug lookup primary failed:", primaryError);

      if (isQuotaError(primaryError)) {
        result = localDrugFallback(input, matched);
        aiModelUsed = "reference-only";
      } else {
        try {
          result = await generateJson<DrugLookupResult>(ai, fallbackModel, drugLookupSchema, prompt);
          aiModelUsed = fallbackModel;
        } catch (fallbackError) {
          console.error("[Gemini] Drug lookup fallback failed:", fallbackError);
          result = localDrugFallback(input, matched);
          aiModelUsed = "reference-only";
        }
      }
    }

    return NextResponse.json({
      result,
      evidence: { medications: matched },
      aiModel: aiModelUsed,
    });
  } catch (error) {
    console.error("Drug lookup error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Drug lookup failed",
      },
      { status: 500 }
    );
  }
}
