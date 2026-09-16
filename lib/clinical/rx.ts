// Gemini-facing schema for a prescription line, plus the normaliser that turns
// whatever comes back into the strict DoseRule union that dosing.ts expects.
//
// The schema is deliberately flat: structured-output models handle one object
// with a `basis` discriminator far more reliably than a true union, so the
// union is reconstructed here in TypeScript rather than asked for over the wire.

import type { DoseRule, Rx } from "./dosing.ts";

export const doseRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["basis"],
  properties: {
    basis: { type: "string", enum: ["fixed", "mg_per_kg", "age_band", "narrative"] },
    mg: { type: "number", nullable: true },
    mg_per_kg_per_dose: { type: "number", nullable: true },
    max_mg_per_dose: { type: "number", nullable: true },
    bands: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["max_age_years", "mg"],
        properties: {
          max_age_years: { type: "number" },
          mg: { type: "number" },
        },
      },
    },
    doses_per_day: { type: "number", nullable: true },
    duration_days: { type: "number", nullable: true },
    text: { type: "string", nullable: true },
  },
};

export const rxSchema = {
  type: "object",
  additionalProperties: false,
  required: ["drug", "route", "dose_rule"],
  properties: {
    drug: { type: "string" },
    route: { type: "string" },
    dose_rule: doseRuleSchema,
    formulation_hint: { type: "string", nullable: true },
    purpose: { type: "string", nullable: true },
    min_age_years: { type: "number", nullable: true },
  },
};

export const DOSE_RULE_PROMPT = `
DOSE RULES (never a specific patient's milligrams):
- Give every medicine a "dose_rule". Choose the basis that matches how the drug is actually dosed:
  - "mg_per_kg" for weight-based paediatric dosing: set mg_per_kg_per_dose, max_mg_per_dose, doses_per_day, duration_days.
  - "age_band" where the guideline gives fixed doses per age band: set bands (each with max_age_years and mg), doses_per_day, duration_days.
  - "fixed" for a standard adult/fixed dose: set mg, doses_per_day, duration_days.
  - "narrative" only when none of the above fit (e.g. ORS sachets, topicals): set text.
- duration_days may be null for ongoing or as-needed treatment.
- Do NOT multiply a rule out for this patient. State "15 mg/kg/dose, max 500 mg" as the rule; the application computes the patient's milligrams.
- Set formulation_hint to the dispensing strength where a suspension or syrup is likely, e.g. "125 mg/5 ml suspension", so a volume can be calculated.
- Set min_age_years when the drug has an age floor.
`;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDoseRule(raw: unknown): DoseRule {
  const source = (raw ?? {}) as Record<string, unknown>;
  const basis = str(source.basis);
  const dosesPerDay = num(source.doses_per_day) ?? 1;
  const durationDays = num(source.duration_days);
  const text = str(source.text);

  if (basis === "mg_per_kg") {
    const perKg = num(source.mg_per_kg_per_dose);
    if (perKg !== null && perKg > 0) {
      return {
        basis: "mg_per_kg",
        mg_per_kg_per_dose: perKg,
        max_mg_per_dose: num(source.max_mg_per_dose) ?? 0,
        doses_per_day: dosesPerDay,
        duration_days: durationDays,
      };
    }
  }

  if (basis === "age_band") {
    const bands = Array.isArray(source.bands)
      ? (source.bands as unknown[])
          .map((entry) => {
            const band = (entry ?? {}) as Record<string, unknown>;
            const maxAge = num(band.max_age_years);
            const mg = num(band.mg);
            return maxAge !== null && mg !== null && mg > 0
              ? { max_age_years: maxAge, mg }
              : null;
          })
          .filter((band): band is { max_age_years: number; mg: number } => band !== null)
      : [];

    if (bands.length) {
      return { basis: "age_band", bands, doses_per_day: dosesPerDay, duration_days: durationDays };
    }
  }

  if (basis === "fixed") {
    const mg = num(source.mg);
    if (mg !== null && mg > 0) {
      return { basis: "fixed", mg, doses_per_day: dosesPerDay, duration_days: durationDays };
    }
  }

  // Declared basis was unusable — fall back to whatever text we have rather
  // than dropping the medicine entirely.
  return { basis: "narrative", text: text || "Dose not specified — check the guideline" };
}

export function normalizeRx(raw: unknown): Rx {
  const source = (raw ?? {}) as Record<string, unknown>;
  const minAge = num(source.min_age_years);

  const rx: Rx = {
    drug: str(source.drug),
    route: str(source.route),
    dose_rule: normalizeDoseRule(source.dose_rule),
  };

  const formulation = str(source.formulation_hint);
  if (formulation) rx.formulation_hint = formulation;

  const purpose = str(source.purpose);
  if (purpose) rx.purpose = purpose;

  if (minAge !== null && minAge > 0) rx.min_age_years = minAge;

  return rx;
}

export function normalizeRxList(raw: unknown): Rx[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRx).filter((rx) => rx.drug);
}
