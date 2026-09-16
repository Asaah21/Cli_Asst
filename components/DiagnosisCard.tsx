"use client";

import { useState } from "react";

export type ComputedDose = {
  line: string;
  volume?: string;
  incomplete?: string;
};

export type ClientRx = {
  drug: string;
  route: string;
  purpose?: string;
  computed: ComputedDose;
};

export type SafetyFlag = {
  severity: "danger" | "warning";
  drug: string;
  message: string;
};

export type DiagnosisCardData = {
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

function flagsFor(rx: ClientRx, flags: SafetyFlag[], severity: SafetyFlag["severity"]) {
  const drug = rx.drug.toLowerCase();
  return flags.filter((flag) => flag.severity === severity && flag.drug.toLowerCase() === drug);
}

function RxLine({ rx, flags }: { rx: ClientRx; flags: SafetyFlag[] }) {
  const dangers = flagsFor(rx, flags, "danger");
  const warnings = flagsFor(rx, flags, "warning");
  const { computed } = rx;

  return (
    <li className="rxLine">
      <div className={`rxText ${dangers.length ? "struck" : ""} ${computed.incomplete ? "rxIncomplete" : ""}`}>
        {rx.purpose && <span className="rxPurpose">{rx.purpose}</span>}
        <span>{computed.line}</span>
        {computed.volume && <span className="rxVolume"> ({computed.volume})</span>}
      </div>

      {computed.incomplete && <div className="rxPrompt">{computed.incomplete}</div>}

      {warnings.map((flag, i) => (
        <div className="rxWarning" key={i}>
          {flag.message}
        </div>
      ))}
    </li>
  );
}

function RxGroup({
  title,
  list,
  flags,
}: {
  title: string;
  list: ClientRx[];
  flags: SafetyFlag[];
}) {
  if (!list?.length) return null;

  return (
    <div className="rxGroup">
      <h5>{title}</h5>
      <ul className="rxList">
        {list.map((rx, i) => (
          <RxLine rx={rx} flags={flags} key={`${rx.drug}-${i}`} />
        ))}
      </ul>
    </div>
  );
}

export default function DiagnosisCard({
  card,
  open,
  onToggle,
}: {
  card: DiagnosisCardData;
  open: boolean;
  onToggle: () => void;
}) {
  const [bullets, setBullets] = useState<string[] | null>(null);
  const [showBullets, setShowBullets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const dangers = (card.safety_flags ?? []).filter((flag) => flag.severity === "danger");

  async function learnMore() {
    if (loading) return;

    // Fetched once, then just toggled.
    if (bullets) {
      setShowBullets((value) => !value);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ condition: card.condition }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the deep dive.");

      setBullets(data.bullets ?? []);
      setShowBullets(true);
    } catch (err: any) {
      setError(err.message || "Could not load the deep dive.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="dxCard">
      <button type="button" className="dxHeader" onClick={onToggle} aria-expanded={open}>
        <span className="dxCondition">{card.condition}</span>
        <span className={`tag ${card.likelihood.toLowerCase()}`}>{card.likelihood}</span>
        <span className="dxWhy">{card.why}</span>
        <span className={`chevron ${open ? "open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="dxBody">
          {dangers.length > 0 && (
            <div className="dxDanger">
              {dangers.map((flag, i) => (
                <div key={i}>
                  <strong>{flag.drug}:</strong> {flag.message}
                </div>
              ))}
            </div>
          )}

          <RxGroup title="First line" list={card.first_line} flags={card.safety_flags} />
          <RxGroup title="Alternative" list={card.alternative} flags={card.safety_flags} />
          <RxGroup title="Also give" list={card.adjuncts} flags={card.safety_flags} />

          {card.non_drug?.length > 0 && (
            <div className="rxGroup">
              <h5>Non-drug</h5>
              <ul className="cleanList">
                {card.non_drug.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {card.refer_if?.length > 0 && (
            <div className="rxGroup">
              <h5>Refer if</h5>
              <ul className="cleanList">
                {card.refer_if.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {showBullets && bullets && bullets.length > 0 && (
            <div className="dxLearn">
              <ul className="cleanList">
                {bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="errorBox">{error}</div>}

          <div className="dxFooter">
            <span className="muted">{card.source}</span>
            <button type="button" className="textButton" onClick={learnMore} disabled={loading}>
              {loading ? "Loading..." : showBullets ? "Hide" : "Learn more"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
