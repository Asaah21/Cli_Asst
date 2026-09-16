"use client";

import { useState } from "react";
import DiagnosisCard from "@/components/DiagnosisCard";
import type { DiagnosisCardData } from "@/components/DiagnosisCard";
import { EMPTY_PATIENT } from "@/lib/types";
import type { PatientInput } from "@/lib/types";

type AssessResult = {
  urgency: "Routine" | "Urgent" | "Emergency";
  red_flags: string[];
  diagnoses: DiagnosisCardData[];
};

const ALLERGY_CHIPS = ["No known allergy", "Penicillin", "Sulfa", "NSAIDs", "Other"];
const NO_KNOWN = "No known allergy";

const numberOrNull = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function AssessmentForm() {
  const [form, setForm] = useState<PatientInput>(EMPTY_PATIENT);
  const [chips, setChips] = useState<string[]>([]);
  const [otherAllergy, setOtherAllergy] = useState("");
  const [showExtraMeasurements, setShowExtraMeasurements] = useState(false);

  const [result, setResult] = useState<AssessResult | null>(null);
  const [openCard, setOpenCard] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof PatientInput>(key: K, value: PatientInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Weight is only asked for when it changes the dose — children.
  const showWeight = form.age === null || form.age < 12;
  const showMonths = form.age === null || form.age < 2;
  const showPregnancy =
    form.sex === "Female" && (form.age === null || (form.age >= 10 && form.age <= 55));

  function setAge(value: string) {
    const age = numberOrNull(value);
    setForm((current) => ({
      ...current,
      age,
      // Clear values that are no longer being collected.
      weight: age !== null && age >= 12 ? null : current.weight,
      age_months: age !== null && age >= 2 ? null : current.age_months,
    }));
  }

  function setSex(value: string) {
    const sex = value as PatientInput["sex"];
    setForm((current) => ({
      ...current,
      sex,
      pregnancy: sex === "Female" ? current.pregnancy : "Unknown",
      trimester: sex === "Female" ? current.trimester : null,
    }));
  }

  function toggleChip(chip: string) {
    setChips((current) => {
      if (chip === NO_KNOWN) return current.includes(NO_KNOWN) ? [] : [NO_KNOWN];
      const without = current.filter((entry) => entry !== NO_KNOWN);
      return without.includes(chip)
        ? without.filter((entry) => entry !== chip)
        : [...without, chip];
    });
  }

  function allergyList(): string[] {
    if (chips.includes(NO_KNOWN)) return [NO_KNOWN];
    const named = chips.filter((chip) => chip !== "Other");
    const other = otherAllergy.trim();
    return other ? [...named, other] : named;
  }

  async function assess() {
    setLoading(true);
    setError("");

    try {
      const payload: PatientInput = {
        ...form,
        weight: showWeight ? form.weight : null,
        pregnancy: showPregnancy ? form.pregnancy : "Unknown",
        trimester: showPregnancy && form.pregnancy === "Yes" ? form.trimester : null,
        allergies: allergyList(),
      };

      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Assessment failed.");

      setResult(data.result);
      setOpenCard(data.result?.diagnoses?.length ? 0 : null);

      window.setTimeout(() => {
        document
          .getElementById("assessment-results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err: any) {
      setError(err.message || "Assessment failed.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setForm(EMPTY_PATIENT);
    setChips([]);
    setOtherAllergy("");
    setResult(null);
    setOpenCard(null);
    setError("");
  }

  return (
    <>
      <section className="card intakeCard">
        <div className="cardHeader">
          <div>
            <span className="eyebrow">NEW CONSULTATION</span>
            <h2>Patient assessment</h2>
            <p className="muted">
              Enter what you know. The assistant searches the Ghana STG, then gives you two or three
              diagnoses with what to prescribe.
            </p>
          </div>
        </div>

        <div className="subheading">Patient</div>
        <div className="formGrid">
          <label className="field">
            <span>Age (years)</span>
            <input
              type="number"
              value={form.age ?? ""}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>

          {showMonths && (
            <label className="field">
              <span>Age (months) — under 2s</span>
              <input
                type="number"
                value={form.age_months ?? ""}
                onChange={(e) => set("age_months", numberOrNull(e.target.value))}
              />
            </label>
          )}

          <label className="field">
            <span>Sex</span>
            <select value={form.sex} onChange={(e) => setSex(e.target.value)}>
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </label>

          {showWeight && (
            <label className="field">
              <span>Weight (kg) — needed for child dosing</span>
              <input
                type="number"
                value={form.weight ?? ""}
                onChange={(e) => set("weight", numberOrNull(e.target.value))}
              />
            </label>
          )}

          {showPregnancy && (
            <label className="field">
              <span>Pregnancy</span>
              <select
                value={form.pregnancy}
                onChange={(e) => set("pregnancy", e.target.value as PatientInput["pregnancy"])}
              >
                <option>Unknown</option>
                <option>Yes</option>
                <option>No</option>
              </select>
            </label>
          )}

          {showPregnancy && form.pregnancy === "Yes" && (
            <label className="field">
              <span>Trimester</span>
              <select
                value={form.trimester ?? ""}
                onChange={(e) =>
                  set(
                    "trimester",
                    e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : null
                  )
                }
              >
                <option value="">Unsure</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </label>
          )}
        </div>

        <div className="subheading">Allergies</div>
        <div className="chipRow">
          {ALLERGY_CHIPS.map((chip) => {
            const active = chips.includes(chip);
            const disabled = chips.includes(NO_KNOWN) && chip !== NO_KNOWN;

            return (
              <button
                type="button"
                key={chip}
                className={`chip ${active ? "active" : ""}`}
                onClick={() => toggleChip(chip)}
                disabled={disabled}
                aria-pressed={active}
              >
                {chip}
              </button>
            );
          })}
        </div>

        {chips.includes("Other") && (
          <div className="formGrid">
            <label className="field wide">
              <span>Which allergy?</span>
              <input
                type="text"
                value={otherAllergy}
                onChange={(e) => setOtherAllergy(e.target.value)}
                placeholder="e.g. Chloroquine"
              />
            </label>
          </div>
        )}

        <div className="subheading">Vitals</div>
        <div className="formGrid">
          <label className="field">
            <span>Temperature °C</span>
            <input
              type="number"
              value={form.temp ?? ""}
              onChange={(e) => set("temp", numberOrNull(e.target.value))}
            />
          </label>
          <label className="field">
            <span>BP</span>
            <input type="text" value={form.bp ?? ""} onChange={(e) => set("bp", e.target.value)} />
          </label>
          <label className="field">
            <span>Pulse /min</span>
            <input
              type="number"
              value={form.pulse ?? ""}
              onChange={(e) => set("pulse", numberOrNull(e.target.value))}
            />
          </label>
        </div>

        <button
          type="button"
          className="textButton toggleRow"
          onClick={() => setShowExtraMeasurements((value) => !value)}
        >
          {showExtraMeasurements ? "Hide extra measurements" : "Add extra measurements"}
        </button>

        {showExtraMeasurements && (
          <div className="formGrid">
            <label className="field">
              <span>RBS</span>
              <input type="text" value={form.rbs ?? ""} onChange={(e) => set("rbs", e.target.value)} />
            </label>
            <label className="field">
              <span>Hb</span>
              <input type="text" value={form.hb ?? ""} onChange={(e) => set("hb", e.target.value)} />
            </label>
          </div>
        )}

        <div className="subheading">Clinical story</div>
        <div className="formGrid">
          <label className="field wide">
            <span>Main complaint, symptoms, signs &amp; duration</span>
            <textarea
              value={form.complaints}
              onChange={(e) => set("complaints", e.target.value)}
              placeholder="e.g. waist pain for 3 days, fever since yesterday..."
            />
          </label>
          <label className="field wide">
            <span>Extra history / examination findings</span>
            <textarea
              value={form.extra ?? ""}
              onChange={(e) => set("extra", e.target.value)}
              placeholder="Trauma, urinary symptoms, discharge, menstrual history, medications, past history..."
            />
          </label>
          <label className="field wide">
            <span>Tests already done + results</span>
            <textarea
              value={form.tests ?? ""}
              onChange={(e) => set("tests", e.target.value)}
              placeholder="RDT negative; pregnancy negative; Hb 10.2 g/dL; etc."
            />
          </label>
        </div>

        {error && <div className="errorBox">{error}</div>}

        <div className="actionRow">
          <button className="primaryButton" onClick={assess} disabled={loading}>
            {loading ? "Assessing..." : result ? "Reassess patient" : "Assess patient"}
          </button>
          <button className="secondaryButton" onClick={reset} disabled={loading}>
            Clear
          </button>
        </div>
      </section>

      {result && (
        <section id="assessment-results" className="resultsCard card">
          {result.red_flags?.length > 0 && (
            <div className="redFlagBar">
              <strong>Red flags</strong>
              <ul className="cleanList">
                {result.red_flags.map((flag, i) => (
                  <li key={i}>{flag}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="urgencyRow">
            <span className={`urgencyChip ${result.urgency?.toLowerCase()}`}>{result.urgency}</span>
          </div>

          <div className="dxList">
            {result.diagnoses?.map((card, index) => (
              <DiagnosisCard
                key={`${card.condition}-${index}`}
                card={card}
                open={openCard === index}
                onToggle={() => setOpenCard((current) => (current === index ? null : index))}
              />
            ))}
            {!result.diagnoses?.length && (
              <p className="muted">No diagnoses were returned for this encounter.</p>
            )}
          </div>

          <div className="safetyNotice">
            <strong>Clinical safety:</strong> This is decision support, not an autonomous diagnosis or
            prescribing system. Check every dose and contraindication before prescribing.
          </div>
        </section>
      )}
    </>
  );
}
