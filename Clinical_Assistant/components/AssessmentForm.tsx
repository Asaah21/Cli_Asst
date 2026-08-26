"use client";

import { useMemo, useState } from "react";

type Diagnosis = {
  condition: string;
  likelihood: string;
  why: string;
};

type TestRecommendation = {
  test: string;
  reason: string;
  priority: string;
};

type Plan = {
  condition: string;
  b2: string[];
  c: string[];
  alternatives: string[];
  contraindications: string[];
  cautions: string[];
  monitoring: string[];
};

type Result = {
  summary: string;
  urgency: string;
  red_flags: string[];
  questions: string[];
  possible_diagnoses: Diagnosis[];
  tests: TestRecommendation[];
  plans: Plan[];
  immediate_actions: string[];
  disposition: string;
  source_notes: string[];
};

type Evidence = {
  conditions: Array<{
    id: number;
    condition: string;
    source_pages?: string | null;
  }>;
  medications: Array<{
    id: number;
    drug: string;
    formulation?: string | null;
    strength?: string | null;
    level_of_care?: string | null;
    eml_page?: string | null;
    contraindications?: string | null;
    cautions?: string | null;
  }>;
};

const initialForm = {
  facilityLevel: "C",
  preferredLevel: "B2",
  pregnancy: "Unknown",
  age: "",
  sex: "",
  weight: "",
  temp: "",
  bp: "",
  pulse: "",
  rr: "",
  spo2: "",
  rbs: "",
  hb: "",
  allergies: "",
  complaints: "",
  extra: "",
  tests: "",
};

function Field({ label, name, form, set, wide = false, type = "text" }: any) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input
        type={type}
        value={form[name] ?? ""}
        onChange={(e) => set(name, e.target.value)}
      />
    </label>
  );
}

