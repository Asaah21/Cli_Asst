import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePrescription } from "./prescription.ts";
import { checkSafety } from "./safety-rules.ts";
import type { Rx } from "./dosing.ts";

test("one drug per line, with dose, frequency and duration picked out", () => {
  const lines = parsePrescription("Amoxicillin 500mg TDS x 5 days\nParacetamol 1g QDS prn");

  assert.equal(lines.length, 2);
  assert.equal(lines[0].drug, "Amoxicillin");
  assert.equal(lines[0].dose, "500mg");
  assert.equal(lines[0].frequency, "TDS");
  assert.equal(lines[0].duration, "x 5 days");
  assert.equal(lines[1].drug, "Paracetamol");
});

test("list markers and dosage forms do not break the drug name", () => {
  const lines = parsePrescription("1. Tab. Doxycycline 100mg BD\n- Cap Amoxicillin 250mg");

  assert.match(lines[0].drug, /Doxycycline/);
  assert.match(lines[1].drug, /Amoxicillin/);
});

test("an unparseable line is kept raw rather than dropped", () => {
  const lines = parsePrescription("give the usual cough mixture");

  assert.equal(lines.length, 1);
  assert.equal(lines[0].raw, "give the usual cough mixture");
  assert.equal(lines[0].drug, "give the usual cough mixture");
  assert.equal(lines[0].dose, undefined);
});

test("empty input yields no lines", () => {
  assert.deepEqual(parsePrescription(""), []);
  assert.deepEqual(parsePrescription("   \n  "), []);
});

test("a parsed prescription feeds the safety checks — doxycycline in pregnancy", () => {
  const parsed = parsePrescription("Tab. Doxycycline 100mg BD x 7 days");
  const rxList: Rx[] = parsed.map((line) => ({
    drug: line.drug,
    route: "",
    dose_rule: { basis: "narrative", text: line.raw },
  }));

  const flags = checkSafety(rxList, {
    age: 28,
    sex: "Female",
    pregnancy: "Yes",
    trimester: 1,
  });

  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, "danger");
  assert.match(flags[0].message, /pregnancy/i);
});
