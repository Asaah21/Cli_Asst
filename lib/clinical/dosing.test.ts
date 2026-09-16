import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDose, roundDose, volumeFor } from "./dosing.ts";
import type { Rx } from "./dosing.ts";

const amoxicillin: Rx = {
  drug: "Amoxicillin",
  route: "PO",
  dose_rule: {
    basis: "mg_per_kg",
    mg_per_kg_per_dose: 15,
    max_mg_per_dose: 500,
    doses_per_day: 3,
    duration_days: 5,
  },
  formulation_hint: "125 mg/5 ml suspension",
};

test("mg/kg with weight multiplies, rounds and names the frequency", () => {
  const result = computeDose(amoxicillin, { age: 4, weight: 15 });

  // 15 kg x 15 mg/kg = 225 mg -> nearest 25 mg
  assert.equal(result.line, "Amoxicillin 225 mg PO TDS x 5 days");
  assert.equal(result.incomplete, undefined);
});

test("mg/kg without weight shows the rule and refuses to guess", () => {
  const result = computeDose(amoxicillin, { age: 4, weight: null });

  assert.equal(result.incomplete, "Enter weight to calculate this dose");
  assert.match(result.line, /15 mg\/kg\/dose/);
  assert.ok(!/\d+ mg /.test(result.line.replace("15 mg/kg/dose", "")), "no absolute mg figure");
  assert.equal(result.volume, undefined);
});

test("mg/kg result is capped at max_mg_per_dose", () => {
  // 70 kg x 15 mg/kg = 1050 mg, capped to 500 mg
  const result = computeDose(amoxicillin, { age: 30, weight: 70 });

  assert.equal(result.line, "Amoxicillin 500 mg PO TDS x 5 days");
});

test("age bands select the band covering the patient's age", () => {
  const paracetamol: Rx = {
    drug: "Paracetamol",
    route: "PO",
    purpose: "Fever",
    dose_rule: {
      basis: "age_band",
      bands: [
        { max_age_years: 1, mg: 60 },
        { max_age_years: 5, mg: 120 },
        { max_age_years: 12, mg: 250 },
      ],
      doses_per_day: 4,
      duration_days: null,
    },
  };

  assert.equal(computeDose(paracetamol, { age: 4 }).line, "Paracetamol 120 mg PO QDS as needed");
  assert.equal(computeDose(paracetamol, { age: 0.5 }).line, "Paracetamol 60 mg PO QDS as needed");
  assert.equal(computeDose(paracetamol, { age: 10 }).line, "Paracetamol 250 mg PO QDS as needed");

  // Above every band: say so rather than picking one.
  assert.equal(computeDose(paracetamol, { age: 40 }).incomplete, "No dose band covers this age");

  // No age at all: same refusal to guess.
  assert.equal(
    computeDose(paracetamol, {}).incomplete,
    "Enter age to select the correct dose band"
  );
});

test("suspension volume is computed from the formulation hint", () => {
  const result = computeDose(amoxicillin, { age: 4, weight: 15 });

  // 225 mg of 125 mg/5 ml = 9 ml
  assert.equal(result.volume, "9 ml of 125 mg/5 ml suspension");
  assert.equal(volumeFor(250, "125 mg/5 ml suspension"), "10 ml of 125 mg/5 ml suspension");
});

test("a malformed formulation string omits the volume rather than guessing", () => {
  const malformed: Rx = {
    ...amoxicillin,
    formulation_hint: "suspension, strength unclear",
  };

  const result = computeDose(malformed, { age: 4, weight: 15 });

  assert.equal(result.line, "Amoxicillin 225 mg PO TDS x 5 days");
  assert.equal(result.volume, undefined);
  assert.equal(volumeFor(250, "0 mg/0 ml"), undefined);
  assert.equal(volumeFor(250, undefined), undefined);
});

test("stated doses pass through unrounded; only computed figures are rounded", () => {
  // 120 mg is a real paediatric band dose — it must not become 125 mg.
  const banded: Rx = {
    drug: "Paracetamol",
    route: "PO",
    dose_rule: {
      basis: "age_band",
      bands: [{ max_age_years: 5, mg: 120 }],
      doses_per_day: 4,
      duration_days: null,
    },
  };
  assert.match(computeDose(banded, { age: 3 }).line, /120 mg/);

  const fixedOddStrength: Rx = {
    drug: "Digoxin",
    route: "PO",
    dose_rule: { basis: "fixed", mg: 62.5, doses_per_day: 1, duration_days: null },
  };
  assert.match(computeDose(fixedOddStrength, {}).line, /62\.5 mg/);
});

test("rounding tiers", () => {
  assert.equal(roundDose(47), 45); // below 50 -> nearest 5
  assert.equal(roundDose(225), 225); // 50-250 -> nearest 25
  assert.equal(roundDose(240), 250);
  assert.equal(roundDose(1050), 1050); // above 250 -> nearest 50
  assert.equal(roundDose(273), 250);
  assert.equal(roundDose(280), 300);
  assert.equal(roundDose(2), 5); // never rounds a real dose to zero
  assert.equal(roundDose(0), 0);
});

test("fixed doses and narrative fallbacks never throw", () => {
  const fixed: Rx = {
    drug: "Metronidazole",
    route: "PO",
    dose_rule: { basis: "fixed", mg: 400, doses_per_day: 3, duration_days: 7 },
  };
  assert.equal(computeDose(fixed, {}).line, "Metronidazole 400 mg PO TDS x 7 days");

  const narrative: Rx = {
    drug: "ORS",
    route: "PO",
    dose_rule: { basis: "narrative", text: "One sachet in 1 L after each loose stool" },
  };
  assert.equal(
    computeDose(narrative, {}).line,
    "ORS — One sachet in 1 L after each loose stool"
  );

  // Garbage in, no throw out.
  const broken = { drug: "Mystery", route: "PO" } as unknown as Rx;
  assert.equal(computeDose(broken, {}).line, "Mystery PO");
});

test("main regimens without a duration say review at follow-up, adjuncts say as needed", () => {
  const ongoing: Rx = {
    drug: "Amlodipine",
    route: "PO",
    dose_rule: { basis: "fixed", mg: 5, doses_per_day: 1, duration_days: null },
  };
  assert.equal(computeDose(ongoing, {}).line, "Amlodipine 5 mg PO OD review at follow-up");

  const adjunct: Rx = { ...ongoing, purpose: "Blood pressure" };
  assert.equal(computeDose(adjunct, {}).line, "Amlodipine 5 mg PO OD as needed");
});

test("unusual frequencies fall back to an hourly interval", () => {
  const sixHourly: Rx = {
    drug: "Ibuprofen",
    route: "PO",
    dose_rule: { basis: "fixed", mg: 400, doses_per_day: 6, duration_days: 3 },
  };
  assert.equal(computeDose(sixHourly, {}).line, "Ibuprofen 400 mg PO every 4 hours x 3 days");
});