function Section({ title, description, children, tone = "default" }: any) {
  return (
    <section className={`resultSection ${tone}`}>
      <div className="sectionHeading">
        <div>
          <h3>{title}</h3>
          {description && <p className="muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Tag({ children, kind = "neutral" }: any) {
  return <span className={`tag ${kind}`}>{children}</span>;
}

export default function AssessmentForm() {
  const [form, setForm] = useState<any>(initialForm);
  const [result, setResult] = useState<Result | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>({});
  const [showEvidence, setShowEvidence] = useState(false);

  const set = (key: string, value: string) => setForm((current: any) => ({ ...current, [key]: value }));

  const filledQuestionCount = useMemo(
    () => Object.values(questionAnswers).filter((value) => value.trim()).length,
    [questionAnswers]
  );

  async function assess() {
    setLoading(true);
    setError("");
    try {
      const answeredQuestions = Object.entries(questionAnswers)
        .filter(([, answer]) => answer.trim())
        .map(([index, answer]) => `Question ${Number(index) + 1}: ${answer.trim()}`)
        .join("\n");

      const payload = {
        ...form,
        extra: [form.extra, answeredQuestions].filter(Boolean).join("\n\n"),
      };

      const response = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Assessment failed.");

      setResult(data.result);
      setEvidence(data.evidence ?? null);
      window.setTimeout(() => {
        document.getElementById("assessment-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err: any) {
      setError(err.message || "Assessment failed.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setForm(initialForm);
    setResult(null);
    setEvidence(null);
    setError("");
    setQuestionAnswers({});
  }

  return (
    <>
      <section className="card intakeCard">
        <div className="cardHeader">
          <div>
            <span className="eyebrow">NEW CONSULTATION</span>
            <h2>Patient assessment</h2>
            <p className="muted">
              Enter what you know. The assistant uses the whole encounter, then checks the STG/EML database before presenting treatment.
            </p>
          </div>
          <div className="settingPills">
            <Tag kind="facility">Facility C</Tag>
            <Tag kind="b2">B2 preferred</Tag>
            <Tag kind="c">C options included</Tag>
          </div>
        </div>

        <div className="subheading">Patient</div>
        <div className="formGrid">
          <Field label="Age (years)" name="age" form={form} set={set} type="number" />
          <label className="field">
            <span>Sex</span>
            <select value={form.sex} onChange={(e) => set("sex", e.target.value)}>
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <Field label="Weight (kg)" name="weight" form={form} set={set} type="number" />
          <label className="field">
            <span>Pregnancy</span>
            <select value={form.pregnancy} onChange={(e) => set("pregnancy", e.target.value)}>
              <option>Unknown</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
          <Field label="Allergies" name="allergies" form={form} set={set} wide />
        </div>

        <div className="subheading">Vitals & bedside measurements</div>
        <div className="formGrid">
          <Field label="Temperature °C" name="temp" form={form} set={set} type="number" />
          <Field label="BP" name="bp" form={form} set={set} />
          <Field label="Pulse /min" name="pulse" form={form} set={set} type="number" />
          <Field label="RR /min" name="rr" form={form} set={set} type="number" />
          <Field label="SpO₂ %" name="spo2" form={form} set={set} type="number" />
          <Field label="RBS" name="rbs" form={form} set={set} />
          <Field label="Hb" name="hb" form={form} set={set} />
        </div>

        <div className="subheading">Clinical story</div>
        <div className="formGrid">
          <label className="field wide">
            <span>Main complaint, symptoms, signs & duration</span>
            <textarea value={form.complaints} onChange={(e) => set("complaints", e.target.value)} placeholder="e.g. waist pain for 3 days, fever since yesterday..." />
          </label>
          <label className="field wide">
            <span>Extra history / examination findings</span>
            <textarea value={form.extra} onChange={(e) => set("extra", e.target.value)} placeholder="Trauma, urinary symptoms, discharge, menstrual history, medications, past history, neurological findings, etc." />
          </label>
          <label className="field wide">
            <span>Tests already done + results</span>
            <textarea value={form.tests} onChange={(e) => set("tests", e.target.value)} placeholder="RDT negative; pregnancy negative; Hb 10.2 g/dL; etc." />
          </label>
        </div>

        {error && <div className="errorBox">{error}</div>}

        <div className="actionRow">
          <button className="primaryButton" onClick={assess} disabled={loading}>
            {loading ? "Assessing..." : result ? "Reassess patient" : "Assess patient"}
          </button>
          <button className="secondaryButton" onClick={reset} disabled={loading}>Clear</button>
        </div>
      </section>

      {result && (
        <section id="assessment-results" className="resultsCard card">
          <div className="resultHero">
            <div>
              <span className="eyebrow">DECISION SUPPORT</span>
              <h2>Clinical assessment</h2>
              <p>{result.summary}</p>
            </div>
            <div className="urgencyPanel">
              <span className="muted">Urgency</span>
              <strong>{result.urgency}</strong>
            </div>
          </div>

          {result.red_flags?.length > 0 && (
            <Section title="Red flags / urgent issues" tone="danger">
              <ul className="cleanList">{result.red_flags.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </Section>
          )}

          <Section title="Possible diagnoses" description="Ranked possibilities, not confirmed diagnoses.">
            <div className="diagnosisList">
              {result.possible_diagnoses?.map((item, i) => (
                <article className="diagnosisCard" key={`${item.condition}-${i}`}>
                  <div className="diagnosisTop">
                    <div className="diagnosisIndex">{i + 1}</div>
                    <div>
                      <h4>{item.condition}</h4>
                      <Tag kind={item.likelihood?.toLowerCase() === "high" ? "high" : item.likelihood?.toLowerCase() === "moderate" ? "moderate" : "low"}>{item.likelihood}</Tag>
                    </div>
                  </div>
                  <p>{item.why}</p>
                </article>
              ))}
            </div>
          </Section>

          {result.questions?.length > 0 && (
            <Section
              title="Questions to ask next"
              description="Answer these and click Reassess. Answers are added to the next clinical assessment."
            >
              <div className="questionList">
                {result.questions.map((question, i) => (
                  <div className="questionRow" key={i}>
                    <div className="questionNumber">{i + 1}</div>
                    <div className="questionBody">
                      <strong>{question}</strong>
                      <textarea
                        value={questionAnswers[i] ?? ""}
                        onChange={(e) => setQuestionAnswers((current) => ({ ...current, [i]: e.target.value }))}
                        placeholder="Enter the patient's answer / your finding"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="questionFooter">
                <span className="muted">{filledQuestionCount} answer(s) entered</span>
                <button className="primaryButton smallButton" onClick={assess} disabled={loading}>
                  {loading ? "Reassessing..." : "Reassess with answers"}
                </button>
              </div>
            </Section>
          )}

          {result.tests?.length > 0 && (
            <Section title="Targeted tests" description="Tests selected to help distinguish the leading possibilities.">
              <div className="testGrid">
                {result.tests.map((test, i) => (
                  <article className="testCard" key={i}>
                    <div className="cardInlineHeader">
                      <h4>{test.test}</h4>
                      <Tag kind={test.priority?.toLowerCase() === "urgent" ? "danger" : "neutral"}>{test.priority}</Tag>
                    </div>
                    <p>{test.reason}</p>
                  </article>
                ))}
              </div>
            </Section>
          )}

          {result.immediate_actions?.length > 0 && (
            <Section title="Immediate management" tone="action">
              <ul className="cleanList">{result.immediate_actions.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </Section>
          )}

          <Section title="Treatment plan" description="B2 is shown first. C-level options remain visible separately when supported by the supplied EML/STG evidence.">
            <div className="treatmentList">
              {result.plans?.map((plan, i) => (
                <article className="treatmentCard" key={`${plan.condition}-${i}`}>
                  <h4>{plan.condition}</h4>
                  <div className="treatmentColumns">
                    <div className="treatmentBox b2Box">
                      <div className="treatmentLabel">B2</div>
                      {plan.b2?.length ? <ul className="cleanList">{plan.b2.map((item, j) => <li key={j}>{item}</li>)}</ul> : <p className="muted">No supported B2 option retrieved.</p>}
                    </div>
                    <div className="treatmentBox cBox">
                      <div className="treatmentLabel">C level</div>
                      {plan.c?.length ? <ul className="cleanList">{plan.c.map((item, j) => <li key={j}>{item}</li>)}</ul> : <p className="muted">No supported C-level option retrieved.</p>}
                    </div>
                  </div>
                  <div className="miniGrid">
                    {plan.alternatives?.length > 0 && <div><h5>Alternatives</h5><ul className="cleanList">{plan.alternatives.map((item, j) => <li key={j}>{item}</li>)}</ul></div>}
                    {plan.contraindications?.length > 0 && <div><h5>Contraindications</h5><ul className="cleanList">{plan.contraindications.map((item, j) => <li key={j}>{item}</li>)}</ul></div>}
                    {plan.cautions?.length > 0 && <div><h5>Cautions</h5><ul className="cleanList">{plan.cautions.map((item, j) => <li key={j}>{item}</li>)}</ul></div>}
                    {plan.monitoring?.length > 0 && <div><h5>Monitoring</h5><ul className="cleanList">{plan.monitoring.map((item, j) => <li key={j}>{item}</li>)}</ul></div>}
                  </div>
                </article>
              ))}
            </div>
          </Section>

          <Section title="24-hour management & disposition">
            <div className="dispositionBox">{result.disposition}</div>
          </Section>

          {result.source_notes?.length > 0 && (
            <Section title="Source notes">
              <ul className="cleanList">{result.source_notes.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </Section>
          )}

          <div className="evidenceBar">
            <div>
              <strong>Evidence used:</strong> {evidence?.conditions.length ?? 0} STG record(s), {evidence?.medications.length ?? 0} B2/C EML medicine record(s).
            </div>
            <button className="textButton" onClick={() => setShowEvidence((value) => !value)}>
              {showEvidence ? "Hide evidence" : "Show evidence"}
            </button>
          </div>

          {showEvidence && evidence && (
            <div className="evidencePanel">
              <div>
                <h4>STG records retrieved</h4>
                <ul className="cleanList">{evidence.conditions.map((item) => <li key={item.id}><strong>{item.condition}</strong>{item.source_pages ? ` — ${item.source_pages}` : ""}</li>)}</ul>
              </div>
              <div>
                <h4>EML medicine records retrieved</h4>
                <ul className="cleanList">{evidence.medications.map((item) => <li key={item.id}><strong>{item.drug}</strong> — {item.formulation ?? ""} {item.strength ?? ""} <Tag kind={item.level_of_care === "B2" ? "b2" : "c"}>{item.level_of_care ?? ""}</Tag>{item.eml_page ? ` · p.${item.eml_page}` : ""}</li>)}</ul>
              </div>
            </div>
          )}

          <div className="safetyNotice">
            <strong>Clinical safety:</strong> This is decision support, not an autonomous diagnosis or prescribing system. Verify treatment, dose, route, contraindications and current Ghana guidance before prescribing. The supplied source material includes older guidance and may require confirmation against current official updates.
          </div>
        </section>
      )}
    </>
  );
}
