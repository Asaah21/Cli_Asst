-- Plan reviews: a clinician's own diagnosis and prescription, plus the critique.
-- Same policy shape as public.consultations.

create table if not exists public.plan_reviews(
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  patient_input jsonb not null,
  submitted_diagnosis text not null,
  submitted_prescription text not null,
  review jsonb not null
);

alter table public.plan_reviews enable row level security;

create policy "own plan reviews select" on public.plan_reviews
  for select to authenticated using (auth.uid() = clinician_id);
create policy "own plan reviews insert" on public.plan_reviews
  for insert to authenticated with check (auth.uid() = clinician_id);
create policy "own plan reviews update" on public.plan_reviews
  for update to authenticated using (auth.uid() = clinician_id)
  with check (auth.uid() = clinician_id);

create index if not exists plan_reviews_clinician_idx
  on public.plan_reviews(clinician_id, created_at desc);
