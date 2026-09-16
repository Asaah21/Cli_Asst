import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  clean,
  generateJson,
  getModels,
  isQuotaError,
  asConditionHits,
  termsFromText,
  CLINICAL_GROUNDING_RULES,
} from "@/lib/clinical/shared";
import { parsePrescription } from "@/lib/clinical/prescription";
import { checkSafety } from "@/lib/clinical/safety-rules";
import type { SafetyFlag } from "@/lib/clinical/safety-rules";
import type { Rx } from "@/lib/clinical/dosing";
import { buildPatientText } from "@/lib/types";
import type { PatientInput } from "@/lib/types";

type Issue = {
  severity: "critical" | "important" | "minor";
  item: string;
  issue: string;
  suggestion: string;
};

type Review = {
  verdict: "Sound" | "Minor adjustments" | "Needs revision";
  diagnosis: { agrees: boolean; comment: string; also_consider: string[] };
  issues: Issue[];
  missing: string[];
  confirmed: string[];
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "diagnosis", "issues", "missing", "confirmed"],
  properties: {
    verdict: { type: "string", enum: ["Sound", "Minor adjustments", "Needs revision"] },
    diagnosis: {
      type: "object",
      additionalProperties: false,
      required: ["agrees", "comment", "also_consider"],
      properties: {
        agrees: { type: "boolean" },
        comment: { type: "string" },
        also_consider: { type: "array", items: { type: "string" } },
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "item", "issue", "suggestion"],
        properties: {
          severity: { type: "string", enum: ["critical", "important", "minor"] },
          item: { type: "string" },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
    missing: { type: "array", items: { type: "string" } },
    confirmed: { type: "array", items: { type: "string" } },
  },
};

const SEVERITY_ORDER: Record<Issue["severity"], number> = {
  critical: 0,
  important: 1,
  minor: 2,
};

const significantWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5)
  );

