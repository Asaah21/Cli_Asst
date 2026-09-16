// Dose arithmetic lives here, never in a prompt.
//
// The model supplies a dose *rule* ("15 mg/kg/dose, max 500 mg, TDS"); this
// module turns that rule into this patient's milligrams. A language model
// produces plausible-looking arithmetic rather than performing arithmetic, and
// when weight is missing it will supply a number anyway. Code knows when it
// cannot calculate.

export type DoseRule =
  | { basis: "fixed"; mg: number; doses_per_day: number; duration_days: number | null }
  | {
      basis: "mg_per_kg";
      mg_per_kg_per_dose: number;
      max_mg_per_dose: number;
      doses_per_day: number;
      duration_days: number | null;
    }
  | {
      basis: "age_band";
      bands: { max_age_years: number; mg: number }[];
      doses_per_day: number;
      duration_days: number | null;
    }
  | { basis: "narrative"; text: string };

export type Rx = {
  drug: string;
  route: string; // "PO", "IM", "IV", "PR", "topical"
  dose_rule: DoseRule;
  formulation_hint?: string; // e.g. "125 mg/5 ml suspension"
  purpose?: string; // adjuncts only: "Fever", "Pain", "Vomiting"
  min_age_years?: number;
};

export type ComputedDose = {
  line: string; // "Amoxicillin 250 mg PO TDS x 5 days"
  volume?: string; // "10 ml of 125 mg/5 ml suspension"
  incomplete?: string; // set when a required input (weight, age) is missing
};

/** Structural subset of PatientInput — keeps this module dependency-free. */
export type DosingPatient = {
  age?: number | null;
  age_months?: number | null;
  weight?: number | null;
};

const FREQUENCY_WORDS: Record<number, string> = { 1: "OD", 2: "BD", 3: "TDS", 4: "QDS" };

const CONCENTRATION = /(\d+(?:\.\d+)?)\s*mg\s*(?:\/|per|in)\s*(\d+(?:\.\d+)?)\s*m\s*l/i;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function joinParts(parts: (string | undefined | null)[]): string {
  return parts.filter((part) => typeof part === "string" && part.trim()).join(" ");
}

/**
 * Nearest 50 mg above 250 mg, nearest 25 mg from 50–250 mg, nearest 5 mg below 50 mg.
 *
 * Only applied to weight-derived figures. A `fixed` or `age_band` dose is already
 * a stated, practical figure (paracetamol 120 mg for 1–5 years, say) and rounding
 * it would distort the rule rather than tidy a calculation.
 */
export function roundDose(mg: number): number {
  if (!isPositiveNumber(mg)) return 0;
  const step = mg > 250 ? 50 : mg >= 50 ? 25 : 5;
  const rounded = Math.round(mg / step) * step;
  return rounded > 0 ? rounded : step;
}

export function frequencyLabel(dosesPerDay: number): string {
  if (!isPositiveNumber(dosesPerDay)) return "";
  const word = FREQUENCY_WORDS[dosesPerDay];
  if (word) return word;
  return `every ${formatNumber(24 / dosesPerDay)} hours`;
}

export function durationLabel(days: number | null | undefined, isAdjunct: boolean): string {
  if (!isPositiveNumber(days)) return isAdjunct ? "as needed" : "review at follow-up";
  return `x ${formatNumber(days)} day${days === 1 ? "" : "s"}`;
}

export function ageInYears(patient: DosingPatient | null | undefined): number | null {
  const years = patient?.age;
  if (typeof years === "number" && Number.isFinite(years) && years >= 0) return years;

  const months = patient?.age_months;
  if (typeof months === "number" && Number.isFinite(months) && months >= 0) return months / 12;

  return null;
}

