import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";

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
  plans: Array<{
    condition: string;
    b2: string[];
    c: string[];
    alternatives: string[];
    contraindications: string[];
    notes: string[];
  }>;
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
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "condition",
          "b2",
          "c",
          "alternatives",
          "contraindications",
          "notes",
        ],
        properties: {
          condition: { type: "string" },
          b2: {
            type: "array",
            items: { type: "string" },
          },
          c: {
            type: "array",
            items: { type: "string" },
          },
          alternatives: {
            type: "array",
            items: { type: "string" },
          },
          contraindications: {
            type: "array",
            items: { type: "string" },
          },
          notes: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
    disposition: { type: "string" },
    source_notes: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (value: unknown): string[] =>
  [
    ...new Set(
      clean(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((x) => x.length >= 4)
    ),
  ].slice(0, 80);

const scoreText = (query: string, text: string) => {
  const queryTerms = new Set(tokens(query));
  const textTerms = new Set(tokens(text));

  let score = 0;

  for (const term of queryTerms) {
    if (textTerms.has(term)) score++;
  }

  return score;
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function errorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error
  ) {
    const status = (error as { status?: unknown }).status;

    if (typeof status === "number") return status;
  }

  return null;
}

function isQuotaError(error: unknown) {
  return errorStatus(error) === 429;
}

function isTemporaryError(error: unknown) {
  const status = errorStatus(error);
  return status === 500 || status === 503;
}

async function generateJson<T>(
  ai: GoogleGenAI,
  model: string,
  schema: unknown,
  prompt: string
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(
        `[Gemini] ${model} attempt ${attempt}/2`
      );

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

      console.error(
        `[Gemini] ${model} attempt ${attempt} failed:`,
        error
      );

      if (isQuotaError(error)) {
        throw error;
      }

      if (!isTemporaryError(error)) {
        throw error;
      }

      if (attempt === 1) {
        await sleep(2000);
      }
    }
  }

  throw lastError;
}

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
  conditions: any[]
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
        const investigation = clean(
          item.condition.investigations
        );

        return investigation
          ? [
              {
                test: investigation,
                reason:
                  "Investigation listed in the supplied STG record.",
                priority: "Consider",
              },
            ]
          : [];
      }),
    plans: [],
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
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const patient =
      (await req.json()) as PatientInput;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is missing.",
        },
        { status: 500 }
      );
    }

    const primaryModel =
      process.env.GEMINI_MODEL ||
      "gemini-3.5-flash-lite";

    const fallbackModel =
      process.env.GEMINI_FALLBACK_MODEL ||
      "gemini-3.1-flash-lite";

    const ai = new GoogleGenAI({
      apiKey,
    });

    const patientText = buildPatientText(patient);

    // ---------------------------------------------------------
    // 1. Get the structured clinical reference data from Supabase
    // ---------------------------------------------------------

    const {
      data: allConditions,
      error: conditionError,
    } = await supabase
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
      return NextResponse.json(
        { error: conditionError.message },
        { status: 500 }
      );
    }

    const conditions = allConditions ?? [];

    // ---------------------------------------------------------
    // 2. Rank STG conditions locally
    //    This avoids sending all 402 records to Gemini.
    // ---------------------------------------------------------

    const rankedConditions = conditions
      .map((condition: any) => ({
        condition,
        score: scoreText(
          patientText,
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
      .slice(0, 10);

    // ---------------------------------------------------------
    // 3. Stage 1: AI clinical reasoning
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
      stage1 = await generateJson<Stage1Assessment>(
        ai,
        primaryModel,
        stage1Schema,
        stage1Prompt
      );
    } catch (primaryError) {
      console.error(
        "[Gemini] Stage 1 primary failed:",
        primaryError
      );

      if (isQuotaError(primaryError)) {
        stage1 = localConditionFallback(
          patient,
          conditions
        ) as unknown as Stage1Assessment;
      } else {
        try {
          stage1 = await generateJson<Stage1Assessment>(
            ai,
            fallbackModel,
            stage1Schema,
            stage1Prompt
          );
        } catch (fallbackError) {
          console.error(
            "[Gemini] Stage 1 fallback failed:",
            fallbackError
          );

          stage1 = localConditionFallback(
            patient,
            conditions
          ) as unknown as Stage1Assessment;
        }
      }
    }

    // ---------------------------------------------------------
    // 4. Match stage-1 diagnoses against STG records
    // ---------------------------------------------------------

    const diagnosisTerms = (
      stage1.possible_diagnoses ?? []
    ).flatMap((item) => [
      item.condition,
      ...(item.supporting_findings ?? []),
    ]);

    const expandedSearchText = [
      patientText,
      ...diagnosisTerms,
    ].join(" ");

    const finalConditions = conditions
      .map((condition: any) => ({
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
    // 5. Get medication database and rank B2/C medicines locally
    // ---------------------------------------------------------

    const {
      data: allMedications,
      error: medicationError,
    } = await supabase
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
      return NextResponse.json(
        { error: medicationError.message },
        { status: 500 }
      );
    }

    const medications = allMedications ?? [];

    const medicationSearchText = [
      ...(stage1.possible_diagnoses ?? []).map(
        (x) => x.condition
      ),
      ...finalConditions.map(
        (x: any) => x.condition
      ),
      ...finalConditions.map(
        (x: any) => x.treatment
      ),
    ].join(" ");

    const relevantMedications = medications
      .map((medication: any) => ({
        medication,
        score: scoreText(
          medicationSearchText,
          [
            medication.drug,
            medication.formulation,
            medication.strength,
            medication.category,
          ].join(" ")
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.medication);

    // ---------------------------------------------------------
    // 6. Evidence text kept deliberately small
    // ---------------------------------------------------------

    const conditionEvidence = finalConditions
      .map(
        (c: any) => ({
          id: c.id,
          condition: c.condition,
          symptoms: c.symptoms,
          signs: c.signs,
          investigations: c.investigations,
          treatment: c.treatment,
          referral_criteria: c.referral_criteria,
          source_pages: c.source_pages,
        })
      );

    // ---------------------------------------------------------
    // 7. Stage 2: evidence-grounded treatment reasoning
    // ---------------------------------------------------------

    const stage2Prompt = `
You are the evidence-grounding stage of a clinical decision-support application for a Ghanaian health facility.

FACILITY:
- Facility level: C
- Preferred working level: B2
- Both B2 and C treatment options must be shown when supported.
- Facility observation is normally up to 24 hours, but this is an operational constraint and NOT a clinical treatment rule.

CRITICAL SOURCE RULES:
- Use the supplied STG records as the primary source for treatment, investigation and referral information.
- Use the supplied EML records for medication availability/level.
- Never invent a medicine, dose, route, frequency, duration, indication, contraindication or referral criterion.
- If the supplied source does not contain enough information, say: "Verify in the current official Ghana STG/EML."
- Clearly distinguish probable diagnoses from confirmed diagnoses.
- Do not automatically turn a negative test into a diagnosis.
- Flag emergencies, pregnancy concerns, severe disease and dangerous vital-sign abnormalities.
- Ask only useful questions that can change the assessment.
- Recommend only useful/simple tests relevant to the differential.
- B2 must appear before C.
- C-level options must remain visible where clinically relevant.
- A C-level medicine is not automatically a reason to refer.
- Do not fabricate patient-specific dose calculations.
- Current official Ghana guidance may supersede older supplied material; state when verification is needed.

PATIENT:
${patientText}

STAGE 1 CLINICAL REASONING:
${JSON.stringify(stage1)}

RELEVANT STG RECORDS:
${JSON.stringify(conditionEvidence)}

RELEVANT B2/C MEDICATION RECORDS:
${JSON.stringify(relevantMedications)}

Return the structured result.
`;

    let finalAssessment: FinalAssessment;
    let aiModelUsed = primaryModel;

    try {
      finalAssessment =
        await generateJson<FinalAssessment>(
          ai,
          primaryModel,
          finalSchema,
          stage2Prompt
        );
    } catch (primaryError) {
      console.error(
        "[Gemini] Stage 2 primary failed:",
        primaryError
      );

      try {
        finalAssessment =
          await generateJson<FinalAssessment>(
            ai,
            fallbackModel,
            finalSchema,
            stage2Prompt
          );

        aiModelUsed = fallbackModel;
      } catch (fallbackError) {
        console.error(
          "[Gemini] Stage 2 fallback failed:",
          fallbackError
        );

        // Safe reference-only fallback.
        finalAssessment = {
          summary:
            "AI treatment reasoning is temporarily unavailable. Relevant STG/EML reference records are shown for clinician review.",
          urgency: stage1.urgency || "Clinician review required",
          red_flags: stage1.red_flags || [],
          questions: stage1.questions || [],
          possible_diagnoses: (
            stage1.possible_diagnoses || []
          ).map((item) => ({
            condition: item.condition,
            confidence: item.likelihood,
            why: item.supporting_findings.join("; "),
          })),
          tests: stage1.tests || [],
          plans: [],
          disposition:
            "Use the applicable current official Ghana guideline and clinician assessment.",
          source_notes: [
            "AI treatment reasoning was unavailable.",
            "Review the retrieved STG/EML evidence before prescribing.",
          ],
        };

        aiModelUsed = "reference-only";
      }
    }

    // ---------------------------------------------------------
    // 8. Save consultation using your ACTUAL schema
    // ---------------------------------------------------------

    const sourceConditionIds = finalConditions
      .map((c: any) => c.id)
      .filter((id: unknown) => id !== null && id !== undefined);

    const assessmentToSave = {
      ...finalAssessment,
      stage1_reasoning: stage1,
      reference_conditions: conditionEvidence,
      reference_medications: relevantMedications,
    };

    const { data: consultation, error: saveError } =
      await supabase
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
      console.error(
        "Consultation save error:",
        saveError
      );
    }

    return NextResponse.json({
      result: finalAssessment,
      reasoning: stage1,
      source_conditions: conditionEvidence,
      source_medications: relevantMedications,
      consultationId: consultation?.id ?? null,
      aiModel: aiModelUsed,
    });
  } catch (error) {
    console.error("Assessment error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Assessment failed",
      },
      { status: 500 }
    );
  }
}