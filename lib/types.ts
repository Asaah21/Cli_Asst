export type PatientInput = {
  age: number | null; // years
  age_months?: number | null; // optional, for infants under 2
  sex: "Female" | "Male" | "";
  weight?: number | null; // kg — only collected for children
  pregnancy: "Unknown" | "Yes" | "No";
  trimester?: 1 | 2 | 3 | null;
  allergies: string[]; // chips
  temp?: number | null;
  bp?: string;
  pulse?: number | null;
  complaints: string;
  extra?: string;
  tests?: string;
  rbs?: string; // behind "Add extra measurements"
  hb?: string; // behind "Add extra measurements"
};

export const EMPTY_PATIENT: PatientInput = {
  age: null,
  age_months: null,
  sex: "",
  weight: null,
  pregnancy: "Unknown",
  trimester: null,
  allergies: [],
  temp: null,
  bp: "",
  pulse: null,
  complaints: "",
  extra: "",
  tests: "",
  rbs: "",
  hb: "",
};

export function buildPatientText(patient: PatientInput): string {
  const age =
    patient.age !== null && patient.age !== undefined
      ? `${patient.age} years`
      : patient.age_months
        ? `${patient.age_months} months`
        : "not provided";

  const pregnancy =
    patient.pregnancy === "Yes"
      ? `Yes${patient.trimester ? ` (trimester ${patient.trimester})` : " (trimester not recorded)"}`
      : patient.pregnancy;

  return [
    `Age: ${age}`,
    `Sex: ${patient.sex || "not provided"}`,
    `Weight: ${patient.weight ?? "not provided"} kg`,
    `Pregnancy: ${pregnancy}`,
    `Allergies: ${patient.allergies?.length ? patient.allergies.join(", ") : "not provided"}`,
    `Temperature: ${patient.temp ?? "not provided"}`,
    `BP: ${patient.bp || "not provided"}`,
    `Pulse: ${patient.pulse ?? "not provided"}`,
    `RBS: ${patient.rbs || "not provided"}`,
    `Hb: ${patient.hb || "not provided"}`,
    `Complaints: ${patient.complaints || "not provided"}`,
    `Extra history/examination: ${patient.extra || "not provided"}`,
    `Tests already done: ${patient.tests || "not provided"}`,
  ].join("\n");
}
