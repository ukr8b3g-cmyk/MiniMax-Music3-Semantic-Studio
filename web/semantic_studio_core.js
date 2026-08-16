export const SECTION_TYPES = ["Intro","Verse","Pre-Chorus","Chorus","Post-Chorus","Bridge","Instrumental","Solo","Outro"];
export const METERS = ["4/4","3/4","6/8","12/8","5/4","7/8"];
export const SCALES = ["","major","minor","harmonic minor","melodic minor","dorian","mixolydian","pentatonic"];
export const KEYS = ["","C","C# / Db","D","D# / Eb","E","F","F# / Gb","G","G# / Ab","A","A# / Bb","B"];

export const clone = (value) => JSON.parse(JSON.stringify(value));
export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
export const uid = (prefix = "section") => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const snapSemanticDuration = (value) => Math.round(clamp(value, 0.5, 360) * 10) / 10;

export function splitKeyScale(value, scaleValue = "") {
  const keyText = String(value ?? "").trim();
  const existingScale = String(scaleValue ?? "").trim();
  if (!keyText) return { key: keyText, scale: existingScale };

  // Accept common pitch spellings while preserving the user's exact wording:
  // D flat major -> D flat + major, F# minor -> F# + minor,
  // C# / Db major -> C# / Db + major. If a separate scale already exists,
  // clean the compound key but keep that explicit scale unchanged.
  const pitch = "[A-Ga-g](?:[#♯b♭]|(?:\\s+(?:sharp|flat)))?";
  const match = keyText.match(new RegExp(`^(${pitch}(?:\\s*\\/\\s*${pitch})?)(?:\\s+(.+))?$`, "i"));
  if (!match || !match[2]) return { key: keyText, scale: existingScale };
  return { key: match[1].trim(), scale: existingScale || match[2].trim() };
}

export function makeSection(type="Verse", label="Verse", duration=16, energyPercent=50, instruments=[], vocal="", directives="") {
  return {id:uid(type.toLowerCase().replace(/[^a-z0-9]+/g,"-")||"section"),type,label,duration:snapSemanticDuration(duration),energy:energyPercent/100,lyrics:"",instruments,vocal,directives};
}

export function factoryProject() {
  return {
    schema_version:1,project_id:"",
    global:{title:"",genre:"Pop",subgenres:[],bpm:120,key:"",scale:"",meter:"4/4",mood:"",production:"",vocal:{mode:"vocal",gender:"",timbre:"",delivery:"",harmony:"",effects:""}},
    timeline:{sections:[
      makeSection("Intro","Intro",8,20,["piano","pad"],"instrumental","Sparse opening; establish the main tone without a full groove."),
      makeSection("Verse","Verse 1",24,38,["piano","bass","light drums"],"soft","Keep the arrangement restrained and leave space for the lead vocal."),
      makeSection("Chorus","Chorus 1",24,82,["full drums","bass","guitar","piano","pad"],"power","Open into a wider, fuller arrangement with a clear melodic lift."),
      makeSection("Verse","Verse 2",24,48,["piano","bass","drums","guitar"],"soft","Retain momentum from the chorus while returning to a lighter texture."),
      makeSection("Chorus","Chorus 2",24,88,["full drums","bass","guitar","piano","pad"],"power","Repeat the chorus identity with slightly more density and backing support."),
      makeSection("Bridge","Bridge",16,45,["piano","strings","pad"],"intimate","Pull back the groove and create contrast before the final lift."),
      makeSection("Chorus","Final Chorus",28,100,["full drums","bass","guitar","piano","strings","pad"],"power","Peak arrangement density and emotional intensity; broaden the stereo image."),
      makeSection("Outro","Outro",12,30,["piano","pad"],"fade","Release the energy and finish with a clean, natural decay."),
    ]},audio_edits:[],takes:[],conditioning_tracks:[],
  };
}

export function normalizeProject(raw) {
  const fallback=factoryProject(), p=raw&&typeof raw==="object"?clone(raw):fallback;
  p.schema_version=1;p.project_id=typeof p.project_id==="string"?p.project_id:"";
  p.global=p.global&&typeof p.global==="object"?p.global:clone(fallback.global);p.global.vocal=p.global.vocal&&typeof p.global.vocal==="object"?p.global.vocal:clone(fallback.global.vocal);p.global.subgenres=Array.isArray(p.global.subgenres)?p.global.subgenres:[];
  p.global.key=String(p.global.key||"");p.global.scale=String(p.global.scale||"");
  const keyScale=splitKeyScale(p.global.key,p.global.scale);p.global.key=keyScale.key;p.global.scale=keyScale.scale;
  p.timeline=p.timeline&&typeof p.timeline==="object"?p.timeline:{sections:[]};p.timeline.sections=Array.isArray(p.timeline.sections)&&p.timeline.sections.length?p.timeline.sections:clone(fallback.timeline.sections);
  p.timeline.sections=p.timeline.sections.slice(0,32).map((s,i)=>({...(s||{}),id:s?.id||uid("section"),type:SECTION_TYPES.includes(s?.type)?s.type:"Verse",label:String(s?.label||s?.type||`Section ${i+1}`),duration:snapSemanticDuration(s?.duration??16),energy:clamp(s?.energy??.5,0,1),lyrics:String(s?.lyrics||""),instruments:Array.isArray(s?.instruments)?s.instruments.filter(Boolean):[],vocal:String(s?.vocal||""),directives:String(s?.directives||"")}));
  p.audio_edits=Array.isArray(p.audio_edits)?p.audio_edits:[];p.takes=Array.isArray(p.takes)?p.takes:[];p.conditioning_tracks=Array.isArray(p.conditioning_tracks)?p.conditioning_tracks:[];return p;
}

