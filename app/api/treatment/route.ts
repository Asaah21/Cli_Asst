import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  clean,
  generateJson,
  getModels,
  isQuotaError,
  Plan,
  planSchema,
  TREATMENT_STRUCTURE_RULES,
  REGIMEN_VARIANT_RULES,
  EXTENDED_INFO_RULES,
  LOOKUP_DEPTH_RULES,
  CLINICAL_GROUNDING_RULES,
  asConditionHits,
  asMedicationHits,
  termsFromText,
  ConditionHit,
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
  matchedConditions: ConditionHit[]
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
      regimen_variants: [],
      alternatives: [],
      contraindications: [],
      cautions: [],
      monitoring: [],
      extended_info: [],
      paediatric: { dosing: [] },
      pregnancy_lactation: { pregnancy: "", lactation: "" },
      adjuncts: [],
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
    // 1. Retrieve candidate STG conditions (Postgres full-text search)
    // ---------------------------------------------------------

    const conditionTerms = [...new Set([conditionQuery, ...termsFromText(input.notes, 4)])].slice(0, 8);

    const { data: conditionData, error: conditionError } = await supabase.rpc("search_conditions", {
      terms: conditionTerms,
      n: 6,
    });

    if (conditionError) {
      console.error("[treatment] search_conditions failed:", conditionError);
      return NextResponse.json(
        {
          error:
            "Guideline search is unavailable — has supabase/004_search.sql been applied to this project?",
        },
        { status: 500 }
      );
    }

    const matchedConditions = asConditionHits(conditionData);

    // ---------------------------------------------------------
    // 2. Retrieve candidate medications
    // ---------------------------------------------------------

    const medicationTerms = [
      ...new Set([
        conditionQuery,
        ...matchedConditions.map((hit) => hit.condition),
        ...matchedConditions.flatMap((hit) => termsFromText(hit.treatment, 8)),
      ]),
    ].slice(0, 20);

    const { data: medicationData, error: medicationError } = await supabase.rpc("search_medications", {
      terms: medicationTerms,
      n: 30,
    });

    if (medicationError) {
      console.error("[treatment] search_medications failed:", medicationError);
      return NextResponse.json(
        {
          error:
            "Medicine search is unavailable — has supabase/004_search.sql been applied to this project?",
        },
        { status: 500 }
      );
    }

    const relevantMedications = asMedicationHits(medicationData);

    const conditionEvidence = matchedConditions.map((c) => ({
      id: c.id,
      condition: c.condition,
      printed_page: c.printed_page,
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

A clinician has typed a condition/diagnosis directly and wants its treatment WITHOUT going through a full patient assessment first. Answer for the condition actually named — do not substitute a "closest match" from the supplied records when the named condition is a real, specific diagnosis (e.g. a specific STI, a complicated UTI, a hypertensive emergency, a dog bite) that the local database simply doesn't carry; answer it properly from general clinical knowledge instead. Use the optional patient context only to flag relevant cautions (e.g. pregnancy, allergy, age-specific dosing notes) — do not re-diagnose the patient. Only fall back to a related "closest match" when the query is too vague or garbled to identify a real condition, and say so plainly in "overview". List genuinely related differentials or conditions worth distinguishing from in "related_conditions".
${TREATMENT_STRUCTURE_RULES}
${REGIMEN_VARIANT_RULES}
${LOOKUP_DEPTH_RULES}
${CLINICAL_GROUNDING_RULES}
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
