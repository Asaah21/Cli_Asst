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

type PatientInput = {
  age?: number | null;
  sex?: string;
  weight?: number | null;
  pregnancy?: string;
  allergies?: string;
  temp?: number | null;
  bp?: string;
  pulse?: number | null;
  rr?: number | null;
  spo2?: number | null;
  rbs?: string;
  hb?: string;
  complaints?: string;
  extra?: string;
  tests?: string;
  history?: string;
  examination?: string;
  signs?: string;
  duration?: string;
  facilityLevel?: "C";
  preferredLevel?: "B2";
};

type Stage1Assessment = {
  clinical_summary: string;
  urgency: string;
  red_flags: string[];
  missing_information: string[];
  possible_diagnoses: Array<{
    condition: string;
    likelihood: string;
    supporting_findings: string[];
    findings_against: string[];
  }>;
  questions: string[];
  tests: Array<{
    test: string;
    reason: string;
    priority: string;
  }>;
  immediate_actions: string[];
};

type FinalAssessment = {
  summary: string;
  urgency: string;
  red_flags: string[];
  questions: string[];
  possible_diagnoses: Array<{
    condition: string;
    why: string;
    confidence: string;
  }>;
  tests: Array<{
    test: string;
    reason: string;
    priority: string;
  }>;
  plans: Plan[];
  disposition: string;
  source_notes: string[];
};

const stage1Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "clinical_summary",
    "urgency",
    "red_flags",
    "missing_information",
    "possible_diagnoses",
    "questions",
    "tests",
    "immediate_actions",
  ],
  properties: {
    clinical_summary: { type: "string" },
    urgency: { type: "string" },
    red_flags: {
      type: "array",
      items: { type: "string" },
    },
    missing_information: {
      type: "array",
      items: { type: "string" },
    },
    possible_diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "condition",
          "likelihood",
          "supporting_findings",
          "findings_against",
        ],
        properties: {
          condition: { type: "string" },
          likelihood: { type: "string" },
          supporting_findings: {
            type: "array",
            items: { type: "string" },
          },
          findings_against: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
    questions: {
      type: "array",
      items: { type: "string" },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["test", "reason", "priority"],
        properties: {
          test: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string" },
        },
      },
    },
    immediate_actions: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const finalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "urgency",
    "red_flags",
    "questions",
    "possible_diagnoses",
    "tests",
    "plans",
    "disposition",
    "source_notes",
  ],
  properties: {
    summary: { type: "string" },
    urgency: { type: "string" },
    red_flags: {
      type: "array",
      items: { type: "string" },
    },
    questions: {
      type: "array",
      items: { type: "string" },
    },
    possible_diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "why", "confidence"],
        properties: {
          condition: { type: "string" },
          why: { type: "string" },
          confidence: { type: "string" },
        },
      },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["test", "reason", "priority"],
        properties: {
          test: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string" },
        },
      },
    },
    plans: {
      type: "array",
      items: planSchema,
    },
    disposition: { type: "string" },
    source_notes: {
      type: "array",
      items: { type: "string" },
    },
  },
};

function buildPatientText(patient: PatientInput) {
  return [
    `Age: ${patient.age ?? "not provided"}`,
    `Sex: ${patient.sex ?? "not provided"}`,
    `Weight: ${patient.weight ?? "not provided"} kg`,
    `Pregnancy: ${patient.pregnancy ?? "not provided"}`,
    `Allergies: ${patient.allergies ?? "not provided"}`,
    `Temperature: ${patient.temp ?? "not provided"}`,
    `BP: ${patient.bp ?? "not provided"}`,
    `Pulse: ${patient.pulse ?? "not provided"}`,
    `RR: ${patient.rr ?? "not provided"}`,
    `SpO2: ${patient.spo2 ?? "not provided"}`,
    `RBS: ${patient.rbs ?? "not provided"}`,
    `Hb: ${patient.hb ?? "not provided"}`,
    `Complaints: ${patient.complaints ?? "not provided"}`,
    `Signs: ${patient.signs ?? "not provided"}`,
    `Duration: ${patient.duration ?? "not provided"}`,
    `History: ${patient.history ?? "not provided"}`,
    `Examination: ${patient.examination ?? "not provided"}`,
    `Extra information: ${patient.extra ?? "not provided"}`,
    `Tests/results: ${patient.tests ?? "not provided"}`,
  ].join("\n");
}

