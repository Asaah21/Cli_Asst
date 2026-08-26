"use client";
import {useState} from "react";

type Result={summary:string;urgency:string;red_flags:string[];questions:string[];possible_diagnoses:{condition:string;likelihood:string;why:string}[];tests:{test:string;reason:string;priority:string}[];plans:{condition:string;b2:string[];c:string[];alternatives:string[];contraindications:string[];notes:string[]}[];disposition:string;source_notes:string[]};
const initial={facilityLevel:"C",preferredLevel:"B2",pregnancy:"Unknown"};
export default function AssessmentForm(){
 const [form,setForm]=useState<any>(initial),[r,setR]=useState<Result|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const set=(k:string,v:any)=>setForm((x:any)=>({...x,[k]:v}));
 async function assess(){setLoading(true);setError("");try{const res=await fetch("/api/assess",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const j=await res.json();if(!res.ok)throw new Error(j.error||"Assessment failed");setR(j.result)}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 return <>
 <section className="card"><h2>New consultation</h2><p className="small">Enter what you know. The AI considers the whole encounter and identifies useful questions/tests before grounding treatment in the STG + EML.</p>
 <div className="grid">
 {[['age','Age'],['weight','Weight kg'],['temp','Temp °C'],['bp','BP'],['pulse','Pulse/min'],['rr','RR/min'],['spo2','SpO₂ %'],['rbs','RBS'],['hb','Hb']].map(([k,l])=><label className="field" key={k}>{l}<input value={form[k]??""} onChange={e=>set(k,e.target.value)}/></label>)}
 <label className="field">Sex<select value={form.sex||""} onChange={e=>set("sex",e.target.value)}><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option></select></label>
 <label className="field">Pregnancy<select value={form.pregnancy} onChange={e=>set("pregnancy",e.target.value)}><option>Unknown</option><option>Yes</option><option>No</option></select></label>
 <label className="field wide">Allergies<input value={form.allergies||""} onChange={e=>set("allergies",e.target.value)} placeholder="Drug/food allergies or none known"/></label>
 <label className="field wide">Main complaints, symptoms, signs & duration<textarea value={form.complaints||""} onChange={e=>set("complaints",e.target.value)} placeholder="Describe naturally, e.g. 'waist pain for 3 days'"/></label>
 <label className="field wide">Extra history / examination findings<textarea value={form.extra||""} onChange={e=>set("extra",e.target.value)} placeholder="Trauma, urinary symptoms, fever, discharge, menstrual history, neurological findings, medications, past history, etc."/></label>
 <label className="field wide">Tests already done + results<textarea value={form.tests||""} onChange={e=>set("tests",e.target.value)} placeholder="RDT, pregnancy, HIV, Hb, RBS, typhoid, syphilis, etc."/></label>
 </div>{error&&<div className="dangerBox">{error}</div>}<button className="primary" onClick={assess} disabled={loading}>{loading?"Assessing clinical context...":"Assess patient"}</button></section>
 {r&&<section className="card results">
 <div className="resultTop"><div><h2>Clinical assessment</h2><p>{r.summary}</p></div><span className="urgency">{r.urgency}</span></div>
 {r.red_flags.length>0&&<div className="result danger"><h3>🚨 Red flags / urgent issues</h3><ul>{r.red_flags.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
 <div className="result"><h3>Possible diagnoses</h3>{r.possible_diagnoses.map((x,i)=><div className="diagnosis" key={i}><div><b>{i+1}. {x.condition}</b><span className="level">{x.likelihood}</span></div><p>{x.why}</p></div>)}</div>
 {r.questions.length>0&&<div className="result"><h3>Questions to ask next</h3><p className="small">These are selected because the answers could change the differential or urgency.</p><ol>{r.questions.map((x,i)=><li key={i}>{x}</li>)}</ol></div>}
 {r.tests.length>0&&<div className="result"><h3>Targeted tests</h3><div className="testGrid">{r.tests.map((x,i)=><div className="test" key={i}><b>{x.test}</b><span className="level">{x.priority}</span><p>{x.reason}</p></div>)}</div></div>}
 {r.plans.length>0&&<div className="result"><h3>Treatment plan</h3><p className="small">B2 is displayed first because it is your preferred level. C-level options remain visible where supported by the source records.</p>{r.plans.map((x,i)=><div className="plan" key={i}><h4>{x.condition}</h4><div className="cols"><div><h5>B2 options</h5>{x.b2.length?<ul>{x.b2.map((z,j)=><li key={j}>{z}</li>)}</ul>:<p className="small">No supported B2 option found in retrieved EML records.</p>}</div><div><h5>C-level options</h5>{x.c.length?<ul>{x.c.map((z,j)=><li key={j}>{z}</li>)}</ul>:<p className="small">No supported C option found in retrieved EML records.</p>}</div></div>{x.alternatives.length>0&&<><h5>Alternatives</h5><ul>{x.alternatives.map((z,j)=><li key={j}>{z}</li>)}</ul></>}{x.contraindications.length>0&&<><h5>Contraindications / cautions</h5><ul>{x.contraindications.map((z,j)=><li key={j}>{z}</li>)}</ul></>}{x.notes.length>0&&<p className="small">{x.notes.join(" ")}</p>}</div>)}</div>}
 <div className="result"><h3>Immediate management & disposition</h3><p>{r.disposition}</p></div>
 <div className="source"><b>Evidence / source notes</b><ul>{r.source_notes.map((x,i)=><li key={i}>{x}</li>)}</ul></div>
 </section>}
 </>;
}
