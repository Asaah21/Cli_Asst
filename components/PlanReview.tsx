"use client";

import { useState } from "react";
import { EMPTY_PATIENT } from "@/lib/types";
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

const numberOrNull = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function PlanReview() {
  const [patient, setPatient] = useState<PatientInput>(EMPTY_PATIENT);
  const [diagnosis, setDiagnosis] = useState("");
  const [prescription, setPrescription] = useState("");
  const [allergies, setAllergies] = useState("");

  const [result, setResult] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof PatientInput>(key: K, value: PatientInput[K]) =>
    setPatient((current) => ({ ...current, [key]: value }));

  const showPregnancy =
    patient.sex === "Female" && (patient.age === null || (patient.age >= 10 && patient.age <= 55));

  async function review() {
    if (!diagnosis.trim() || !prescription.trim()) {
      setError("Enter both your diagnosis and your prescription.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patient: {
            ...patient,
            allergies: allergies
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
            trimester: showPregnancy && patient.pregnancy === "Yes" ? patient.trimester : null,
          },
          diagnosis,
          prescription,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Review failed.");

      setResult(data.result);
    } catch (err: any) {
      setError(err.message || "Review failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPatient(EMPTY_PATIENT);
    setDiagnosis("");
    setPrescription("");
    setAllergies("");
    setResult(null);
    setError("");
  }

  return (
    <section className="card intakeCard">
      <div className="cardHeader">
        <div>
          <span className="eyebrow">SECOND OPINION</span>
          <h2>Review my plan</h2>
          <p className="muted">
            Enter your own diagnosis and prescription and get it critiqued — dose, choice, omissions.
          </p>
        </div>
      </div>

      <div className="subheading">Patient</div>
      <div className="formGrid">
        <label className="field">
          <span>Age (years)</span>
          <input
            type="number"
            value={patient.age ?? ""}
            onChange={(e) => set("age", numberOrNull(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Sex</span>
          <select
            value={patient.sex}
            onChange={(e) => set("sex", e.target.value as PatientInput["sex"])}
          >
            <option value="">Select</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
          </select>
        </label>
        <label className="field">
          <span>Weight (kg)</span>
          <input
            type="number"
            value={patient.weight ?? ""}
            onChange={(e) => set("weight", numberOrNull(e.target.value))}
          />
        </label>
        {showPregnancy && (
          <label className="field">
            <span>Pregnancy</span>
            <select
              value={patient.pregnancy}
              onChange={(e) => set("pregnancy", e.target.value as PatientInput["pregnancy"])}
            >
              <option>Unknown</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
        )}
        {showPregnancy && patient.pregnancy === "Yes" && (
          <label className="field">
            <span>Trimester</span>
            <select
              value={patient.trimester ?? ""}
              onChange={(e) =>
                set("trimester", e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null)
              }
            >
              <option value="">Unsure</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        )}
        <label className="field wide">
          <span>Allergies (comma separated)</span>
          <input
            type="text"
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            placeholder="Penicillin, Sulfa"
          />
        </label>
        <label className="field wide">
          <span>Presentation</span>
          <textarea
            value={patient.complaints}
            onChange={(e) => set("complaints", e.target.value)}
            placeholder="Fever and dysuria for 3 days..."
          />
        </label>
      </div>

      <div className="subheading">Your plan</div>
      <div className="formGrid">
        <label className="field wide">
          <span>Your diagnosis</span>
          <input
            type="text"
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="e.g. Uncomplicated UTI"
          />
        </label>
        <label className="field wide">
          <span>Your prescription — one drug per line</span>
          <textarea
            value={prescription}
            onChange={(e) => setPrescription(e.target.value)}
            placeholder={"Doxycycline 100mg BD x 7 days\nParacetamol 1g TDS prn"}
          />
        </label>
      </div>

      {error && <div className="errorBox">{error}</div>}

      <div className="actionRow">
        <button className="primaryButton" onClick={review} disabled={loading}>
          {loading ? "Reviewing..." : "Review my plan"}
        </button>
        <button className="secondaryButton" onClick={reset} disabled={loading}>
          Clear
        </button>
      </div>

      {result && (
        <div className="reviewResult">
          <div className={`verdict ${result.verdict.replace(/\s+/g, "-").toLowerCase()}`}>
            {result.verdict}
          </div>

          {(result.diagnosis?.comment || result.diagnosis?.also_consider?.length > 0) && (
            <div className="reviewBlock">
              <h5>Diagnosis</h5>
              {result.diagnosis.comment && <p>{result.diagnosis.comment}</p>}
              {result.diagnosis.also_consider?.length > 0 && (
                <div className="tagRow">
                  {result.diagnosis.also_consider.map((item, i) => (
                    <span className="tag neutral" key={i}>
                      Also consider: {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.issues?.length > 0 && (
            <div className="reviewBlock">
              <h5>Issues</h5>
              <div className="issueList">
                {result.issues.map((issue, i) => (
                  <div className={`issue ${issue.severity}`} key={i}>
                    <div className="issueHead">
                      <span className="issueSeverity">{issue.severity}</span>
                      <strong>{issue.item}</strong>
                    </div>
                    <p>{issue.issue}</p>
                    {issue.suggestion && <p className="issueFix">{issue.suggestion}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.missing?.length > 0 && (
            <div className="reviewBlock">
              <h5>Missing</h5>
              <ul className="cleanList">
                {result.missing.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {result.confirmed?.length > 0 && (
            <div className="reviewBlock">
              <h5>Appropriate</h5>
              <ul className="cleanList">
                {result.confirmed.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