function localConditionFallback(
  patient: PatientInput,
  conditions: ConditionRecord[]
): FinalAssessment {
  const patientText = buildPatientText(patient);

  const ranked = conditions
    .map((condition) => ({
      condition,
      score: scoreText(
        patientText,
        [
          condition.condition,
          condition.symptoms,
          condition.signs,
          condition.investigations,
        ].join(" ")
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return {
    summary:
      "AI reasoning is temporarily unavailable. Showing relevant clinical reference matches from the STG database.",
    urgency: "Clinician review required",
    red_flags: [],
    questions: [
      "Clarify onset, duration and progression.",
      "Ask about associated fever or chills.",
      "Ask about urinary symptoms where relevant.",
      "Ask about pregnancy possibility where relevant.",
      "Ask about trauma or physical exertion.",
      "Review allergies, previous illnesses and current medicines.",
    ],
    possible_diagnoses: ranked.map((item) => ({
      condition: item.condition.condition,
      confidence:
        item.score >= 5
          ? "moderate"
          : item.score >= 2
            ? "low"
            : "very low",
      why: "Relevant symptoms/signs were found in the supplied STG reference.",
    })),
    tests: ranked
      .slice(0, 4)
      .flatMap((item) => {
        const investigation = clean(item.condition.investigations);

        return investigation
          ? [
              {
                test: investigation,
                reason: "Investigation listed in the supplied STG record.",
                priority: "Consider",
              },
            ]
          : [];
      }),
    plans: ranked.slice(0, 4).map((item) => ({
      condition: item.condition.condition,
      lines: item.condition.treatment
        ? [
            {
              label: "From STG record",
              order: 1,
              regimens: [clean(item.condition.treatment)],
              when_to_use: "AI grounding was unavailable; this is the raw STG treatment text for clinician review.",
            },
          ]
        : [],
      alternatives: [],
      contraindications: [],
      cautions: [],
      monitoring: [],
      extended_info: [],
    })),
    disposition:
      "Use the applicable current Ghana guideline and clinician assessment. AI is unavailable.",
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

    const patient = (await req.json()) as PatientInput;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    const { primaryModel, fallbackModel } = getModels();

    const ai = new GoogleGenAI({ apiKey });

    const patientText = buildPatientText(patient);

    // ---------------------------------------------------------
    // 1. Get the structured clinical reference data from Supabase
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

    // ---------------------------------------------------------
    // 2. Stage 1: AI clinical reasoning
    // ---------------------------------------------------------

    let stage1: Stage1Assessment;

    const stage1Prompt = `
You are a cautious clinical decision-support assistant for a Ghanaian health facility.

Interpret the WHOLE encounter, not merely the chief complaint.

Use:
- age
- sex
- pregnancy status
- weight
- BP
- temperature
- pulse
- respiratory rate
- SpO2
- RBS
- Hb
- symptoms
- signs
- duration
- history
- examination
- existing tests/results

The complaint may be vague, for example "waist pain".

Your job at this stage is ONLY clinical reasoning.

Do NOT prescribe medicines.

Identify:
1. The most plausible diagnoses.
2. Why each is being considered.
3. Findings against each possibility.
4. Missing information.
5. Targeted questions that would change the differential.
6. Useful simple tests available in the clinic.
7. Red flags and immediate concerns.

Do not claim a diagnosis is confirmed.

PATIENT ENCOUNTER:

${patientText}
`;

    try {
      stage1 = await generateJson<Stage1Assessment>(ai, primaryModel, stage1Schema, stage1Prompt);
    } catch (primaryError) {
      console.error("[Gemini] Stage 1 primary failed:", primaryError);

      if (isQuotaError(primaryError)) {
        stage1 = localConditionFallback(patient, conditions) as unknown as Stage1Assessment;
      } else {
        try {
          stage1 = await generateJson<Stage1Assessment>(ai, fallbackModel, stage1Schema, stage1Prompt);
        } catch (fallbackError) {
          console.error("[Gemini] Stage 1 fallback failed:", fallbackError);

          stage1 = localConditionFallback(patient, conditions) as unknown as Stage1Assessment;
        }
      }
    }

    // ---------------------------------------------------------
    // 3. Match stage-1 diagnoses against STG records
    // ---------------------------------------------------------

    const diagnosisTerms = (stage1.possible_diagnoses ?? []).flatMap((item) => [
      item.condition,
      ...(item.supporting_findings ?? []),
    ]);

    const expandedSearchText = [patientText, ...diagnosisTerms].join(" ");

    const finalConditions = conditions
      .map((condition) => ({
        condition,
        score: scoreText(
          expandedSearchText,
          [
            condition.condition,
            condition.symptoms,
            condition.signs,
            condition.investigations,
            condition.treatment,
            condition.referral_criteria,
          ].join(" ")
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.condition);

    // ---------------------------------------------------------
    // 4. Get medication database and rank medicines locally
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
      ...(stage1.possible_diagnoses ?? []).map((x) => x.condition),
      ...finalConditions.map((x) => x.condition),
      ...finalConditions.map((x) => x.treatment),
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
      .slice(0, 60)
      .map((x) => x.medication);

    // ---------------------------------------------------------
    // 5. Evidence text kept deliberately small
    // ---------------------------------------------------------

    const conditionEvidence = finalConditions.map((c) => ({
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
    // 6. Stage 2: evidence-grounded treatment reasoning
    // ---------------------------------------------------------

    const stage2Prompt = `
You are the evidence-grounding stage of a clinical decision-support application for a Ghanaian health facility.

FACILITY CONTEXT:
- Facility level: C (a facility that prefers B2-level options when they are adequate).
- Facility observation is normally up to 24 hours; this is an operational constraint and NOT a clinical treatment rule.
${TREATMENT_STRUCTURE_RULES}
${SOURCE_RULES}
- Do not automatically turn a negative test into a diagnosis.
- Ask only useful questions that can change the assessment.
- Recommend only useful/simple tests relevant to the differential.
${EXTENDED_INFO_RULES}

PATIENT:
${patientText}

STAGE 1 CLINICAL REASONING:
${JSON.stringify(stage1)}

RELEVANT STG RECORDS:
${JSON.stringify(conditionEvidence)}

RELEVANT MEDICATION RECORDS (with level_of_care available only as background context):
${JSON.stringify(relevantMedications)}

Return the structured result.
`;

    let finalAssessment: FinalAssessment;
    let aiModelUsed = primaryModel;

    try {
      finalAssessment = await generateJson<FinalAssessment>(ai, primaryModel, finalSchema, stage2Prompt);
    } catch (primaryError) {
      console.error("[Gemini] Stage 2 primary failed:", primaryError);

      try {
        finalAssessment = await generateJson<FinalAssessment>(ai, fallbackModel, finalSchema, stage2Prompt);

        aiModelUsed = fallbackModel;
      } catch (fallbackError) {
        console.error("[Gemini] Stage 2 fallback failed:", fallbackError);

        // Safe reference-only fallback.
        finalAssessment = {
          summary:
            "AI treatment reasoning is temporarily unavailable. Relevant STG/EML reference records are shown for clinician review.",
          urgency: stage1.urgency || "Clinician review required",
          red_flags: stage1.red_flags || [],
          questions: stage1.questions || [],
          possible_diagnoses: (stage1.possible_diagnoses || []).map((item) => ({
            condition: item.condition,
            confidence: item.likelihood,
            why: item.supporting_findings.join("; "),
          })),
          tests: stage1.tests || [],
          plans: conditionEvidence.slice(0, 4).map((c) => ({
            condition: c.condition,
            lines: c.treatment
              ? [
                  {
                    label: "From STG record",
                    order: 1,
                    regimens: [clean(c.treatment)],
                    when_to_use: "AI grounding was unavailable; this is the raw STG treatment text for clinician review.",
                  },
                ]
              : [],
            alternatives: [],
            contraindications: [],
            cautions: [],
            monitoring: [],
            extended_info: [],
          })),
          disposition: "Use the applicable current official Ghana guideline and clinician assessment.",
          source_notes: [
            "AI treatment reasoning was unavailable.",
            "Review the retrieved STG/EML evidence before prescribing.",
          ],
        };

        aiModelUsed = "reference-only";
      }
    }

    // ---------------------------------------------------------
    // 7. Save consultation using your ACTUAL schema
    // ---------------------------------------------------------

    const sourceConditionIds = finalConditions
      .map((c) => c.id)
      .filter((id: unknown) => id !== null && id !== undefined);

    const assessmentToSave = {
      ...finalAssessment,
      stage1_reasoning: stage1,
      reference_conditions: conditionEvidence,
      reference_medications: relevantMedications,
    };

    const { data: consultation, error: saveError } = await supabase
      .from("consultations")
      .insert({
        clinician_id: user.id,
        patient_input: patient,
        patient_data: patient,
        assessment: assessmentToSave,
        source_condition_ids: sourceConditionIds,
        ai_model: aiModelUsed,
      })
      .select("id")
      .single();

    if (saveError) {
      console.error("Consultation save error:", saveError);
    }

    return NextResponse.json({
      result: finalAssessment,
      reasoning: stage1,
      source_conditions: conditionEvidence,
      source_medications: relevantMedications,
      evidence: {
        conditions: conditionEvidence,
        medications: relevantMedications,
      },
      consultationId: consultation?.id ?? null,
      aiModel: aiModelUsed,
    });
  } catch (error) {
    console.error("Assessment error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Assessment failed",
      },
      { status: 500 }
    );
  }
}
