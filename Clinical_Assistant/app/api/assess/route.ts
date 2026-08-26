import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";

const reasoningSchema = {
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
    red_flags: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    possible_diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "likelihood", "supporting_findings", "findings_against"],
        properties: {
          condition: { type: "string" },
          likelihood: { type: "string" },
          supporting_findings: { type: "array", items: { type: "string" } },
          findings_against: { type: "array", items: { type: "string" } },
        },
      },
    },
    questions: { type: "array", items: { type: "string" } },
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
    immediate_actions: { type: "array", items: { type: "string" } },
  },
};

const planSchema = {
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
    "immediate_actions",
    "disposition",
    "source_notes",
  ],
  properties: {
    summary: { type: "string" },
    urgency: { type: "string" },
    red_flags: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    possible_diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "likelihood", "why"],
        properties: {
          condition: { type: "string" },
          likelihood: { type: "string" },
          why: { type: "string" },
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
          "cautions",
          "monitoring",
        ],
        properties: {
          condition: { type: "string" },
          b2: { type: "array", items: { type: "string" } },
          c: { type: "array", items: { type: "string" } },
          alternatives: { type: "array", items: { type: "string" } },
          contraindications: { type: "array", items: { type: "string" } },
          cautions: { type: "array", items: { type: "string" } },
          monitoring: { type: "array", items: { type: "string" } },
        },
      },
    },
    immediate_actions: { type: "array", items: { type: "string" } },
    disposition: { type: "string" },
    source_notes: { type: "array", items: { type: "string" } },
  },
};

type CandidateCondition = {
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
  score: number;
};

type Medication = {
  id: number;
  drug: string;
  formulation?: string | null;
  strength?: string | null;
  level_of_care?: string | null;
  nhis_status?: string | null;
  code?: string | null;
  category?: string | null;
  eml_page?: string | null;
  contraindications?: string | null;
  cautions?: string | null;
};

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const stopWords = new Set([
  "this", "that", "with", "from", "have", "has", "been", "were", "there", "their", "about",
  "patient", "patients", "treatment", "signs", "symptoms", "condition", "management", "history",
  "pain", "days", "day", "years", "year", "male", "female", "unknown", "none", "known",
]);

function tokens(value: unknown) {
  return [...new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !stopWords.has(token))
  )].slice(0, 60);
}

function scoreText(record: CandidateCondition, queryTokens: string[]) {
  const conditionText = clean([
    record.condition,
    record.symptoms,
    record.signs,
    record.investigations,
    record.treatment,
    record.referral_criteria,
  ].join(" ")).toLowerCase();

  const name = clean(record.condition).toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (name.includes(token)) score += 4;
    else if (conditionText.includes(token)) score += 1;
  }

  return score;
}

