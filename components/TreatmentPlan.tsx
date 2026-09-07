"use client";

import { forwardRef, useState } from "react";

export type TreatmentLine = {
  label: string;
  order: number;
  regimens: string[];
  when_to_use: string;
};

export type Plan = {
  condition: string;
  lines: TreatmentLine[];
  alternatives: string[];
  contraindications: string[];
  cautions: string[];
  monitoring: string[];
  extended_info: string[];
};

function lineTone(order: number) {
  if (order <= 1) return "lineFirst";
  if (order === 2) return "lineSecond";
  if (order === 3) return "lineThird";
  return "lineOther";
}

function ordinalLabel(order: number) {
  if (order === 1) return "1st line";
  if (order === 2) return "2nd line";
  if (order === 3) return "3rd line";
  return `${order}th line`;
}

export const TreatmentPlan = forwardRef<
  HTMLElement,
  {
    plan: Plan;
    open: boolean;
    onToggle: () => void;
    highlighted?: boolean;
  }
>(function TreatmentPlan({ plan, open, onToggle, highlighted }, ref) {
  const [showExtended, setShowExtended] = useState(false);

  const sortedLines = [...(plan.lines ?? [])].sort((a, b) => a.order - b.order);

  return (
    <article
      ref={ref}
      className={`treatmentCard ${highlighted ? "highlighted" : ""}`}
      id={`plan-${slugify(plan.condition)}`}
    >
      <button type="button" className="treatmentCardHeader" onClick={onToggle} aria-expanded={open}>
        <h4>{plan.condition}</h4>
        <span className="treatmentMeta">
          <span className="muted">
            {sortedLines.length} line{sortedLines.length === 1 ? "" : "s"}
          </span>
          <span className={`chevron ${open ? "open" : ""}`}>▾</span>
        </span>
      </button>

      {open && (
        <div className="treatmentCardBody">
          {sortedLines.length ? (
            <div className="lineList">
              {sortedLines.map((line, i) => (
                <div className={`lineBox ${lineTone(line.order)}`} key={i}>
                  <div className="lineLabel">{line.label || ordinalLabel(line.order)}</div>
                  {line.regimens?.length ? (
                    <ul className="cleanList">
                      {line.regimens.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No supported regimen retrieved for this line.</p>
                  )}
                  {line.when_to_use && <p className="lineWhen">{line.when_to_use}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No treatment lines retrieved for this condition.</p>
          )}

          <div className="miniGrid">
            {plan.alternatives?.length > 0 && (
              <div>
                <h5>Alternatives</h5>
                <ul className="cleanList">
                  {plan.alternatives.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.contraindications?.length > 0 && (
              <div>
                <h5>Contraindications</h5>
                <ul className="cleanList">
                  {plan.contraindications.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.cautions?.length > 0 && (
              <div>
                <h5>Cautions</h5>
                <ul className="cleanList">
                  {plan.cautions.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.monitoring?.length > 0 && (
              <div>
                <h5>Monitoring</h5>
                <ul className="cleanList">
                  {plan.monitoring.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {plan.extended_info?.length > 0 && (
            <div className="extendedInfoBlock">
              <button
                type="button"
                className="textButton"
                onClick={() => setShowExtended((v) => !v)}
              >
                {showExtended ? "Hide" : "Show"} additional clinical background ({plan.extended_info.length})
              </button>
              {showExtended && (
                <div className="extendedInfoPanel">
                  <p className="muted extendedInfoNotice">
                    General medical knowledge beyond the supplied STG/EML excerpt — educational context only, verify locally before acting on it.
                  </p>
                  <ul className="cleanList">
                    {plan.extended_info.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

export function slugify(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