/** True when the model already raised this same point about this same drug. */
function isDuplicateOfFlag(issue: Issue, flag: SafetyFlag): boolean {
  const item = `${issue.item} ${issue.issue}`.toLowerCase();
  if (!item.includes(flag.drug.toLowerCase())) return false;

  const flagWords = significantWords(flag.message);
  const issueWords = significantWords(issue.issue);
  let shared = 0;
  for (const word of flagWords) {
    if (issueWords.has(word)) shared++;
  }
  return shared >= 2;
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

    const body = (await req.json()) as {
      patient?: PatientInput;
      diagnosis?: string;
      prescription?: string;
    };

    const patient = body?.patient;
    const diagnosis = clean(body?.diagnosis);
    const prescription = clean(body?.prescription);

    if (!patient || !diagnosis || !prescription) {
      return NextResponse.json(
        { error: "A patient, a diagnosis and a prescription are all required." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing." }, { status: 500 });
    }

    // -------------------------------------------------------------------
    // 1 & 2. Parse, then run the mechanical checks BEFORE calling the model.
    // -------------------------------------------------------------------

    const parsed = parsePrescription(prescription);
    const parsedRx: Rx[] = parsed.map((line) => ({
      drug: line.drug,
      route: "",
      dose_rule: { basis: "narrative", text: line.raw },
    }));

    const machineFlags = checkSafety(parsedRx, patient);

    // -------------------------------------------------------------------
    // 3. Retrieval, then the model — told what was already found.
    // -------------------------------------------------------------------

    const { primaryModel, fallbackModel } = getModels();
    const ai = new GoogleGenAI({ apiKey });
    const patientText = buildPatientText(patient);

    const terms = [...new Set([diagnosis, ...termsFromText(prescription, 8)])].slice(0, 10);

    const { data: conditionData } = await supabase.rpc("search_conditions", {
      terms: terms.length ? terms : [diagnosis],
      n: 4,
    });

    const evidence = asConditionHits(conditionData).map((hit) => ({
      condition: hit.condition,
      printed_page: hit.printed_page,
      investigations: hit.investigations,
      treatment: hit.treatment,
      referral_criteria: hit.referral_criteria,
    }));

    const prompt = `
A practising clinician has written their own diagnosis and prescription and wants it reviewed. Address them as a peer: specific and direct. Do not soften a dosing error into a gentle suggestion. Do not pad "confirmed" to be encouraging — an empty array is perfectly acceptable.

ALREADY ESTABLISHED BY AUTOMATED CHECKS (these are facts, not things for you to verify — they will be shown to the clinician regardless, so do not repeat them):
${machineFlags.length ? JSON.stringify(machineFlags) : "None found."}

Spend your attention on clinical judgement instead: whether the diagnosis fits the presentation, whether the drug choice treats it, whether dose, frequency, route and duration are right, drug interactions, and what is missing (symptomatic cover, a needed investigation, a follow-up plan).

- "verdict": Sound, Minor adjustments, or Needs revision.
- "diagnosis.agrees": whether the stated diagnosis fits. "also_consider": at most 2 alternatives genuinely worth excluding.
- "issues": each with severity, the drug or plan element it concerns, the issue, and a concrete suggestion.
- "missing": e.g. "No antiemetic despite documented vomiting".
- "confirmed": at most 3 short notes on what was appropriate.
${CLINICAL_GROUNDING_RULES}

PATIENT:
${patientText}

CLINICIAN'S DIAGNOSIS:
${diagnosis}

CLINICIAN'S PRESCRIPTION (parsed):
${JSON.stringify(parsed)}

GHANA STG RECORDS RETRIEVED:
${JSON.stringify(evidence)}
`;

    let review: Review;
    let aiModelUsed = primaryModel;

    try {
      review = await generateJson<Review>(ai, primaryModel, reviewSchema, prompt);
    } catch (error) {
      if (isQuotaError(error)) {
        return NextResponse.json(
          { error: "The AI service is rate limited right now. Try again shortly." },
          { status: 503 }
        );
      }
      review = await generateJson<Review>(ai, fallbackModel, reviewSchema, prompt);
      aiModelUsed = fallbackModel;
    }

    // -------------------------------------------------------------------
    // Merge the deterministic findings in and sort.
    // -------------------------------------------------------------------

    const modelIssues = (review.issues ?? []).filter(
      (issue) => !machineFlags.some((flag) => isDuplicateOfFlag(issue, flag))
    );

    const flagIssues: Issue[] = machineFlags.map((flag) => ({
      // A danger flag is a hard contraindication; a softened warning is real but
      // not categorical, so it lands one level down rather than crying wolf.
      severity: flag.severity === "danger" ? "critical" : "important",
      item: flag.drug,
      issue: flag.message,
      suggestion: "Replace with an agent that is safe for this patient.",
    }));

    const issues = [...flagIssues, ...modelIssues].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    const result: Review = {
      verdict: machineFlags.some((flag) => flag.severity === "danger")
        ? "Needs revision"
        : review.verdict,
      diagnosis: {
        agrees: Boolean(review.diagnosis?.agrees),
        comment: clean(review.diagnosis?.comment),
        also_consider: (review.diagnosis?.also_consider ?? [])
          .map((entry) => clean(entry))
          .filter(Boolean)
          .slice(0, 2),
      },
      issues,
      missing: (review.missing ?? []).map((entry) => clean(entry)).filter(Boolean),
      confirmed: (review.confirmed ?? []).map((entry) => clean(entry)).filter(Boolean).slice(0, 3),
    };

    const { error: saveError } = await supabase.from("plan_reviews").insert({
      clinician_id: user.id,
      patient_input: patient,
      submitted_diagnosis: diagnosis,
      submitted_prescription: prescription,
      review: result,
    });

    if (saveError) {
      console.error("[review] Save error:", saveError);
    }

    return NextResponse.json({ result, aiModel: aiModelUsed });
  } catch (error) {
    console.error("Review error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Review failed" },
      { status: 500 }
    );
  }
}
