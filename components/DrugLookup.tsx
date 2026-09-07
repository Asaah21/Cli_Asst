"use client";

import { useState } from "react";

type DrugForm = {
  formulation: string;
  strength: string;
  level_of_care: string;
};

type DrugDose = {
  indication: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
};

type DrugLookupResult = {
  drug: string;
  overview: string;
  forms: DrugForm[];
  dosages: DrugDose[];
  contraindications: string[];
  cautions: string[];
  related_drugs: string[];
  extended_info: string[];
  source_notes: string[];
};

export default function DrugLookup() {
  const [drug, setDrug] = useState("");
  const [result, setResult] = useState<DrugLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showExtended, setShowExtended] = useState(false);

  async function lookup() {
    if (!drug.trim()) {
      setError("Enter a drug name first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/drug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ drug }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Drug lookup failed.");

      setResult(data.result);
      setShowExtended(false);
    } catch (err: any) {
      setError(err.message || "Drug lookup failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setDrug("");
    setResult(null);
    setError("");
  }

  return (
    <section className="card lookupCard">
      <div className="cardHeader">
        <div>
          <span className="eyebrow">QUICK LOOKUP</span>
          <h2>Drug reference</h2>
          <p className="muted">Type a drug name for a brief description, its available forms and typical dosages.</p>
        </div>
      </div>

      <div className="formGrid">
        <label className="field wide">
          <span>Drug name</span>
          <input
            type="text"
            value={drug}
            onChange={(e) => setDrug(e.target.value)}
            placeholder="e.g. Amoxicillin, Paracetamol, Artemether-lumefantrine..."
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
        </label>
      </div>

      {error && <div className="errorBox">{error}</div>}

      <div className="actionRow">
        <button className="primaryButton" onClick={lookup} disabled={loading}>
          {loading ? "Looking up..." : "Get drug info"}
        </button>
        {(result || drug) && (
          <button className="secondaryButton" onClick={reset} disabled={loading}>
            Clear
          </button>
        )}
      </div>

      {result && (
        <div className="lookupResult">
          <div className="lookupOverview">
            <h3>{result.drug}</h3>
            <p>{result.overview}</p>
          </div>

          {result.forms?.length > 0 && (
            <div>
              <h5>Forms & strengths</h5>
              <div className="testGrid">
                {result.forms.map((form, i) => (
                  <article className="testCard" key={i}>
                    <div className="cardInlineHeader">
                      <h4>{form.formulation}</h4>
                      {form.level_of_care && <span className="tag neutral">{form.level_of_care}</span>}
                    </div>
                    <p>{form.strength}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {result.dosages?.length > 0 && (
            <div>
              <h5>Typical dosages</h5>
              <div className="lineList">
                {result.dosages.map((dose, i) => (
                  <div className="lineBox lineOther" key={i}>
                    <div className="lineLabel">{dose.indication || "General dosing"}</div>
                    <ul className="cleanList">
                      <li>
                        {dose.dose} · {dose.route} · {dose.frequency}
                        {dose.duration ? ` · ${dose.duration}` : ""}
                      </li>
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="miniGrid">
            {result.contraindications?.length > 0 && (
              <div>
                <h5>Contraindications</h5>
                <ul className="cleanList">
                  {result.contraindications.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.cautions?.length > 0 && (
              <div>
                <h5>Cautions</h5>
                <ul className="cleanList">
                  {result.cautions.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {result.related_drugs?.length > 0 && (
            <div className="relatedConditions">
              <h5>Related / alternative drugs</h5>
              <div className="tagRow">
                {result.related_drugs.map((item, i) => (
                  <span className="tag neutral" key={i}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.extended_info?.length > 0 && (
            <div className="extendedInfoBlock">
              <button type="button" className="textButton" onClick={() => setShowExtended((v) => !v)}>
                {showExtended ? "Hide" : "Show"} additional clinical background ({result.extended_info.length})
              </button>
              {showExtended && (
                <div className="extendedInfoPanel">
                  <p className="muted extendedInfoNotice">
                    General medical knowledge beyond the supplied EML excerpt — educational context only, verify locally before acting on it.
                  </p>
                  <ul className="cleanList">
                    {result.extended_info.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
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
            <strong>Clinical safety:</strong> Dosing shown is standard reference dosing, not an autonomous prescribing system. Verify dose, route, contraindications and current Ghana EML guidance before prescribing.
          </div>
        </div>
      )}
    </section>
  );
}
