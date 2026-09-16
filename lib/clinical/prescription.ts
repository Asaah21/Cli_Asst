// Best-effort parser for a clinician's free-text prescription.
//
// Its only hard job is recovering the drug name, because that is what the
// deterministic safety checks match on. Dose, frequency and duration are a
// bonus for the prompt. A line we cannot parse is kept raw rather than dropped.

export type ParsedLine = {
  raw: string;
  drug: string;
  dose?: string;
  frequency?: string;
  duration?: string;
};

const FREQUENCY =
  /\b(od|bd|tds|qds|nocte|prn|stat|once daily|twice daily|three times daily|four times daily|every \d+ hours?)\b/i;
const DOSE = /\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml|iu|units?)\b/i;
const DURATION = /\b(?:x|for)\s*\d+\s*(?:\/7|days?|weeks?|months?)\b|\b\d+\s*(?:days?|weeks?)\b/i;

export function parsePrescription(text: string): ParsedLine[] {
  return String(text ?? "")
    .split(/\r?\n|;/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((raw) => {
      // Drop list markers ("1.", "-", "•") and any leading form ("Tab.", "Cap").
      const stripped = raw.replace(/^[-*•\d.\s)]+/, "").trim();
      const beforeNumber = /^[^0-9]+/.exec(stripped);
      const drug = (beforeNumber ? beforeNumber[0] : stripped).replace(/[-–—:,(/]+$/, "").trim();

      return {
        raw,
        drug: drug || stripped,
        dose: DOSE.exec(stripped)?.[0],
        frequency: FREQUENCY.exec(stripped)?.[0],
        duration: DURATION.exec(stripped)?.[0],
      };
    });
}
