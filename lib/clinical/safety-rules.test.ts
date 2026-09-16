import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSafety } from "./safety-rules.ts";
import type { Rx } from "./dosing.ts";

function rx(drug: string, extra: Partial<Rx> = {}): Rx {
  return {
    drug,
    route: "PO",
    dose_rule: { basis: "narrative", text: "as directed" },
    ...extra,
  };
}

test("doxycycline in a confirmed pregnancy is a danger flag", () => {
  const flags = checkSafety([rx("Doxycycline")], {
    age: 28,
    sex: "Female",
    pregnancy: "Yes",
    trimester: 1,
  });

  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, "danger");
  assert.equal(flags[0].message, "Contraindicated in pregnancy.");
});

test("unknown pregnancy in a woman of childbearing age softens to a warning", () => {
  const flags = checkSafety([rx("Doxycycline")], {
    age: 28,
    sex: "Female",
    pregnancy: "Unknown",
  });

  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, "warning");
  assert.match(flags[0].message, /^Pregnancy status unknown — /);
});

test("pregnancy rules do not fire for men or outside childbearing age", () => {
  assert.equal(
    checkSafety([rx("Doxycycline")], { age: 28, sex: "Male", pregnancy: "Unknown" }).length,
    0
  );
  assert.equal(
    checkSafety([rx("Doxycycline")], { age: 70, sex: "Female", pregnancy: "Unknown" }).length,
    0
  );
  assert.equal(
    checkSafety([rx("Doxycycline")], { age: 28, sex: "Female", pregnancy: "No" }).length,
    0
  );
});

test("age rules fire below the threshold only", () => {
  assert.equal(checkSafety([rx("Aspirin")], { age: 9 })[0].severity, "danger");
  assert.equal(checkSafety([rx("Aspirin")], { age: 30 }).length, 0);

  // Infants: months are converted to years.
  assert.equal(checkSafety([rx("Chloramphenicol")], { age: null, age_months: 3 }).length, 1);
  assert.equal(checkSafety([rx("Chloramphenicol")], { age: 4 }).length, 0);

  // Unknown age cannot fire an age rule.
  assert.equal(checkSafety([rx("Aspirin")], {}).length, 0);
});

test("trimester rules respect the recorded trimester", () => {
  const third = checkSafety([rx("Ibuprofen")], {
    age: 30,
    sex: "Female",
    pregnancy: "Yes",
    trimester: 3,
  });
  assert.equal(third[0].severity, "danger");

  const first = checkSafety([rx("Ibuprofen")], {
    age: 30,
    sex: "Female",
    pregnancy: "Yes",
    trimester: 1,
  });
  assert.equal(first.length, 0);

  // Pregnant with no trimester recorded: softened rather than dropped.
  const unsure = checkSafety([rx("Ibuprofen")], {
    age: 30,
    sex: "Female",
    pregnancy: "Yes",
    trimester: null,
  });
  assert.equal(unsure[0].severity, "warning");
  assert.match(unsure[0].message, /^Trimester not recorded — /);
});

test("allergy chips fire on the matching drug family", () => {
  const penicillin = checkSafety([rx("Amoxicillin")], { age: 30, allergies: ["Penicillin"] });
  assert.equal(penicillin[0].severity, "danger");
  assert.equal(penicillin[0].message, "Patient reports penicillin allergy.");

  assert.equal(checkSafety([rx("Amoxicillin")], { age: 30, allergies: ["Sulfa"] }).length, 0);
  assert.equal(
    checkSafety([rx("Amoxicillin")], { age: 30, allergies: ["No known allergy"] }).length,
    0
  );
  assert.equal(checkSafety([rx("Amoxicillin")], { age: 30, allergies: [] }).length, 0);

  // Free-text "Other" entries still match when they name the family.
  assert.equal(
    checkSafety([rx("Ibuprofen")], { age: 30, allergies: ["NSAIDs and shellfish"] }).length,
    1
  );
});

test("a model-supplied age floor fires as danger", () => {
  const flags = checkSafety([rx("Artemether-lumefantrine", { min_age_years: 5 })], { age: 2 });

  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, "danger");
  assert.equal(flags[0].message, "Not suitable under 5 years.");
});

test("all conditions in a rule must hold", () => {
  // Cotrimoxazole third-trimester rule: pregnant, but first trimester.
  const flags = checkSafety([rx("Cotrimoxazole")], {
    age: 25,
    sex: "Female",
    pregnancy: "Yes",
    trimester: 1,
  });

  assert.equal(flags.length, 0);
});

test("duplicate flags are collapsed and multiple drugs are each checked", () => {
  const flags = checkSafety(
    [rx("Doxycycline"), rx("Doxycycline"), rx("Aspirin")],
    { age: 6, sex: "Female", pregnancy: "No" }
  );

  // Doxycycline under 8 (once, deduped) + aspirin under 16.
  assert.equal(flags.length, 2);
  assert.ok(flags.some((flag) => /dental staining/.test(flag.message)));
  assert.ok(flags.some((flag) => /Reye/.test(flag.message)));
});

test("an empty or malformed regimen list is safe", () => {
  assert.deepEqual(checkSafety([], { age: 30 }), []);
  assert.deepEqual(checkSafety([{ drug: "" } as Rx], { age: 30 }), []);
});
