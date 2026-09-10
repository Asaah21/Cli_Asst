import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  clean,
  scoreText,
  generateJson,
  getModels,
  isQuotaError,
  MedicationRecord,
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

type DrugLookupResult = {
  drug: string;
  overview: string;
  forms: DrugForm[];
  dosages: DrugDose[];
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

const drugLookupSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "drug",
    "overview",
    "forms",
    "dosages",
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
    contraindications: { type: "array", items: { type: "string" } },
    cautions: { type: "array", items: { type: "string" } },
    related_drugs: { type: "array", items: { type: "string" } },
    extended_info: { type: "array", items: { type: "string" } },
    source_notes: { type: "array", items: { type: "string" } },
  },
};

function localDrugFallback(input: DrugLookupInput, matched: MedicationRecord[]): DrugLookupResult {
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

    const { data: allMedications, error: medicationError } = await supabase
      .from("medications")
      .select(
        [
          "drug",
          "formulation",
          "strength",
          "level_of_care",
          "contraindications",
          "cautions",
          "eml_page",
          "category",
        ].join(",")
      )
      .limit(1000);

    if (medicationError) {
      return NextResponse.json({ error: medicationError.message }, { status: 500 });
    }

    const medications = (allMedications ?? []) as unknown as MedicationRecord[];

    const matched = medications
      .map((medication) => ({
        medication,
        score: scoreText(
          drugQuery,
          [medication.drug, medication.formulation, medication.strength, medication.category].join(" ")
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.medication);

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

EXTENDED CLINICAL KNOWLEDGE — LEARNING DEEP-DIVE (shown collapsed, expanded on click):
- In "extended_info", give summarized, high-yield teaching bullets — one or two sentences each, not paragraphs: drug class and mechanism of action, common indications, key side effects, important interactions, and patient counselling points.
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
