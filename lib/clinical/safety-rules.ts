// Hard safety checks that run over every regimen after the model returns and
// before anything renders. A prompt instruction can be ignored by the model;
// this cannot.
//
// The rule table below is a seed. It MUST be reviewed and signed off by the
// clinician before release, and is expected to grow from real cases.

import type { Rx } from "./dosing.ts";
import { ageInYears } from "./dosing.ts";

export type SafetyFlag = {
  severity: "danger" | "warning";
  drug: string;
  message: string;
};

type Condition =
  | { type: "pregnancy" }
  | { type: "trimester"; values: (1 | 2 | 3)[] }
  | { type: "age_under_years"; value: number }
  | { type: "allergy"; matches: string[] };

type Rule = {
  match: RegExp;
  when: Condition[];
  severity: "danger" | "warning";
  message: string;
};

/** Structural subset of PatientInput — keeps this module dependency-free. */
export type SafetyPatient = {
  age?: number | null;
  age_months?: number | null;
  sex?: string;
  pregnancy?: "Unknown" | "Yes" | "No" | string;
  trimester?: 1 | 2 | 3 | null;
  allergies?: string[];
};

export const RULES: Rule[] = [
  { match: /doxycycline|tetracycline/i, when: [{ type: "pregnancy" }], severity: "danger",
    message: "Contraindicated in pregnancy." },
  { match: /doxycycline|tetracycline/i, when: [{ type: "age_under_years", value: 8 }], severity: "danger",
    message: "Avoid under 8 years — dental staining." },
  { match: /aspirin/i, when: [{ type: "age_under_years", value: 16 }], severity: "danger",
    message: "Avoid under 16 years — Reye's syndrome." },
  { match: /codeine/i, when: [{ type: "age_under_years", value: 12 }], severity: "danger",
    message: "Contraindicated under 12 years." },
  { match: /lisinopril|enalapril|captopril|losartan|valsartan/i, when: [{ type: "pregnancy" }],
    severity: "danger", message: "ACE inhibitors and ARBs are contraindicated in pregnancy." },
  { match: /ibuprofen|diclofenac|naproxen|indomethacin/i, when: [{ type: "trimester", values: [3] }],
    severity: "danger", message: "Avoid NSAIDs in the third trimester — ductus arteriosus closure." },
  { match: /chloramphenicol/i, when: [{ type: "age_under_years", value: 1 }], severity: "danger",
    message: "Avoid in neonates and young infants — grey baby syndrome." },
  { match: /co-?trimoxazole|sulfamethoxazole/i, when: [{ type: "trimester", values: [3] }],
    severity: "warning", message: "Avoid near term — kernicterus risk." },
  { match: /metronidazole/i, when: [{ type: "trimester", values: [1] }], severity: "warning",
    message: "Avoid high-dose regimens in the first trimester where an alternative exists." },
  { match: /albendazole|mebendazole/i, when: [{ type: "trimester", values: [1] }], severity: "warning",
    message: "Defer until after the first trimester unless clearly indicated." },
  { match: /ciprofloxacin|levofloxacin|ofloxacin/i, when: [{ type: "age_under_years", value: 18 }],
    severity: "warning", message: "Use in children only when no suitable alternative exists." },
  { match: /penicillin|amoxicillin|ampicillin|flucloxacillin|benzathine/i,
    when: [{ type: "allergy", matches: ["Penicillin"] }], severity: "danger",
    message: "Patient reports penicillin allergy." },
  { match: /co-?trimoxazole|sulfadoxine|sulfamethoxazole/i,
    when: [{ type: "allergy", matches: ["Sulfa"] }], severity: "danger",
    message: "Patient reports sulfa allergy." },
  { match: /ibuprofen|diclofenac|aspirin|naproxen/i,
    when: [{ type: "allergy", matches: ["NSAIDs"] }], severity: "danger",
    message: "Patient reports NSAID allergy." },
];

const CHILDBEARING_MIN = 10;
const CHILDBEARING_MAX = 55;

function couldBePregnant(patient: SafetyPatient): boolean {
  if (patient.sex !== "Female") return false;
  const age = ageInYears(patient);
  if (age === null) return true;
  return age >= CHILDBEARING_MIN && age <= CHILDBEARING_MAX;
}

type ConditionOutcome =
  | { holds: false }
  | { holds: true; downgrade?: string };

function evaluate(condition: Condition, patient: SafetyPatient): ConditionOutcome {
  switch (condition.type) {
    case "pregnancy": {
      if (patient.pregnancy === "Yes") return { holds: true };
      // Unknown status in a woman of childbearing age still fires, but softened.
      if (patient.pregnancy === "Unknown" && couldBePregnant(patient)) {
        return { holds: true, downgrade: "Pregnancy status unknown — " };
      }
      return { holds: false };
    }

    case "trimester": {
      if (patient.pregnancy === "Yes") {
        const trimester = patient.trimester;
        if (trimester && condition.values.includes(trimester)) return { holds: true };
        // Pregnant but trimester not recorded: a third-trimester NSAID warning is
        // worth showing softened rather than dropping silently.
        if (!trimester) return { holds: true, downgrade: "Trimester not recorded — " };
        return { holds: false };
      }
      if (patient.pregnancy === "Unknown" && couldBePregnant(patient)) {
        return { holds: true, downgrade: "Pregnancy status unknown — " };
      }
      return { holds: false };
    }

    case "age_under_years": {
      const age = ageInYears(patient);
      if (age === null) return { holds: false };
      return age < condition.value ? { holds: true } : { holds: false };
    }

    case "allergy": {
      const reported = (patient.allergies ?? []).map((entry) => String(entry).toLowerCase().trim());
      if (!reported.length) return { holds: false };
      if (reported.includes("no known allergy")) return { holds: false };
      const hit = condition.matches.some((candidate) =>
        reported.some((entry) => entry.includes(candidate.toLowerCase()))
      );
      return hit ? { holds: true } : { holds: false };
    }

    default:
      return { holds: false };
  }
}

export function checkSafety(rxList: Rx[], patient: SafetyPatient): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  const seen = new Set<string>();

  const push = (flag: SafetyFlag) => {
    const key = `${flag.severity}|${flag.drug.toLowerCase()}|${flag.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push(flag);
  };

  for (const rx of rxList ?? []) {
    const drug = typeof rx?.drug === "string" ? rx.drug.trim() : "";
    if (!drug) continue;

    for (const rule of RULES) {
      if (!rule.match.test(drug)) continue;

      let holds = true;
      let prefix = "";

      for (const condition of rule.when) {
        const outcome = evaluate(condition, patient);
        if (!outcome.holds) {
          holds = false;
          break;
        }
        if (outcome.downgrade && !prefix) prefix = outcome.downgrade;
      }

      if (!holds) continue;

      push({
        // A softened condition downgrades the whole flag.
        severity: prefix ? "warning" : rule.severity,
        drug,
        message: `${prefix}${rule.message}`,
      });
    }

    // Model-supplied age floor.
    const age = ageInYears(patient);
    if (typeof rx.min_age_years === "number" && Number.isFinite(rx.min_age_years) && age !== null) {
      if (age < rx.min_age_years) {
        push({
          severity: "danger",
          drug,
          message: `Not suitable under ${rx.min_age_years} years.`,
        });
      }
    }
  }

  return flags;
}
