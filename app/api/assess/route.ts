import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  clean,
  generateJson,
  getModels,
  isQuotaError,
  asConditionHits,
  asMedicationHits,
  termsFromText,
  CLINICAL_GROUNDING_RULES,
} from "@/lib/clinical/shared";
import { rxSchema, normalizeRxList, DOSE_RULE_PROMPT } from "@/lib/clinical/rx";
import { computeDose } from "@/lib/clinical/dosing";
import type { Rx, ComputedDose } from "@/lib/clinical/dosing";
import { checkSafety } from "@/lib/clinical/safety-rules";
import type { SafetyFlag } from "@/lib/clinical/safety-rules";
import { buildPatientText } from "@/lib/types";
import type { PatientInput } from "@/lib/types";

type Stage1 = {
  urgency: "Routine" | "Urgent" | "Emergency";
  red_flags: string[];
  symptoms_to_treat: string[];
  candidates: { condition: string; likelihood: "High" | "Moderate" | "Low"; why: string }[];
  search_terms: string[];
};

type Stage2Card = {
  condition: string;
  likelihood: "High" | "Moderate" | "Low";
  why: string;
  first_line: unknown[];
  alternative: unknown[];
  adjuncts: unknown[];
  non_drug: string[];
  refer_if: string[];
  source: string;
};

type Stage2 = {
  red_flags: string[];
  diagnoses: Stage2Card[];
};

type ClientRx = Rx & { computed: ComputedDose };

type DiagnosisCard = {
  condition: string;
  likelihood: "High" | "Moderate" | "Low";
  why: string;
  first_line: ClientRx[];
  alternative: ClientRx[];
  adjuncts: ClientRx[];
  non_drug: string[];
  refer_if: string[];
  source: string;
  safety_flags: SafetyFlag[];
};

const stage1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["urgency", "red_flags", "symptoms_to_treat", "candidates", "search_terms"],
  properties: {
    urgency: { type: "string", enum: ["Routine", "Urgent", "Emergency"] },
    red_flags: { type: "array", items: { type: "string" } },
    symptoms_to_treat: { type: "array", items: { type: "string" } },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "likelihood", "why"],
        properties: {
          condition: { type: "string" },
          likelihood: { type: "string", enum: ["High", "Moderate", "Low"] },
          why: { type: "string" },
        },
      },
    },
    search_terms: { type: "array", items: { type: "string" } },
  },
};

const stage2Schema = {
  type: "object",
  additionalProperties: false,
  required: ["red_flags", "diagnoses"],
  properties: {
    red_flags: { type: "array", items: { type: "string" } },
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "condition",
          "likelihood",
          "why",
          "first_line",
          "alternative",
          "adjuncts",
          "non_drug",
          "refer_if",
          "source",
        ],
        properties: {
          condition: { type: "string" },
          likelihood: { type: "string", enum: ["High", "Moderate", "Low"] },
          why: { type: "string" },
          first_line: { type: "array", items: rxSchema },
          alternative: { type: "array", items: rxSchema },
          adjuncts: { type: "array", items: rxSchema },
          non_drug: { type: "array", items: { type: "string" } },
          refer_if: { type: "array", items: { type: "string" } },
          source: { type: "string" },
        },
      },
    },
  },
};

const strings = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => clean(entry))
        .filter(Boolean)
        .slice(0, limit)
    : [];

