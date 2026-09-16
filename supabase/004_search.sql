-- Full-text search over the Ghana STG conditions table.
--
-- Replaces the previous pattern of fetching several hundred rows into the API
-- route and scoring them in JavaScript: the whole guideline is now searched in
-- Postgres and only the top matches cross the wire.
--
-- (Numbered 004 rather than 003 because 003_guideline_updates.sql already
-- exists in this repository.)

alter table public.conditions
  add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('english',
      coalesce(condition,'') || ' ' ||
      coalesce(symptoms,'') || ' ' ||
      coalesce(signs,'') || ' ' ||
      coalesce(investigations,'') || ' ' ||
      coalesce(treatment,'') || ' ' ||
      coalesce(chapter,'')
    )
  ) stored;

create index if not exists conditions_search_vec_idx
  on public.conditions using gin(search_vec);

alter table public.medications
  add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('english',
      coalesce(drug,'') || ' ' ||
      coalesce(category,'') || ' ' ||
      coalesce(formulation,'')
    )
  ) stored;

create index if not exists medications_search_vec_idx
  on public.medications using gin(search_vec);

-- Ranked condition search. Accepts an array of search terms.
create or replace function public.search_conditions(terms text[], n int default 6)
returns table (
  id bigint,
  condition text,
  symptoms text,
  signs text,
  investigations text,
  treatment text,
  referral_criteria text,
  source_pages text,
  printed_page text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.condition, c.symptoms, c.signs, c.investigations,
         c.treatment, c.referral_criteria, c.source_pages, c.printed_page,
         max(ts_rank(c.search_vec, websearch_to_tsquery('english', t))) as rank
  from public.conditions c
  cross join unnest(terms) as t
  where c.search_vec @@ websearch_to_tsquery('english', t)
  group by c.id, c.condition, c.symptoms, c.signs, c.investigations,
           c.treatment, c.referral_criteria, c.source_pages, c.printed_page
  order by rank desc
  limit n;
$$;

create or replace function public.search_medications(terms text[], n int default 30)
returns table (
  id bigint,
  drug text,
  formulation text,
  strength text,
  level_of_care text,
  contraindications text,
  cautions text,
  eml_page text,
  category text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.drug, m.formulation, m.strength, m.level_of_care,
         m.contraindications, m.cautions, m.eml_page, m.category,
         max(ts_rank(m.search_vec, websearch_to_tsquery('english', t))) as rank
  from public.medications m
  cross join unnest(terms) as t
  where m.search_vec @@ websearch_to_tsquery('english', t)
  group by m.id, m.drug, m.formulation, m.strength, m.level_of_care,
           m.contraindications, m.cautions, m.eml_page, m.category
  order by rank desc
  limit n;
$$;

grant execute on function public.search_conditions(text[], int) to authenticated;
grant execute on function public.search_medications(text[], int) to authenticated;