function parseStatus(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

async function callGemini<T>(model: string, apiKey: string, schema: unknown, prompt: string) {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log(`[Gemini] ${model} attempt ${attempt}/2`);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema as never,
        },
      });

      if (!response.text) throw new Error("Gemini returned an empty response.");
      return JSON.parse(response.text) as T;
    } catch (error) {
      lastError = error;
      const status = parseStatus(error);
      console.error(`[Gemini] ${model} failed with status ${status}:`, error);
      if (status === 429) throw error;
      if ((status === 500 || status === 503) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1800 * attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini request failed.");
}

function buildPatientSummary(patient: any) {
  return {
    demographics: {
      age: patient.age ?? null,
      sex: patient.sex ?? null,
      weight: patient.weight ?? null,
      pregnancy: patient.pregnancy ?? null,
      allergies: patient.allergies ?? null,
    },
    vitals: {
      temperature: patient.temp ?? null,
      blood_pressure: patient.bp ?? null,
      pulse: patient.pulse ?? null,
      respiratory_rate: patient.rr ?? null,
      spo2: patient.spo2 ?? null,
      rbs: patient.rbs ?? null,
      hb: patient.hb ?? null,
    },
    presentation: {
      complaints: patient.complaints ?? null,
      extra_history_and_exam: patient.extra ?? null,
      existing_tests: patient.tests ?? null,
    },
  };
}

function medicationKey(m: Medication) {
  return [m.drug, m.formulation, m.strength, m.level_of_care].map(clean).join("|");
}

function safeQuotedTerms(values: string[]) {
  return values
    .filter(Boolean)
    .slice(0, 24)
    .map((term) => term.replace(/[%(),]/g, " ").trim())
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const patient = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
    const patientSummary = buildPatientSummary(patient);

    // Stage 1: reason over the encounter ONLY. No medication database is sent here.
    const stage1Prompt = `You are a cautious clinical decision-support assistant for a Ghanaian health facility.

Interpret the WHOLE encounter, not just the main complaint. Use age, sex, pregnancy status, weight, allergies, all vitals, symptoms, signs, duration, history/examination and existing tests together.

The patient may provide a vague complaint such as "waist pain". Do not anchor on the wording. Consider relevant systems and clinically important alternatives.

Output a ranked differential, urgent/red-flag concerns, missing information, targeted questions that could change the differential, and only simple/high-yield tests relevant to the facility context.

Do not prescribe in this stage. Do not claim a diagnosis is confirmed.

PATIENT ENCOUNTER:
${JSON.stringify(patientSummary, null, 2)}`;

    let stage1;
    try {
      stage1 = await callGemini(model, apiKey, reasoningSchema, stage1Prompt);
    } catch (primaryError) {
      console.error("[Gemini] Stage 1 primary failed:", primaryError);
      const status = parseStatus(primaryError);
      if (status === 429 || status === 503 || status === 500) {
        stage1 = await callGemini(fallbackModel, apiKey, reasoningSchema, stage1Prompt);
      } else {
        throw primaryError;
      }
    }

    // Candidate retrieval happens in Supabase, not in Gemini.
    // We load the structured condition records and rank them locally on the server.
    const { data: conditionRows, error: conditionError } = await supabase
      .from("conditions")
      .select("id,condition,chapter_number,chapter,printed_page,source_pages,symptoms,signs,investigations,treatment,referral_criteria,section_text")
      .limit(500);

    if (conditionError) {
      return NextResponse.json({ error: conditionError.message }, { status: 500 });
    }

    const diagnosisTerms = (stage1.possible_diagnoses ?? [])
      .flatMap((item: any) => [item.condition, ...(item.supporting_findings ?? [])]);
    const encounterTerms = [
      patient.complaints,
      patient.extra,
      patient.tests,
      patient.sex,
      patient.pregnancy,
      stage1.clinical_summary,
    ];
    const queryTokens = tokens([...diagnosisTerms, ...encounterTerms].join(" "));

    const candidates: CandidateCondition[] = (conditionRows ?? [])
      .map((row: any) => ({ ...row, score: scoreText(row, queryTokens) }))
      .sort((a, b) => b.score - a.score)
      .filter((row) => row.score > 0)
      .slice(0, 12);

    const conditionNames = (stage1.possible_diagnoses ?? [])
      .map((item: any) => clean(item.condition))
      .filter(Boolean)
      .slice(0, 8);

    const relevantConditions = candidates.length
      ? candidates
      : (conditionRows ?? []).slice(0, 8).map((row: any) => ({ ...row, score: 0 }));

    const conditionEvidence = relevantConditions.map((c) => ({
      id: c.id,
      condition: c.condition,
      symptoms: c.symptoms,
      signs: c.signs,
      investigations: c.investigations,
      treatment: c.treatment,
      referral_criteria: c.referral_criteria,
      source_pages: c.source_pages,
    }));

    // Structured medication retrieval from the EML.
    const medSearchTerms = safeQuotedTerms([
      ...conditionNames.flatMap(tokens),
      ...relevantConditions.flatMap((c) => tokens(`${c.condition} ${c.treatment ?? ""}`)),
    ]);

    let medications: Medication[] = [];
    if (medSearchTerms.length) {
      const orExpression = medSearchTerms
        .map((term) => `drug.ilike.%${term}%,formulation.ilike.%${term}%`)
        .join(",");
      const { data, error } = await supabase
        .from("medications")
        .select("id,drug,formulation,strength,level_of_care,nhis_status,code,category,eml_page,contraindications,cautions")
        .in("level_of_care", ["B2", "C"])
        .or(orExpression)
        .limit(80);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      medications = (data ?? []) as Medication[];
    }

    const uniqueMedications = [...new Map(medications.map((m) => [medicationKey(m), m])).values()];

    // Stage 2: source-grounded treatment. Gemini receives only the small relevant evidence set.
    const stage2Prompt = `You are a clinical evidence-grounding assistant for a Ghanaian health facility.

Use the patient encounter, first-stage reasoning, relevant STG condition records and the exact EML medication records below.

Rules:
- Do not invent a medication, dose, route, frequency, duration, contraindication or referral criterion.
- Treatment statements must be supported by the supplied STG records.
- Medicine level-of-care classification must be supported by the supplied EML records.
- Show B2 options first and C options separately. Do not hide C options.
- A C-level medicine is not automatically a referral.
- If a requested detail is not supported by the supplied evidence, say: "Verify in the current official Ghana STG/EML." 
- Ask only targeted questions that could change the ranking or management.
- Recommend only targeted/simple tests that are relevant to the differential.
- Flag red flags and abnormal vitals.
- The facility usually observes/manages patients for up to 24 hours, but this is an operational constraint, not a clinical rule.
- Do not say a diagnosis is confirmed unless the evidence supports confirmation.

PATIENT:
${JSON.stringify(patientSummary, null, 2)}

FIRST-STAGE REASONING:
${JSON.stringify(stage1, null, 2)}

RELEVANT STG RECORDS:
${JSON.stringify(conditionEvidence, null, 2)}

RELEVANT EML MEDICINES (B2/C ONLY):
${JSON.stringify(uniqueMedications, null, 2)}

Return a concise, structured clinical assessment.`;

    let stage2;
    try {
      stage2 = await callGemini(model, apiKey, planSchema, stage2Prompt);
    } catch (primaryError) {
      console.error("[Gemini] Stage 2 primary failed:", primaryError);
      const status = parseStatus(primaryError);
      if (status === 429 || status === 503 || status === 500) {
        stage2 = await callGemini(fallbackModel, apiKey, planSchema, stage2Prompt);
      } else {
        throw primaryError;
      }
    }

    const sourceConditionIds = relevantConditions.map((c) => c.id).filter(Boolean);
    const usedMedicationRecords = uniqueMedications;

    const assessment = {
      ...stage2,
      evidence: {
        stage1_model: model,
        condition_records: conditionEvidence,
        medication_records: usedMedicationRecords,
      },
    };

    const { data: consultation, error: saveError } = await supabase
      .from("consultations")
      .insert({
        clinician_id: user.id,
        patient_input: patient,
        patient_data: patient,
        assessment,
        source_condition_ids: sourceConditionIds,
        ai_model: model,
      })
      .select("id")
      .single();

    if (saveError) {
      console.error("Consultation save failed", saveError);
    }

    return NextResponse.json({
      result: stage2,
      reasoning: stage1,
      evidence: {
        conditions: conditionEvidence,
        medications: usedMedicationRecords,
      },
      consultationId: consultation?.id ?? null,
    });
  } catch (error) {
    console.error("Assessment error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Assessment failed." },
      { status: 500 }
    );
  }
}
