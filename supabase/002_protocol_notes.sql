create table if not exists public.protocol_notes(id uuid primary key default gen_random_uuid(), clinician_id uuid not null references auth.users(id) on delete cascade, condition text not null, note text not null, created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.protocol_notes enable row level security;
create policy "own protocol notes select" on public.protocol_notes for select to authenticated using (auth.uid()=clinician_id);
create policy "own protocol notes insert" on public.protocol_notes for insert to authenticated with check (auth.uid()=clinician_id);
create policy "own protocol notes update" on public.protocol_notes for update to authenticated using (auth.uid()=clinician_id) with check (auth.uid()=clinician_id);
create policy "own protocol notes delete" on public.protocol_notes for delete to authenticated using (auth.uid()=clinician_id);
create index if not exists protocol_notes_clinician_condition_idx on public.protocol_notes(clinician_id, condition);
