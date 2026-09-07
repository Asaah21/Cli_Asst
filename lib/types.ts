export type PatientInput = {
  age?: number | null; sex?: string; weight?: number | null; pregnancy?: string;
  allergies?: string; temp?: number | null; bp?: string; pulse?: number | null;
  rr?: number | null; spo2?: number | null; rbs?: string; hb?: string;
  complaints?: string; extra?: string; tests?: string;
  facilityLevel?: "C"; preferredLevel?: "B2";
};
