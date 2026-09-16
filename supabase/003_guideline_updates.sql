-- Adds/updates conditions and medications with current international guidance as of
-- early 2026: WHO (PEN/HEARTS, mhGAP), ADA Standards of Care 2025/2026, GINA 2024/2025,
-- GOLD 2024/2025, IDSA (2014 SSTI guideline + 2023 update) / CDC, NICE NG222, and
-- Hypertension Canada / Diabetes Canada 2025.
--
-- Ghana STG/EML note: no edition newer than the 7th edition (2017) was found at the
-- time of this update (https://www.moh.gov.gh/wp-content/uploads/2020/07/GHANA-STG-2017-1.pdf).
-- The existing Ghana STG/EML content in this database is left untouched; the entries
-- below are appended as a clearly-labeled supplementary update, or inserted new if no
-- matching row exists yet, so this migration is safe to run against a populated table.
--
-- See docs/sources/guideline-updates-2026.md for the full citation list.

do $$
declare
  existing_id bigint;
begin
  ---------------------------------------------------------------------------
  -- Diabetes mellitus (Type 2)
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions
    where condition ilike '%diabetes mellitus%' or condition ilike '%type 2 diabetes%'
    order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — ADA Standards of Care 2025/2026, WHO PEN]\nLifestyle modification (diet, weight loss, 150 min/week activity) at every stage. First-line pharmacotherapy: metformin 500mg once daily with meals, titrate over weeks to 1000mg twice daily as tolerated (avoid if eGFR<30; caution eGFR 30-45). Add an SGLT2 inhibitor or GLP-1 receptor agonist irrespective of HbA1c if established atherosclerotic cardiovascular disease, heart failure or CKD, where available — for cardio-renal protection, not only glucose control. A GLP-1 or dual GIP/GLP-1 receptor agonist may be considered first-line for its weight benefit if obesity is the dominant driver and the agent is available/affordable. Where newer agents are unavailable/unaffordable: add a sulfonylurea (gliclazide, glimepiride) as second-line, monitoring for hypoglycaemia especially in older patients. Start insulin for very high HbA1c with symptomatic hyperglycaemia, or if optimised oral triple therapy fails. Monitor HbA1c 3-6 monthly; annual retinopathy, nephropathy (urine albumin:creatinine ratio) and diabetic foot screening.',
      investigations = coalesce(investigations, '') || E'\n\n[2026 update] Diagnosis: fasting plasma glucose ≥7.0 mmol/L, OR 2-hr OGTT ≥11.1 mmol/L, OR HbA1c ≥6.5%, OR random glucose ≥11.1 mmol/L with classic symptoms. Confirm with a repeat test unless hyperglycaemia is unequivocal.',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] Refer/escalate: diabetic ketoacidosis or hyperosmolar hyperglycaemic state, diabetes in pregnancy, foot ulceration/infection, uncontrolled disease on optimised triple therapy, suspected type 1 diabetes.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: ADA Standards of Care in Diabetes 2025/2026; WHO PEN (HEARTS-D)'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Diabetes mellitus (Type 2)',
      'Endocrine and metabolic',
      'Polyuria, polydipsia, polyphagia, unexplained weight loss, fatigue, blurred vision, recurrent skin/genital infections; may be asymptomatic and detected on screening.',
      'Acanthosis nigricans, obesity/central adiposity, peripheral neuropathy (reduced sensation), diabetic foot changes, fundoscopic retinopathy in longstanding disease.',
      'Fasting plasma glucose ≥7.0 mmol/L, OR 2-hr OGTT ≥11.1 mmol/L, OR HbA1c ≥6.5%, OR random glucose ≥11.1 mmol/L with classic symptoms. Confirm with a repeat test unless hyperglycaemia is unequivocal.',
      '[2026 — ADA Standards of Care 2025/2026, WHO PEN] Lifestyle modification (diet, weight loss, 150 min/week activity) at every stage. First-line pharmacotherapy: metformin 500mg once daily with meals, titrate to 1000mg twice daily as tolerated (avoid if eGFR<30; caution eGFR 30-45). Add an SGLT2 inhibitor or GLP-1 receptor agonist irrespective of HbA1c if established cardiovascular disease, heart failure or CKD, where available. A GLP-1/GIP-GLP-1 agonist may be first-line if obesity is the dominant driver and the agent is available/affordable. Where newer agents are unavailable: add a sulfonylurea (gliclazide, glimepiride) as second-line, monitoring for hypoglycaemia. Start insulin for very high HbA1c with symptomatic hyperglycaemia or failure of optimised oral triple therapy. Monitor HbA1c 3-6 monthly; annual retinopathy, nephropathy (urine ACR) and foot screening.',
      'Diabetic ketoacidosis/hyperosmolar hyperglycaemic state, diabetes in pregnancy, foot ulceration/infection, uncontrolled disease on optimised triple therapy, suspected type 1 diabetes.',
      'ADA Standards of Care in Diabetes 2025/2026; WHO PEN (HEARTS-D)'
    );
  end if;

  ---------------------------------------------------------------------------
  -- Asthma
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions where condition ilike '%asthma%' order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — GINA 2024/2025]\nPreferred strategy (Track 1): as-needed low-dose ICS-formoterol as reliever from the mildest step; maintenance-and-reliever therapy (MART) with low-dose ICS-formoterol as symptoms increase. Do not treat with SABA alone — GINA has advised against this since 2019 due to increased exacerbation risk. Where ICS-formoterol is unavailable (Track 2): daily low-dose ICS + as-needed SABA, stepping up to low then medium/high-dose ICS-LABA, then add-on LAMA/specialist referral. Acute exacerbation: repeated SABA (spacer or nebulised), oral prednisolone 40-50mg once daily for 5-7 days, oxygen to maintain SpO2 94-98%. Silent chest, SpO2<92%, exhaustion or cyanosis are life-threatening features needing emergency referral. Give every patient a written asthma action plan.',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] Life-threatening exacerbation features, poor control despite Step 4/5 therapy, suspected occupational asthma, frequent oral steroid courses.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: GINA 2024/2025'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Asthma',
      'Respiratory',
      'Episodic wheeze, cough (worse at night/early morning), chest tightness, breathlessness, often triggered by exercise, allergens, cold air or a viral URTI.',
      'Expiratory wheeze, prolonged expiratory phase; in a severe attack: accessory muscle use, inability to complete sentences, tachycardia, silent chest (life-threatening).',
      'Peak expiratory flow variability; spirometry showing reversible obstruction (FEV1 rise ≥12% and 200mL post-bronchodilator); consider CXR to exclude an alternative diagnosis.',
      '[2026 — GINA 2024/2025] Preferred (Track 1): as-needed low-dose ICS-formoterol as reliever from the mildest step; maintenance-and-reliever therapy (MART) with low-dose ICS-formoterol as symptoms increase. Do not treat with SABA alone. Where ICS-formoterol is unavailable (Track 2): daily low-dose ICS + as-needed SABA, stepping up to medium/high-dose ICS-LABA, then add-on LAMA/specialist referral. Acute exacerbation: repeated SABA, oral prednisolone 40-50mg OD for 5-7 days, oxygen to SpO2 94-98%. Silent chest/SpO2<92%/exhaustion/cyanosis = emergency referral. Provide a written asthma action plan.',
      'Life-threatening exacerbation features, poor control despite Step 4/5 therapy, suspected occupational asthma, frequent oral steroid courses.',
      'GINA 2024/2025'
    );
  end if;

  ---------------------------------------------------------------------------
  -- COPD
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions
    where condition ilike '%chronic obstructive%' or condition ilike '%copd%'
    order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — GOLD 2024/2025]\nUniversal: smoking cessation, vaccination (influenza, pneumococcal, COVID), pulmonary rehabilitation. Initial pharmacotherapy by group — Group A (low symptom/exacerbation burden): a bronchodilator (short- or long-acting). Group B (more symptomatic, low exacerbation risk): LABA+LAMA combination. Group E (≥2 moderate or ≥1 hospitalised exacerbation in the past year): LABA+LAMA; add an inhaled corticosteroid if blood eosinophils ≥300 cells/µL or features suggesting asthma-COPD overlap. Exacerbation: increase short-acting bronchodilator frequency, oral prednisolone ~40mg once daily for 5 days, antibiotics if increased sputum purulence plus increased volume/dyspnoea, controlled oxygen (target SpO2 88-92%, caution CO2 retention).',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] FEV1<30% predicted, cor pulmonale, frequent hospitalisations, need for long-term oxygen assessment, suspected lung cancer.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: GOLD 2024/2025'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Chronic obstructive pulmonary disease (COPD)',
      'Respiratory',
      'Progressive dyspnoea, chronic cough, sputum production; history of smoking or biomass fuel exposure.',
      'Prolonged expiration, wheeze, reduced breath sounds; barrel chest and cyanosis/cor pulmonale in advanced disease.',
      'Post-bronchodilator spirometry FEV1/FVC <0.70 confirms diagnosis; CXR to exclude other pathology; pulse oximetry; consider alpha-1 antitrypsin testing in early-onset disease or non-smokers.',
      '[2026 — GOLD 2024/2025] Universal: smoking cessation, vaccination (influenza, pneumococcal, COVID), pulmonary rehabilitation. By group — A: a bronchodilator. B: LABA+LAMA. E (≥2 moderate or ≥1 hospitalised exacerbation/year): LABA+LAMA, add ICS if eosinophils ≥300 cells/µL or asthma-COPD overlap. Exacerbation: increased short-acting bronchodilator, oral prednisolone ~40mg OD for 5 days, antibiotics if increased sputum purulence plus volume/dyspnoea, controlled oxygen (target SpO2 88-92%).',
      'FEV1<30% predicted, cor pulmonale, frequent hospitalisations, need for long-term oxygen assessment, suspected lung cancer.',
      'GOLD 2024/2025'
    );
  end if;

  ---------------------------------------------------------------------------
  -- Skin and soft tissue infections
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions
    where condition ilike '%cellulitis%' or condition ilike '%skin and soft tissue%' or condition ilike '%soft tissue infection%'
    order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — IDSA 2014 + 2023 update, CDC MRSA guidance]\nNon-purulent cellulitis/erysipelas (no abscess/drainage): treat empirically for beta-haemolytic streptococci ± staph — oral flucloxacillin or cephalexin; clindamycin if penicillin-allergic. Add empirical MRSA coverage if no response to a beta-lactam or systemic toxicity. Duration 5-6 days, extend if not improving. Purulent cellulitis/abscess/furuncle: incision and drainage is the primary treatment. Add antibiotics with empirical MRSA coverage (clindamycin, doxycycline, or trimethoprim-sulfamethoxazole — avoid fluoroquinolones/macrolides for MRSA, resistance is common) if systemic symptoms, immunocompromised, or extensive/multiple lesions; duration ~5 days if improving. Impetigo: topical mupirocin/fusidic acid for limited disease; oral flucloxacillin/cephalexin if extensive/bullous. IV therapy (e.g. IV flucloxacillin or ceftriaxone) for systemic toxicity or oral treatment failure.',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] Signs of necrotising fasciitis (pain out of proportion, crepitus, rapid spread, systemic toxicity) are a surgical emergency; also refer immunocompromised patients with rapidly progressive infection and any failure of appropriate oral therapy.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: IDSA SSTI 2014 (+2023 update); CDC MRSA guidance'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Skin and soft tissue infections (cellulitis, erysipelas, abscess, impetigo)',
      'Skin and soft tissue',
      'Localized erythema, warmth, swelling and pain; fever if systemic; purulent drainage or fluctuance if abscess; honey-crusted lesions in impetigo.',
      'Rapidly spreading pain out of proportion to exam findings, crepitus, bullae, or systemic toxicity are red flags for necrotising infection.',
      'Usually a clinical diagnosis; wound culture if recurrent, purulent, or treatment fails; blood culture if systemic toxicity; imaging if necrotising infection is suspected.',
      '[2026 — IDSA 2014 + 2023 update, CDC MRSA guidance] Non-purulent cellulitis/erysipelas: oral flucloxacillin or cephalexin (clindamycin if penicillin-allergic); add MRSA coverage if no response or systemic toxicity; 5-6 days. Purulent cellulitis/abscess: incision and drainage is primary treatment; add clindamycin, doxycycline or trimethoprim-sulfamethoxazole for MRSA coverage if systemic/immunocompromised/extensive; ~5 days. Impetigo: topical mupirocin/fusidic acid, or oral flucloxacillin/cephalexin if extensive. IV flucloxacillin/ceftriaxone for systemic toxicity or oral failure.',
      'Necrotising fasciitis signs (pain out of proportion, crepitus, rapid spread, systemic toxicity) — surgical emergency; immunocompromised with rapid progression; failure of appropriate oral therapy.',
      'IDSA SSTI 2014 (+2023 update); CDC MRSA guidance'
    );
  end if;

  ---------------------------------------------------------------------------
  -- Depression
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions where condition ilike '%depress%' order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — NICE NG222, WHO mhGAP]\nMild depression: active monitoring, guided self-help, behavioural activation, structured exercise, sleep hygiene — low-intensity psychosocial intervention preferred over medication. Moderate-severe depression: an SSRI (e.g. sertraline 50mg OD titrating to max 200mg, or fluoxetine 20mg OD) combined with high-intensity psychological therapy (CBT or interpersonal therapy) where available. Continue the antidepressant at least 6 months after remission (longer for recurrent depression) to reduce relapse. Screen for bipolar disorder before starting an antidepressant. Assess suicide risk at every contact.',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] Active suicidal intent/plan, psychotic features, treatment resistance after two adequate trials, suspected bipolar disorder, severe functional impairment.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: NICE NG222; WHO mhGAP'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Depression (major depressive disorder)',
      'Mental health',
      'Persistent low mood, anhedonia, sleep disturbance, appetite/weight change, fatigue, poor concentration, feelings of worthlessness/guilt, suicidal ideation.',
      'Psychomotor slowing or agitation, flat affect, poor eye contact, self-neglect in severe cases.',
      'PHQ-9 (or a locally validated tool) to grade severity; exclude organic causes (TSH, FBC, B12/folate if indicated); screen for substance use and bipolar features before starting an antidepressant.',
      '[2026 — NICE NG222, WHO mhGAP] Mild: active monitoring, guided self-help, behavioural activation, structured exercise, sleep hygiene. Moderate-severe: an SSRI (sertraline 50mg OD titrating to max 200mg, or fluoxetine 20mg OD) combined with high-intensity psychological therapy (CBT/IPT) where available. Continue at least 6 months after remission (longer if recurrent). Screen for bipolar disorder before starting an antidepressant. Assess suicide risk at every contact.',
      'Active suicidal intent/plan, psychotic features, treatment resistance after two adequate trials, suspected bipolar disorder, severe functional impairment.',
      'NICE NG222; WHO mhGAP'
    );
  end if;

  ---------------------------------------------------------------------------
  -- Chronic stress / stress-related presentations
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions
    where condition ilike '%stress%' order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — WHO stress management guidance, WHO mhGAP]\nFirst-line is non-pharmacological: psychoeducation about stress, structured problem-solving, relaxation/breathing techniques, WHO self-help approaches (e.g. "Doing What Matters in Times of Stress"), regular physical activity, sleep hygiene, and addressing the source of stress where possible. Consider brief structured psychological interventions (e.g. Problem Management Plus) delivered by trained non-specialists where available. Medication is not first-line for stress alone; reserve for short-term severe insomnia (short course non-benzodiazepine hypnotic) or once a secondary diagnosis (depression, an anxiety disorder) is confirmed — then treat that condition on its own merits. Avoid long-term benzodiazepines.',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] Evidence of depression/anxiety/PTSD needing dedicated treatment, suicidal ideation, or symptoms significantly impairing function despite self-help measures.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: WHO stress management guidance; WHO mhGAP'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Chronic stress / stress-related presentations',
      'Mental health',
      'Persistent tension, irritability, sleep disturbance, fatigue, difficulty concentrating, somatic complaints (headache, GI upset, muscle tension), feeling overwhelmed.',
      'Often no specific physical signs; watch for signs of an evolving depressive or anxiety disorder.',
      'Clinical assessment of stressors and coping; screen for depression/anxiety/PTSD (PHQ-9, GAD-7) as these frequently co-occur; rule out organic causes of fatigue (thyroid, anaemia) if indicated.',
      '[2026 — WHO stress management guidance, WHO mhGAP] First-line non-pharmacological: psychoeducation, structured problem-solving, relaxation/breathing techniques, WHO self-help resources, physical activity, sleep hygiene, addressing the stressor where possible. Consider brief structured psychological interventions (e.g. Problem Management Plus) by trained non-specialists. Medication is not first-line for stress alone; reserve for short-term severe insomnia or a confirmed secondary diagnosis. Avoid long-term benzodiazepines.',
      'Evidence of depression/anxiety/PTSD needing dedicated treatment, suicidal ideation, or symptoms significantly impairing function despite self-help measures.',
      'WHO stress management guidance; WHO mhGAP'
    );
  end if;

  ---------------------------------------------------------------------------
  -- Hypertension (chronic/essential — routine outpatient management)
  ---------------------------------------------------------------------------
  select id into existing_id from public.conditions
    where (condition ilike '%hypertension%') and condition not ilike '%emergency%' and condition not ilike '%urgency%'
    order by id limit 1;

  if existing_id is not null then
    update public.conditions set
      treatment = coalesce(treatment, '') || E'\n\n[Supplemented 2026 — Hypertension Canada 2025, WHO HEARTS]\nTarget BP <130/80 mmHg for most adults if well tolerated (individualise for frail/elderly patients). Lifestyle for all: sodium restriction, weight loss, physical activity, reduced alcohol, a DASH-style diet. First-line pharmacotherapy (similar efficacy — choose by compatibility/cost/comorbidity): an ACE inhibitor or ARB, a long-acting dihydropyridine calcium channel blocker (e.g. amlodipine), or a thiazide-like diuretic (e.g. indapamide, preferred over a classic thiazide). Prefer initial combination therapy (two agents, ideally a single-pill combination) over monotherapy when BP is well above target. Compelling indications: ACEi/ARB with diabetes plus proteinuria or heart failure; a beta-blocker with concurrent ischaemic heart disease/arrhythmia. Never combine an ACE inhibitor with an ARB. Monitor renal function and electrolytes after starting an ACE inhibitor/ARB or a diuretic.',
      referral_criteria = coalesce(referral_criteria, '') || E'\n\n[2026 update] Resistant hypertension (uncontrolled on 3 agents including a diuretic), suspected secondary hypertension (young age, resistant, hypokalaemia), hypertension in pregnancy, or any hypertensive emergency feature.',
      source_pages = coalesce(source_pages || ' | ', '') || 'Supplemented 2026: Hypertension Canada 2025; WHO HEARTS'
    where id = existing_id;
  else
    insert into public.conditions (condition, chapter, symptoms, signs, investigations, treatment, referral_criteria, source_pages)
    values (
      'Hypertension (chronic/essential)',
      'Cardiovascular',
      'Usually asymptomatic; may present with headache, dizziness or be found incidentally on routine screening.',
      'Elevated BP on repeated measurement; look for end-organ signs (retinopathy, left ventricular hypertrophy, proteinuria) in longstanding disease.',
      'BP measured on at least two occasions; screen for secondary causes if young, resistant, or hypokalaemic; assess for end-organ damage (urinalysis, creatinine, ECG) and overall cardiovascular risk.',
      '[2026 — Hypertension Canada 2025, WHO HEARTS] Target BP <130/80 mmHg if well tolerated. Lifestyle: sodium restriction, weight loss, activity, reduced alcohol, DASH-style diet. First-line: ACE inhibitor or ARB, a long-acting dihydropyridine CCB (amlodipine), or a thiazide-like diuretic (indapamide). Prefer initial combination therapy when BP is well above target. Compelling indications: ACEi/ARB with diabetes+proteinuria or heart failure; beta-blocker with ischaemic heart disease/arrhythmia. Never combine ACEi+ARB. Monitor renal function/electrolytes after starting an ACEi/ARB or diuretic.',
      'Resistant hypertension (uncontrolled on 3 agents including a diuretic), suspected secondary hypertension, hypertension in pregnancy, any hypertensive emergency feature.',
      'Hypertension Canada 2025; WHO HEARTS'
    );
  end if;
