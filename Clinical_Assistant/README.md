# Clinical Reference AI — V4

Next.js + Supabase + Gemini clinical decision-support prototype.

## What is new in V4
- Proper assessment-results interface.
- Whole-encounter AI reasoning using demographics, vitals, symptoms, history, examination and tests.
- Structured STG candidate retrieval in Supabase before treatment reasoning.
- Structured EML medication retrieval restricted to B2/C for the treatment stage.
- Separate B2 and C treatment columns.
- Targeted follow-up questions with answer boxes and a Reassess workflow.
- Targeted test recommendations.
- Red flags, immediate actions and 24-hour disposition.
- Evidence panel showing the STG records and B2/C medication records retrieved for the assessment.
- Consultation persistence includes patient input, structured assessment, source condition IDs and AI model.

## Environment
Create `.env.local` beside `package.json`:

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite

## Run
npm install
npm run dev

## Database
Use the existing Supabase database already loaded with the supplied STG and EML data. Do not rerun the large seed unless you intentionally reset the reference tables.

## Safety
This is decision support, not autonomous diagnosis or prescribing. Treatment claims are intended to be grounded in the supplied STG/EML records, but the supplied source material may be older than current official guidance. Verify current Ghana guidance, patient-specific contraindications and dosing before clinical use.
