import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  clean,
  scoreText,
  generateJson,
  getModels,
  isQuotaError,
  Plan,
  planSchema,
  TREATMENT_STRUCTURE_RULES,
  EXTENDED_INFO_RULES,
  SOURCE_RULES,
  ConditionRecord,
  MedicationRecord,
} from "@/lib/clinical/shared";

type LookupInput = {
  condition: string;
  age?: number | null;
  sex?: string;
  weight?: number | null;
  pregnancy?: string;
  allergies?: string;
  notes?: string;
};

type LookupResult = {
  condition: string;
  overview: string;
  plan: Plan;
  related_conditions: string[];
  source_notes: string[];
};

const lookupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["condition", "overview", "plan", "related_conditions", "source_notes"],
  properties: {
    condition: { type: "string" },
    overview: { type: "string" },
    plan: planSchema,
    related_conditions: { type: "array", items: { type: "string" } },
    source_notes: { type: "array", items: { type: "string" } },
  },
};

function buildContextText(input: LookupInput) {
  return [
    `Condition/query: ${input.condition}`,
    `Age: ${input.age ?? "not provided"}`,
    `Sex: ${input.sex ?? "not provided"}`,
    `Weight: ${input.weight ?? "not provided"} kg`,
    `Pregnancy: ${input.pregnancy ?? "not provided"}`,
    `Allergies: ${input.allergies ?? "not provided"}`,
    `Extra notes: ${input.notes ?? "not provided"}`,
  ].join("\n");
}

function localLookupFallback(
  input: LookupInput,
  matchedConditions: ConditionRecord[]
): LookupResult {
  const top = matchedConditions[0];

  return {
    condition: top?.condition ?? input.condition,
    overview: top
      ? "AI reasoning is temporarily unavailable. Showing the raw matched STG record for clinician review."
      : "AI reasoning is temporarily unavailable and no close STG match was found for this condition.",
    plan: {
      condition: top?.condition ?? input.condition,
      lines: top?.treatment
        ? [
            {
              label: "From STG record",
              order: 1,
              regimens: [clean(top.treatment)],
              when_to_use:
                "AI grounding was unavailable; this is the raw STG treatment text for clinician review.",
            },
          ]
        : [],
      alternatives: [],
      contraindications: [],
      cautions: [],
      monitoring: [],
      extended_info: [],
    },
    related_conditions: matchedConditions.slice(1, 5).map((c) => c.condition),
    source_notes: [
      "AI unavailable.",
      "Treatment should be verified against the current official Ghana STG/EML.",
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

    const input = (await req.json()) as LookupInput;

    const conditionQuery = clean(input?.condition);

    if (!conditionQuery) {
      return NextResponse.json({ error: "A condition name is required." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    const { primaryModel, fallbackModel } = getModels();
    const ai = new GoogleGenAI({ apiKey });

    const contextText = buildContextText(input);

    // ---------------------------------------------------------
    // 1. Retrieve candidate STG conditions matching the free-text query
    // ---------------------------------------------------------

    const { data: allConditions, error: conditionError } = await supabase
      .from("conditions")
      .select(
        [
          "id",
          "condition",
          "chapter_number",
          "chapter",
          "printed_page",
          "source_pages",
          "symptoms",
          "signs",
          "investigations",
          "treatment",
          "referral_criteria",
          "section_text",
        ].join(",")
      )
      .limit(500);

    if (conditionError) {
      return NextResponse.json({ error: conditionError.message }, { status: 500 });
    }

    const conditions = (allConditions ?? []) as unknown as ConditionRecord[];

    const matchedConditions = conditions
      .map((condition) => ({
        condition,
        score: scoreText(
          contextText,
          [
            condition.condition,
            condition.symptoms,
            condition.signs,
            condition.investigations,
            condition.treatment,
          ].join(" ")
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.condition);

    // ---------------------------------------------------------
    // 2. Retrieve candidate medications
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
      .in("level_of_care", ["B2", "C"])
      .limit(1000);

    if (medicationError) {
      return NextResponse.json({ error: medicationError.message }, { status: 500 });
    }

    const medications = (allMedications ?? []) as unknown as MedicationRecord[];

    const medicationSearchText = [
      conditionQuery,
      ...matchedConditions.map((c) => c.condition),
      ...matchedConditions.map((c) => c.treatment),
    ].join(" ");

    const relevantMedications = medications
      .map((medication) => ({
        medication,
        score: scoreText(
          medicationSearchText,
          [medication.drug, medication.formulation, medication.strength, medication.category].join(" ")
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.medication);

    const conditionEvidence = matchedConditions.map((c) => ({
      id: c.id,
      condition: c.condition,
      symptoms: c.symptoms,
      signs: c.signs,
      investigations: c.investigations,
      treatment: c.treatment,
      referral_criteria: c.referral_criteria,
      source_pages: c.source_pages,
    }));

    // ---------------------------------------------------------
    // 3. Single-stage AI lookup: no patient assessment needed,
    //    the clinician already named the condition directly.
    // ---------------------------------------------------------

    const prompt = `
You are a clinical decision-support assistant for a Ghanaian health facility.

A clinician has typed a condition/diagnosis directly and wants its treatment WITHOUT going through a full patient assessment first. Answer for the condition named, using the optional patient context only to flag relevant cautions (e.g. pregnancy, allergy, age-specific dosing notes) — do not re-diagnose the patient.

If the named condition does not closely match any supplied STG record, use the closest reasonable match and say so in "overview", and list other close possibilities in "related_conditions".
${TREATMENT_STRUCTURE_RULES}
${SOURCE_RULES}
${EXTENDED_INFO_RULES}

REQUEST:
${contextText}

CANDIDATE STG RECORDS:
${JSON.stringify(conditionEvidence)}

CANDIDATE MEDICATION RECORDS (background context only):
${JSON.stringify(relevantMedications)}

Return the structured result. "overview" should be 2-4 sentences describing what the condition is and how it typically presents.
`;

    let result: LookupResult;
    let aiModelUsed = primaryModel;

    try {
      result = await generateJson<LookupResult>(ai, primaryModel, lookupSchema, prompt);
    } catch (primaryError) {
      console.error("[Gemini] Treatment lookup primary failed:", primaryError);

      if (isQuotaError(primaryError)) {
        result = localLookupFallback(input, matchedConditions);
        aiModelUsed = "reference-only";
      } else {
        try {
          result = await generateJson<LookupResult>(ai, fallbackModel, lookupSchema, prompt);
          aiModelUsed = fallbackModel;
        } catch (fallbackError) {
          console.error("[Gemini] Treatment lookup fallback failed:", fallbackError);
          result = localLookupFallback(input, matchedConditions);
          aiModelUsed = "reference-only";
        }
      }
    }

    return NextResponse.json({
      result,
      evidence: {
        conditions: conditionEvidence,
        medications: relevantMedications,
      },
      aiModel: aiModelUsed,
    });
  } catch (error) {
    console.error("Treatment lookup error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Treatment lookup failed",
      },
      { status: 500 }
    );
  }
}
