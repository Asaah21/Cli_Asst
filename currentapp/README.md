# Clinical Assistant — Next.js + Supabase + Gemini

This version implements a two-stage AI clinical decision-support flow.

1. Gemini interprets the whole encounter: demographics, vitals, symptoms/signs, history and existing tests.
2. It produces a ranked differential, targeted follow-up questions, targeted simple tests and red flags.
3. Next.js retrieves relevant Ghana STG condition records from Supabase.
4. Next.js retrieves relevant B2/C EML medicine records.
5. Gemini then produces an evidence-grounded treatment/disposition plan with B2 and C options.
6. The consultation is saved to Supabase.

## Environment
Create `.env.local` in the project root:

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

## Run
npm install
npm run dev

## Database
The supplied schema and split seed files should be run in Supabase once. Do not rerun seed chunks unless the reference tables are intentionally reset.

## Clinical safety
This is clinical decision support, not an autonomous diagnostic or prescribing system. Treatment details are required to be grounded in retrieved STG/EML records. The supplied STG/EML may not be current; verify current official Ghana guidance before clinical use.
