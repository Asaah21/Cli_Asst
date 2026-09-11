# Guideline sources — 2026 update

Citation index for the condition/medication content added or supplemented in
`supabase/003_guideline_updates.sql`. This documents where each piece of
clinical content came from, for audit and future re-checking.

## Why links, not mirrored PDFs

GINA, GOLD, ADA (Diabetes Care), IDSA (Clinical Infectious Diseases /
Oxford Academic), NICE, and Hypertension Canada / Diabetes Canada all hold
copyright over their published guideline documents and restrict
reproduction/redistribution. Rather than copy full copyrighted PDFs into
this repository's git history (which would also make the repo
significantly heavier), this project links to the official source for each
— the actual clinical content extracted from them (drug names, doses,
thresholds) is transformative factual summary, not a copy of the document
itself. If your facility needs offline copies for audit purposes, download
directly from the links below rather than redistributing further.

## Ghana

- **Standard Treatment Guidelines, 7th edition (2017)** — Ghana Ministry of Health / Ghana Health Service.
  https://www.moh.gov.gh/wp-content/uploads/2020/07/GHANA-STG-2017-1.pdf
- **Essential Medicines List, 7th edition (2017)** — companion document to the STG above.
  https://moh.gov.gh/wp-content/uploads/2020/07/GHANA-EML-2017.pdf
- **No newer official edition was found as of this update (September 2026).** The 7th edition (2017) remains Ghana's current official STG/EML. This project's existing STG/EML database content is left as-is; nothing here supersedes it.

## WHO

- **WHO Package of Essential Noncommunicable Disease Interventions (WHO PEN), incl. HEARTS (hypertension) and HEARTS-D (diabetes)** — primary-care protocols this update's hypertension/diabetes content draws on.
  https://www.who.int/publications
  (search "WHO PEN" / "HEARTS" via who.int — protocol content varies by module/printing)
- **WHO mhGAP Intervention Guide v2.0** — depression and stress-related presentations in non-specialist primary care.
  https://www.ncbi.nlm.nih.gov/books/NBK598420/
- **WHO Guidelines for the Management of Conditions Specifically Related to Stress**
  https://www.ncbi.nlm.nih.gov/books/NBK159711/

## USA

- **ADA Standards of Care in Diabetes — 2025/2026** — American Diabetes Association, published in *Diabetes Care*.
  https://diabetesjournals.org/care/article/49/Supplement_1/S183/163934/9-Pharmacologic-Approaches-to-Glycemic-Treatment
- **IDSA Practice Guidelines for the Diagnosis and Management of Skin and Soft Tissue Infections (2014, updated 2023)** — Infectious Diseases Society of America.
  https://academic.oup.com/cid/article/59/2/e10/2895845
- **CDC — Outpatient management of skin and soft tissue infections / MRSA guidance**
  https://www.cdc.gov/mrsa/media/pdfs/FlowChart-P.pdf
  https://www.cdc.gov/mrsa/media/pdfs/Provider-Brochure-P.pdf

## International (asthma/COPD, used across jurisdictions)

- **GINA (Global Initiative for Asthma) — 2024/2025 Global Strategy for Asthma Management and Prevention**
  https://ginasthma.org/wp-content/uploads/2025/11/GINA-Summary-Guide-2025-WEB_FINAL-WMS.pdf
- **GOLD (Global Initiative for Chronic Obstructive Lung Disease) — 2024/2025 Pocket Guide**
  https://goldcopd.org/wp-content/uploads/2024/02/POCKET-GUIDE-GOLD-2024-ver-1.2-11Jan2024_WMV.pdf

## UK

- **NICE NG222 — Depression in adults: treatment and management** (National Institute for Health and Care Excellence; last reviewed January 2026)
  https://www.nice.org.uk/guidance/ng222

## Canada

- **Hypertension Canada — 2025 Guideline for the Diagnosis and Treatment of Hypertension in Adults in Primary Care**
  https://hypertension.ca/wp-content/uploads/2025/05/Hypertension-guideline.pdf
- **Diabetes Canada** — referenced for cross-checking hypertension-in-diabetes targets alongside Hypertension Canada 2025.
  https://www.canadianjournalofdiabetes.com/

---

_Compiled September 2026. Content extracted from these sources into `conditions`/`medications` rows is clearly labeled "[Supplemented 2026]" in the `treatment`/`investigations`/`referral_criteria` fields it was added to, and the row's `source_pages` field names which of the above it reflects._