end $$;

---------------------------------------------------------------------------
-- Common cardiovascular medications (reference entries)
--
-- level_of_care is left as 'Reference' rather than a Ghana B2/C/D code for
-- any newly-inserted row below: this migration cannot verify current Ghana
-- EML stocking/facility-level placement without live access to that table,
-- so it does not guess one. If a matching drug already exists, only its
-- contraindications/cautions are supplemented — its existing, presumably
-- EML-verified level_of_care/strength/formulation are left untouched.
---------------------------------------------------------------------------

do $$
declare
  existing_id bigint;
  cv_note text := E'\n\n[Supplemented 2026 reference] See current guideline (Hypertension Canada 2025 / WHO HEARTS / ADA 2025-2026) for indication-specific dosing and monitoring.';
begin
  -- Lisinopril (ACE inhibitor)
  select id into existing_id from public.medications where drug ilike '%lisinopril%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Lisinopril', 'Tablet', '5mg, 10mg, 20mg', 'Reference', 'ACE inhibitor / antihypertensive',
      'Pregnancy, bilateral renal artery stenosis, history of ACE-inhibitor angioedema.',
      'Monitor renal function and potassium after initiation/dose change; do not combine with an ARB.' || cv_note);
  end if;

  -- Losartan (ARB)
  select id into existing_id from public.medications where drug ilike '%losartan%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Losartan', 'Tablet', '25mg, 50mg, 100mg', 'Reference', 'Angiotensin receptor blocker / antihypertensive',
      'Pregnancy, bilateral renal artery stenosis.',
      'Monitor renal function and potassium; do not combine with an ACE inhibitor.' || cv_note);
  end if;

  -- Amlodipine (CCB)
  select id into existing_id from public.medications where drug ilike '%amlodipine%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Amlodipine', 'Tablet', '5mg, 10mg', 'Reference', 'Dihydropyridine calcium channel blocker / antihypertensive',
      'Cardiogenic shock, severe aortic stenosis.',
      'Peripheral oedema and gingival hyperplasia are common; caution in significant heart failure.' || cv_note);
  end if;

  -- Indapamide (thiazide-like diuretic)
  select id into existing_id from public.medications where drug ilike '%indapamide%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Indapamide', 'Tablet', '1.5mg (SR), 2.5mg', 'Reference', 'Thiazide-like diuretic / antihypertensive',
      'Severe renal impairment, uncorrected hypokalaemia, severe hepatic impairment.',
      'Monitor sodium/potassium, especially in the elderly and with other diuretics.' || cv_note);
  end if;

  -- Bisoprolol (beta-blocker)
  select id into existing_id from public.medications where drug ilike '%bisoprolol%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Bisoprolol', 'Tablet', '2.5mg, 5mg, 10mg', 'Reference', 'Beta-blocker / antihypertensive, anti-anginal',
      'Severe bradycardia, uncontrolled heart failure, severe asthma/reactive airway disease.',
      'Do not stop abruptly (rebound tachycardia/angina); caution in diabetes (masks hypoglycaemia symptoms).' || cv_note);
  end if;

  -- Atorvastatin (statin)
  select id into existing_id from public.medications where drug ilike '%atorvastatin%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Atorvastatin', 'Tablet', '10mg, 20mg, 40mg, 80mg', 'Reference', 'Statin / lipid-lowering',
      'Active liver disease, pregnancy/breastfeeding.',
      'Monitor liver enzymes; caution with drug interactions (e.g. certain macrolides); report unexplained muscle pain.' || cv_note);
  end if;

  -- Aspirin (antiplatelet, low-dose)
  select id into existing_id from public.medications where drug ilike '%aspirin%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Aspirin (low-dose)', 'Tablet', '75mg', 'Reference', 'Antiplatelet',
      'Active peptic ulcer/GI bleeding, known aspirin/NSAID hypersensitivity, children under 16 (Reye syndrome risk).',
      'Bleeding risk, especially combined with anticoagulants; not routinely recommended for primary prevention without established cardiovascular disease.' || cv_note);
  end if;

  -- Apixaban (DOAC anticoagulant)
  select id into existing_id from public.medications where drug ilike '%apixaban%' order by id limit 1;
  if existing_id is not null then
    update public.medications set cautions = coalesce(cautions, '') || cv_note where id = existing_id;
  else
    insert into public.medications (drug, formulation, strength, level_of_care, category, contraindications, cautions)
    values ('Apixaban', 'Tablet', '2.5mg, 5mg', 'Reference', 'Direct oral anticoagulant',
      'Active pathological bleeding, mechanical heart valves, severe renal impairment (dose-dependent).',
      'Dose-adjust for age/weight/renal function; no routine monitoring but review renal function periodically.' || cv_note);
  end if;
end $$;