async function generateWithFallback<T>(
  ai: GoogleGenAI,
  primary: string,
  fallback: string,
  schema: unknown,
  prompt: string
): Promise<{ data: T; model: string }> {
  try {
    return { data: await generateJson<T>(ai, primary, schema, prompt), model: primary };
  } catch (error) {
    if (isQuotaError(error)) throw error;
    return { data: await generateJson<T>(ai, fallback, schema, prompt), model: fallback };
  }
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

    const patient = (await req.json()) as PatientInput;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    const { primaryModel, fallbackModel } = getModels();
    const ai = new GoogleGenAI({ apiKey });
    const patientText = buildPatientText(patient);

    // ---------------------------------------------------------------------
    // Stage 1 — reasoning and search terms. No reference records yet.
    // ---------------------------------------------------------------------

    const stage1Prompt = `
You are a clinical decision-support assistant working alongside a clinician in a Ghanaian health facility, mid-consultation with the patient in front of them.

Read the whole encounter, not just the chief complaint. The complaint may be vague ("waist pain").

Return:
- urgency: Routine, Urgent or Emergency.
- red_flags: at most 4 genuinely urgent findings. Empty array when there are none — do not pad.
- symptoms_to_treat: the symptoms that themselves need symptomatic cover, e.g. ["Fever", "Vomiting", "Severe pain"].
- candidates: 2 to 4 plausible diagnoses, each with a ONE-sentence reason.
- search_terms: 5 to 8 terms for searching the Ghana Standard Treatment Guidelines.

SEARCH TERMS MATTER MOST. The guideline is indexed by its own chapter language, not the patient's words. The patient says "waist pain"; the STG says "low back pain" or "pyelonephritis". Emit the terms a Ghanaian STG chapter heading would use, plus the candidate condition names and their common synonyms. Single clinical terms or short phrases, not sentences.

PATIENT:
${patientText}
`;

    let stage1: Stage1;
    let aiModelUsed = primaryModel;

    try {
      const result = await generateWithFallback<Stage1>(
        ai,
        primaryModel,
        fallbackModel,
        stage1Schema,
        stage1Prompt
      );
      stage1 = result.data;
      aiModelUsed = result.model;
    } catch (error) {
      console.error("[assess] Stage 1 failed:", error);
      return NextResponse.json(
        {
          error: isQuotaError(error)
            ? "The AI service is rate limited right now. Try again shortly."
            : "Clinical reasoning is temporarily unavailable. Try again shortly.",
        },
        { status: 503 }
      );
    }

    // ---------------------------------------------------------------------
    // Retrieval — Postgres full-text search over the whole guideline.
    // ---------------------------------------------------------------------

    const searchTerms = strings(stage1.search_terms, 8);
    const candidateNames = (stage1.candidates ?? []).map((item) => clean(item.condition)).filter(Boolean);
    const symptomsToTreat = strings(stage1.symptoms_to_treat, 6);

    const conditionTerms = [...new Set([...searchTerms, ...candidateNames])].slice(0, 12);

    const { data: conditionData, error: conditionError } = await supabase.rpc("search_conditions", {
      terms: conditionTerms.length ? conditionTerms : ["general"],
      n: 6,
    });

    if (conditionError) {
      console.error("[assess] search_conditions failed:", conditionError);
      return NextResponse.json(
        {
          error:
            "Guideline search is unavailable — has supabase/004_search.sql been applied to this project?",
        },
        { status: 500 }
      );
    }

    const conditions = asConditionHits(conditionData);

    const medicationTerms = [
      ...new Set([
        ...candidateNames,
        ...symptomsToTreat,
        ...conditions.flatMap((hit) => termsFromText(hit.treatment, 8)),
      ]),
    ].slice(0, 24);

    const { data: medicationData, error: medicationError } = await supabase.rpc("search_medications", {
      terms: medicationTerms.length ? medicationTerms : ["analgesic"],
      n: 30,
    });

    if (medicationError) {
      console.error("[assess] search_medications failed:", medicationError);
      return NextResponse.json(
        {
          error:
            "Medicine search is unavailable — has supabase/004_search.sql been applied to this project?",
        },
        { status: 500 }
      );
    }

    const medications = asMedicationHits(medicationData);

    const conditionEvidence = conditions.map((hit) => ({
      condition: hit.condition,
      printed_page: hit.printed_page,
      symptoms: hit.symptoms,
      signs: hit.signs,
      investigations: hit.investigations,
      treatment: hit.treatment,
      referral_criteria: hit.referral_criteria,
    }));

    const medicationEvidence = medications.map((hit) => ({
      drug: hit.drug,
      formulation: hit.formulation,
      strength: hit.strength,
      category: hit.category,
    }));

    // ---------------------------------------------------------------------
    // Stage 2 — grounded prescription.
    // ---------------------------------------------------------------------

    const stage2Prompt = `
You are prescribing alongside a clinician mid-consultation. Be brief and directly usable — this is not a reference article.

Return 2 or 3 diagnoses. Never 1, never more than 3. When the picture is clear, the second and third are the differentials genuinely worth excluding — say so in "why" rather than padding.

For each diagnosis:
- "why": ONE sentence, 25 words maximum.
- "first_line": 1 to 3 medicines that actually treat the condition.
- "alternative": usually empty. Populate only when an allergy or a contraindication makes the first line unsuitable.
- "adjuncts": symptomatic cover. MANDATORY where symptoms warrant it — for every symptom listed in SYMPTOMS TO TREAT below, include a matching medicine with "purpose" set: antipyretic for fever, analgesic for pain, antiemetic for vomiting, ORS and zinc for diarrhoea in children, antihistamine for itch, antispasmodic for colic. A prescription without them is incomplete. Never repeat a drug that already appears in first_line.
- "non_drug": at most 3 short phrases.
- "refer_if": at most 3 short phrases.
- "source": when one of the STG records below covers this condition, use "Ghana STG p.<printed_page>" with that record's printed_page and prefer its regimen. When the STG is silent, answer fully from WHO, CDC/IDSA, NICE or standard practice and name which.
${DOSE_RULE_PROMPT}
${CLINICAL_GROUNDING_RULES}

PATIENT:
${patientText}

CLINICAL REASONING SO FAR:
${JSON.stringify({
  urgency: stage1.urgency,
  red_flags: stage1.red_flags,
  candidates: stage1.candidates,
})}

SYMPTOMS TO TREAT (each needs an adjunct):
${JSON.stringify(symptomsToTreat)}

GHANA STG RECORDS RETRIEVED:
${JSON.stringify(conditionEvidence)}

MEDICINES AVAILABLE IN THE ESSENTIAL MEDICINES LIST:
${JSON.stringify(medicationEvidence)}
`;

    let stage2: Stage2;

    try {
      const result = await generateWithFallback<Stage2>(
        ai,
        primaryModel,
        fallbackModel,
        stage2Schema,
        stage2Prompt
      );
      stage2 = result.data;
      aiModelUsed = result.model;
    } catch (error) {
      console.error("[assess] Stage 2 failed:", error);
      return NextResponse.json(
        {
          error: isQuotaError(error)
            ? "The AI service is rate limited right now. Try again shortly."
            : "Treatment reasoning is temporarily unavailable. Try again shortly.",
        },
        { status: 503 }
      );
    }

    // ---------------------------------------------------------------------
    // Post-processing: safety rules and dose arithmetic, both in code.
    // ---------------------------------------------------------------------

    const withDoses = (list: Rx[]): ClientRx[] =>
      list.map((rx) => ({ ...rx, computed: computeDose(rx, patient) }));

    const noStgMatch = conditions.length === 0;

    const diagnoses: DiagnosisCard[] = (stage2.diagnoses ?? []).slice(0, 3).map((card) => {
      const firstLine = normalizeRxList(card.first_line).slice(0, 3);
      const alternative = normalizeRxList(card.alternative);
      const adjuncts = normalizeRxList(card.adjuncts);

      return {
        condition: clean(card.condition),
        likelihood: card.likelihood === "High" || card.likelihood === "Low" ? card.likelihood : "Moderate",
        why: clean(card.why),
        first_line: withDoses(firstLine),
        alternative: withDoses(alternative),
        adjuncts: withDoses(adjuncts),
        non_drug: strings(card.non_drug, 3),
        refer_if: strings(card.refer_if, 3),
        source: noStgMatch ? "Standard practice" : clean(card.source) || "Standard practice",
        safety_flags: checkSafety([...firstLine, ...alternative, ...adjuncts], patient),
      };
    });

    const result = {
      urgency: stage1.urgency,
      red_flags: strings(stage2.red_flags, 4).length
        ? strings(stage2.red_flags, 4)
        : strings(stage1.red_flags, 4),
      diagnoses,
    };

    const { data: consultation, error: saveError } = await supabase
      .from("consultations")
      .insert({
        clinician_id: user.id,
        patient_input: patient,
        patient_data: patient,
        assessment: { ...result, stage1_reasoning: stage1 },
        source_condition_ids: conditions.map((hit) => hit.id),
        ai_model: aiModelUsed,
      })
      .select("id")
      .single();

    if (saveError) {
      console.error("[assess] Consultation save error:", saveError);
    }

    return NextResponse.json({
      result,
      consultationId: consultation?.id ?? null,
      aiModel: aiModelUsed,
    });
  } catch (error) {
    console.error("Assessment error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Assessment failed" },
      { status: 500 }
    );
  }
}
