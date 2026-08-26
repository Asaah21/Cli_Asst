import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";

const reasoningSchema = {
  type: "object", additionalProperties: false,
  required: ["clinical_summary","urgency","red_flags","missing_information","possible_diagnoses","questions","tests","immediate_actions"],
  properties: {
    clinical_summary:{type:"string"}, urgency:{type:"string"},
    red_flags:{type:"array",items:{type:"string"}}, missing_information:{type:"array",items:{type:"string"}},
    possible_diagnoses:{type:"array",items:{type:"object",additionalProperties:false,required:["condition","likelihood","supporting_findings","findings_against"],properties:{condition:{type:"string"},likelihood:{type:"string"},supporting_findings:{type:"array",items:{type:"string"}},findings_against:{type:"array",items:{type:"string"}}}}},
    questions:{type:"array",items:{type:"string"}},
    tests:{type:"array",items:{type:"object",additionalProperties:false,required:["test","reason","priority"],properties:{test:{type:"string"},reason:{type:"string"},priority:{type:"string"}}}},
    immediate_actions:{type:"array",items:{type:"string"}}
  }
};

const planSchema = {
  type:"object",additionalProperties:false,
  required:["summary","urgency","red_flags","questions","possible_diagnoses","tests","plans","disposition","source_notes"],
  properties:{
    summary:{type:"string"},urgency:{type:"string"},red_flags:{type:"array",items:{type:"string"}},questions:{type:"array",items:{type:"string"}},
    possible_diagnoses:{type:"array",items:{type:"object",additionalProperties:false,required:["condition","likelihood","why"],properties:{condition:{type:"string"},likelihood:{type:"string"},why:{type:"string"}}}},
    tests:{type:"array",items:{type:"object",additionalProperties:false,required:["test","reason","priority"],properties:{test:{type:"string"},reason:{type:"string"},priority:{type:"string"}}}},
    plans:{type:"array",items:{type:"object",additionalProperties:false,required:["condition","b2","c","alternatives","contraindications","notes"],properties:{condition:{type:"string"},b2:{type:"array",items:{type:"string"}},c:{type:"array",items:{type:"string"}},alternatives:{type:"array",items:{type:"string"}},contraindications:{type:"array",items:{type:"string"}},notes:{type:"array",items:{type:"string"}}}},
    disposition:{type:"string"},source_notes:{type:"array",items:{type:"string"}}
  }
};

const clean = (s:string) => String(s||"").replace(/\s+/g," ").trim();
const terms = (s:string) => [...new Set(clean(s).toLowerCase().replace(/[^a-z0-9\s-]/g," ").split(/\s+/).filter(x=>x.length>=4))].slice(0,30);

async function geminiJson(model:string, apiKey:string, schema:any, prompt:string){
  const ai = new GoogleGenAI({apiKey});
  const response = await ai.models.generateContent({model,contents:prompt,config:{responseMimeType:"application/json",responseSchema:schema,temperature:0.1}});
  if(!response.text) throw new Error("Gemini returned an empty response.");
  return JSON.parse(response.text);
}

export async function POST(req:Request){
  try{
    const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user) return NextResponse.json({error:"Not authenticated"},{status:401});
    const patient=await req.json();
    const apiKey=process.env.GEMINI_API_KEY;
    if(!apiKey) return NextResponse.json({error:"GEMINI_API_KEY is missing. Add it to .env.local and restart the dev server."},{status:500});
    const model=process.env.GEMINI_MODEL||"gemini-2.5-flash-lite";

    const stage1=await geminiJson(model,apiKey,reasoningSchema,`You are a cautious clinical decision-support assistant for a Ghanaian health facility. Interpret the WHOLE encounter, not just the chief complaint. Use age, sex, pregnancy status, weight, vitals, allergies, symptoms, signs, duration, history and existing test results together. The complaint may be vague (for example, "waist pain"). Generate a ranked differential, identify missing information, ask targeted questions that would change the differential, and recommend only simple/high-yield tests available in a basic Ghanaian clinic when appropriate.

Do NOT prescribe in this stage. Do NOT claim a diagnosis is confirmed. Flag emergencies and dangerous possibilities. Consider pregnancy where relevant. Be concise and practical.

PATIENT ENCOUNTER:\n${JSON.stringify(patient,null,2)}`);

    const names=(stage1.possible_diagnoses||[]).map((x:any)=>x.condition).filter(Boolean).slice(0,8);
    const searchTerms=[...new Set([...names.flatMap(terms),...terms([patient.complaints,patient.extra,patient.tests].join(" "))])].slice(0,45);
    let cq=supabase.from("conditions").select("id,condition,chapter_number,chapter,printed_page,source_pages,symptoms,signs,investigations,treatment,referral_criteria,section_text").limit(80);
    if(searchTerms.length){
      const or=searchTerms.map(w=>`condition.ilike.%${w}%,symptoms.ilike.%${w}%,signs.ilike.%${w}%,treatment.ilike.%${w}%`).join(",");
      cq=cq.or(or);
    }
    const {data:conditions,error:ce}=await cq;
    if(ce) return NextResponse.json({error:ce.message},{status:500});

    const conditionText=(conditions||[]).map((c:any)=>`${c.condition}\nSymptoms: ${c.symptoms}\nSigns: ${c.signs}\nInvestigations: ${c.investigations}\nTreatment: ${c.treatment}\nReferral: ${c.referral_criteria}\nSource: ${c.source_pages}`).join("\n---\n");
    const medTerms=terms((conditions||[]).map((c:any)=>`${c.treatment} ${c.condition}`).join(" ")).filter(x=>!['with','from','treat','treatment','given','daily','dose','oral','intravenous','patient','children','adult'].includes(x));
    let mq=supabase.from("medications").select("drug,formulation,strength,level_of_care,contraindications,cautions,eml_page,category").in("level_of_care",["B2","C"]).limit(250);
    if(medTerms.length) mq=mq.or(medTerms.map(w=>`drug.ilike.%${w}%,formulation.ilike.%${w}%`).join(","));
    const {data:medications,error:me}=await mq;
    if(me) return NextResponse.json({error:me.message},{status:500});

    const stage2=await geminiJson(model,apiKey,planSchema,`You are the second-stage clinical evidence-grounding assistant for a Ghanaian health facility.

IMPORTANT SAFETY RULES:
1. The supplied STG records are the primary source for treatment, investigations and referral statements. The supplied EML records are the source for medicine level-of-care classification.
2. Never invent a drug, dose, route, frequency, duration, indication, contraindication or referral criterion. If the supplied source does not support a detail, say "Verify in the current official Ghana STG/EML".
3. Use ALL patient information and the first-stage reasoning. A vague complaint must be interpreted in context of vitals, sex, pregnancy, age, weight and other findings.
4. Give multiple plausible diagnoses when appropriate, ranked by likelihood. Do not call anything confirmed unless the data support it.
5. Questions and tests should be targeted to distinguish the leading possibilities. Do not list every available test.
6. Treatment MUST show both B2 and C options when the supplied sources support them. B2 is preferred for this facility, but C-level options must remain visible. A C-level medicine is not automatically a referral.
7. Facility observation is normally up to 24 hours, but this is an operational constraint, not a clinical rule. Do not let it override medically necessary admission/referral.
8. Flag red flags, pregnancy concerns, abnormal vitals, severe disease and reasons for urgent escalation.
9. The supplied STG is older material; where current official Ghana guidance may supersede it, explicitly tell the clinician to verify the current guidance.

FIRST-STAGE REASONING:\n${JSON.stringify(stage1,null,2)}\n\nPATIENT:\n${JSON.stringify(patient,null,2)}\n\nRELEVANT STG RECORDS:\n${conditionText}\n\nRELEVANT EML RECORDS (B2/C):\n${JSON.stringify(medications||[],null,2)}\n\nReturn the structured result. Keep medication entries source-grounded and readable.`);

    const sourceIds=(conditions||[]).map((c:any)=>c.id);
    const {data:consultation,error:saveError}=await supabase.from("consultations").insert({clinician_id:user.id,patient_input:patient,assessment:stage2,source_condition_ids:sourceIds}).select("id").single();
    if(saveError) console.error("Consultation save failed",saveError);
    return NextResponse.json({result:stage2,reasoning:stage1,consultationId:consultation?.id||null});
  }catch(error){
    console.error(error);
    return NextResponse.json({error:error instanceof Error?error.message:"Assessment failed"},{status:500});
  }
}