export function parseList(value) { return String(value||"").split(/[,\n]+/).map(x=>x.trim()).filter(Boolean).filter((x,i,a)=>a.findIndex(y=>y.toLowerCase()===x.toLowerCase())===i); }
export function totalDuration(project) { return Math.round((project?.timeline?.sections||[]).reduce((sum,s)=>sum+(Number(s.duration)||0),0)*10)/10; }
export function formatTime(seconds) { const whole=Math.max(0,Math.round(seconds)),m=Math.floor(whole/60),s=whole%60;return `${m}:${String(s).padStart(2,"0")}`; }
export function energyPhrase(value) { const e=clamp(value,0,1);if(e<.18)return"very sparse and restrained";if(e<.38)return"low-density and restrained";if(e<.62)return"moderate and controlled";if(e<.82)return"full and energetic";if(e<.96)return"high-intensity and expansive";return"peak intensity and maximum arrangement density"; }

export function summarizeProject(project) {
  const g=project?.global||{}, duration=totalDuration(project), sections=project?.timeline?.sections?.length||0;
  return `${duration.toFixed(1)} s · ${sections} sections · ${Number(g.bpm)||120} BPM · ${g.genre||"Unspecified"}`;
}

export function compilePreview(project) {
  const g=project.global,v=g.vocal||{},sections=project.timeline.sections,metadata=[];
  if(g.genre){const influences=g.subgenres?.length?` with ${g.subgenres.join(", ")} influences`:"";metadata.push(`Genre: ${g.genre}${influences}.`);}metadata.push(`Tempo target: approximately ${g.bpm||120} BPM in ${g.meter||"4/4"} meter.`);if(g.key)metadata.push(`Key/scale target: ${g.key}${g.scale?` ${g.scale}`:""}.`);if(g.mood)metadata.push(`Mood and emotional direction: ${g.mood}.`);metadata.push(`Energy progression: ${sections.map(s=>`${s.label||s.type} ${energyPhrase(s.energy)}`).join("; then ")}.`);if(g.production)metadata.push(`Production profile: ${g.production}.`);
  let vocalDetails;if((v.mode||"vocal").toLowerCase()==="instrumental")vocalDetails="Instrumental piece with no lead or backing vocals. Let the instrumental arrangement carry the melodic focus.";else{const parts=[v.gender?`Lead vocal: ${v.gender}`:"Lead vocal: present"];if(v.timbre)parts.push(`timbre ${v.timbre}`);if(v.delivery)parts.push(`delivery ${v.delivery}`);vocalDetails=`${parts.join("; ")}.`;if(v.harmony)vocalDetails+=` Harmony/backing vocals: ${v.harmony}.`;if(v.effects)vocalDetails+=` Vocal effects: ${v.effects}.`;}
  let cursor=0;const arrangement=sections.map(s=>{const end=cursor+(Number(s.duration)||0),inst=s.instruments?.length?s.instruments.join(", "):"arrangement appropriate to the established palette";let line=`${s.label||s.type} (${formatTime(cursor)}–${formatTime(end)} target, ${energyPhrase(s.energy)}): Use ${inst}.`;if(s.vocal)line+=` Vocal treatment: ${s.vocal}.`;if(s.directives)line+=` ${String(s.directives).replace(/[.\s]+$/,"")}.`;cursor=end;return line;});
  const caption=[`### Global Metadata\n${metadata.join(" ")}`,`### Vocal Details\n${vocalDetails}`,`### Arrangement\n${arrangement.join("\n")}`].join("\n\n");const instrumental=(v.mode||"vocal").toLowerCase()==="instrumental";const lyrics=sections.flatMap(s=>{const block=[`[${s.type}]`],text=String(s.lyrics||"").replace(/^\s*\[[^\]]+\]\s*/gm,"").trim();if(text&&!instrumental)block.push(text);return block;}).join("\n");return {caption,lyrics};
}

export function el(tag, className="", text) { const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; }
export function button(text,className="m3ss-button") { const node=el("button",className,text);node.type="button";return node; }
export function textInput(value="",placeholder="") { const node=document.createElement("input");node.type="text";node.value=value??"";node.placeholder=placeholder;return node; }
export function numberInput(value,min,max,step=1,{wheel=true}={}) { const node=document.createElement("input");node.type="number";node.value=String(Number.isFinite(Number(value))?value:0);node.min=String(min);node.max=String(max);node.step=String(step);if(wheel)node.addEventListener("wheel",e=>{if(document.activeElement!==node)return;e.preventDefault();const dir=e.deltaY>0?-1:1;node.value=String(clamp(Number(node.value)+dir*Number(step),min,max));node.dispatchEvent(new Event("input",{bubbles:true}));},{passive:false});return node; }
export function selectInput(options,value){const node=document.createElement("select");for(const item of options){const data=typeof item==="object"?item:{value:item,label:item};const opt=document.createElement("option");opt.value=data.value;opt.textContent=data.label;opt.selected=String(data.value)===String(value);node.appendChild(opt);}return node;}
export function textarea(value="",placeholder="",rows=4){const node=document.createElement("textarea");node.value=value??"";node.placeholder=placeholder;node.rows=rows;return node;}
export function field(label,control,helper=""){const wrap=el("label","m3ss-field");wrap.append(el("span","m3ss-label",label),control);if(helper)wrap.appendChild(el("span","m3ss-helper",helper));return wrap;}
