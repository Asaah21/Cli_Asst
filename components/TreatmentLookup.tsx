"use client";

import { useState } from "react";
import { TreatmentPlan, Plan } from "@/components/TreatmentPlan";

type LookupResult = {
  condition: string;
  overview: string;
  plan: Plan;
  related_conditions: string[];
  source_notes: string[];
};

const initialQuery = {
  condition: "",
  age: "",
  sex: "",
  pregnancy: "Unknown",
  allergies: "",
  notes: "",
};

export default function TreatmentLookup() {
  const [query, setQuery] = useState<any>(initialQuery);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);

  const set = (key: string, value: string) => setQuery((current: any) => ({ ...current, [key]: value }));

  async function lookup() {
    if (!query.condition.trim()) {
      setError("Enter a condition name first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/treatment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...query,
          age: query.age ? Number(query.age) : null,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lookup failed.");

      setResult(data.result);
      setPlanOpen(true);
    } catch (err: any) {
      setError(err.message || "Lookup failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setQuery(initialQuery);
    setResult(null);
    setError("");
  }

  return (
    <section className="card lookupCard">
      <div className="cardHeader">
        <div>
          <span className="eyebrow">QUICK LOOKUP</span>
          <h2>Treatment by condition</h2>
          <p className="muted">
            Already know the diagnosis? Type it directly to get its treatment — no patient assessment required.
          </p>
        </div>
        <button type="button" className="textButton" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide optional context" : "Add optional patient context"}
        </button>
      </div>

      <div className="formGrid">
        <label className="field wide">
          <span>Condition / diagnosis</span>
          <input
            type="text"
            value={query.condition}
            onChange={(e) => set("condition", e.target.value)}
            placeholder="e.g. Malaria, Typhoid fever, Community-acquired pneumonia..."
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
        </label>
      </div>

      {expanded && (
        <div className="formGrid">
          <label className="field">
            <span>Age (years)</span>
            <input type="number" value={query.age} onChange={(e) => set("age", e.target.value)} />
          </label>
          <label className="field">
            <span>Sex</span>
            <select value={query.sex} onChange={(e) => set("sex", e.target.value)}>
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Pregnancy</span>
            <select value={query.pregnancy} onChange={(e) => set("pregnancy", e.target.value)}>
              <option>Unknown</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
          <label className="field">
            <span>Allergies</span>
            <input type="text" value={query.allergies} onChange={(e) => set("allergies", e.target.value)} />
          </label>
          <label className="field wide">
            <span>Extra notes (severity, prior treatment tried, etc.)</span>
            <textarea value={query.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>
      )}

      {error && <div className="errorBox">{error}</div>}

      <div className="actionRow">
        <button className="primaryButton" onClick={lookup} disabled={loading}>
          {loading ? "Looking up..." : "Get treatment"}
        </button>
        {(result || query.condition) && (
          <button className="secondaryButton" onClick={reset} disabled={loading}>
            Clear
          </button>
        )}
      </div>

      {result && (
        <div className="lookupResult">
          <div className="lookupOverview">
            <h3>{result.condition}</h3>
            <p>{result.overview}</p>
          </div>

          <TreatmentPlan plan={result.plan} open={planOpen} onToggle={() => setPlanOpen((v) => !v)} />

          {result.related_conditions?.length > 0 && (
            <div className="relatedConditions">
              <h5>Related / also consider</h5>
              <div className="tagRow">
                {result.related_conditions.map((item, i) => (
                  <span className="tag neutral" key={i}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.source_notes?.length > 0 && (
            <ul className="cleanList sourceNotesList">
              {result.source_notes.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}

          <div className="safetyNotice">
            <strong>Clinical safety:</strong> This lookup is decision support, not an autonomous prescribing system. Verify dose, route, contraindications and current Ghana guidance before prescribing.
          </div>
        </div>
      )}
    </section>
  );
}