/** Returns undefined rather than a wrong volume when the hint cannot be parsed. */
export function volumeFor(mg: number, hint: string | undefined): string | undefined {
  if (!hint || !isPositiveNumber(mg)) return undefined;

  const match = CONCENTRATION.exec(hint);
  if (!match) return undefined;

  const strength = Number(match[1]);
  const per = Number(match[2]);
  if (!isPositiveNumber(strength) || !isPositiveNumber(per)) return undefined;

  const ml = (mg * per) / strength;
  if (!isPositiveNumber(ml)) return undefined;

  return `${formatNumber(Math.round(ml * 10) / 10)} ml of ${hint.trim()}`;
}

function bandSummary(bands: { max_age_years: number; mg: number }[]): string {
  return bands
    .map((band) => `up to ${formatNumber(band.max_age_years)}y: ${formatNumber(band.mg)} mg`)
    .join(", ");
}

export function computeDose(rx: Rx, patient: DosingPatient): ComputedDose {
  const drug = typeof rx?.drug === "string" ? rx.drug.trim() : "";
  const route = typeof rx?.route === "string" ? rx.route.trim() : "";
  const isAdjunct = Boolean(rx?.purpose);
  const fallback: ComputedDose = { line: joinParts([drug, route]) || drug || "Unspecified medicine" };

  try {
    const rule = rx?.dose_rule;
    if (!rule || typeof rule !== "object") return fallback;

    if (rule.basis === "narrative") {
      const text = typeof rule.text === "string" ? rule.text.trim() : "";
      return { line: text ? joinParts([drug, "—", text]) : fallback.line };
    }

    if (rule.basis === "fixed") {
      if (!isPositiveNumber(rule.mg)) return fallback;
      const mg = rule.mg;
      return {
        line: joinParts([
          drug,
          `${formatNumber(mg)} mg`,
          route,
          frequencyLabel(rule.doses_per_day),
          durationLabel(rule.duration_days, isAdjunct),
        ]),
        volume: volumeFor(mg, rx.formulation_hint),
      };
    }

    if (rule.basis === "mg_per_kg") {
      if (!isPositiveNumber(rule.mg_per_kg_per_dose)) return fallback;

      const weight = patient?.weight;
      const frequency = frequencyLabel(rule.doses_per_day);
      const duration = durationLabel(rule.duration_days, isAdjunct);

      if (!isPositiveNumber(weight)) {
        // Do not guess. Show the rule and ask for the missing input.
        return {
          line: joinParts([
            drug,
            `${formatNumber(rule.mg_per_kg_per_dose)} mg/kg/dose`,
            route,
            frequency,
            duration,
          ]),
          incomplete: "Enter weight to calculate this dose",
        };
      }

      const raw = weight * rule.mg_per_kg_per_dose;
      const capped = isPositiveNumber(rule.max_mg_per_dose)
        ? Math.min(raw, rule.max_mg_per_dose)
        : raw;
      const mg = roundDose(capped);

      return {
        line: joinParts([drug, `${formatNumber(mg)} mg`, route, frequency, duration]),
        volume: volumeFor(mg, rx.formulation_hint),
      };
    }

    if (rule.basis === "age_band") {
      const bands = Array.isArray(rule.bands)
        ? rule.bands
            .filter((band) => band && Number.isFinite(band.max_age_years) && isPositiveNumber(band.mg))
            .slice()
            .sort((a, b) => a.max_age_years - b.max_age_years)
        : [];

      if (!bands.length) return fallback;

      const frequency = frequencyLabel(rule.doses_per_day);
      const duration = durationLabel(rule.duration_days, isAdjunct);
      const age = ageInYears(patient);

      if (age === null) {
        return {
          line: joinParts([drug, bandSummary(bands), route, frequency, duration]),
          incomplete: "Enter age to select the correct dose band",
        };
      }

      const band = bands.find((candidate) => age <= candidate.max_age_years);

      if (!band) {
        return {
          line: joinParts([drug, bandSummary(bands), route, frequency, duration]),
          incomplete: "No dose band covers this age",
        };
      }

      const mg = band.mg;
      return {
        line: joinParts([drug, `${formatNumber(mg)} mg`, route, frequency, duration]),
        volume: volumeFor(mg, rx.formulation_hint),
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}
