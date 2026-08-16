import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

export const NODE_ID = "MiniMaxMusic3SemanticStudioAudioEditor";
export const V1_NODE_ID = "MiniMaxMusic3SemanticStudio";
export const EXTENSION_NAME = "minimax.music3.semantic.studio.audio-editor";
export const CHANNEL_MODES = ["preserve", "mono", "stereo", "left_only", "right_only", "swap_lr"];
export const FADE_CURVES = ["linear", "equal_power"];
const STYLE_ID = "m3ss-v2-style-link";

export function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./audio_editor.css", import.meta.url).href;
  document.head.appendChild(link);
}
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
export const uid = (p="item") => `${p}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const nodeClass = (n) => n?.comfyClass || n?.constructor?.comfyClass || n?.type || "";
export const getWidget = (n, name) => n?.widgets?.find((w) => w.name === name);
export function el(tag, cls="", text) { const x=document.createElement(tag); if(cls)x.className=cls; if(text!==undefined)x.textContent=text; return x; }
export function button(text, cls="m3ssv2-button") { const x=el("button",cls,text); x.type="button"; return x; }
export function input(type, value, min=null, max=null, step=null) { const x=document.createElement("input"); x.type=type; if(value!==undefined)x.value=String(value); if(min!==null)x.min=String(min); if(max!==null)x.max=String(max); if(step!==null)x.step=String(step); return x; }
export function select(options, value) { const x=document.createElement("select"); for(const item of options){const o=document.createElement("option"); o.value=item.value??item; o.textContent=item.label??item; o.selected=String(o.value)===String(value); x.appendChild(o);} return x; }
export function field(label, control, helper="") { const x=el("label","m3ssv2-field"); x.append(el("span","m3ssv2-label",label),control); if(helper)x.appendChild(el("span","m3ssv2-helper",helper)); return x; }
export function fmtTime(seconds) { const s=Math.max(0,Number(seconds)||0), m=Math.floor(s/60); return `${m}:${(s-m*60).toFixed(2).padStart(5,"0")}`; }
export const clipDuration = (c) => Math.max(0,Number(c.source_out)-Number(c.source_in));
export const clipEnd = (c) => Number(c.timeline_start)+clipDuration(c);
export function timelineDuration(project, meta) { let end=0; for(const t of project.tracks||[])for(const c of t.clips||[])end=Math.max(end,clipEnd(c)); end=Math.max(end,Number(meta?.rendered?.duration)||0); for(const t of meta?.takes||[])end=Math.max(end,Number(t.duration)||0); return Math.max(end,1); }
export function previewUrl(ref) { if(!ref)return ""; const p=new URLSearchParams({filename:ref.filename||ref.name||"",type:ref.type||"temp"}); if(ref.subfolder)p.set("subfolder",ref.subfolder); return api.apiURL(`/view?${p}`); }
export const firstPreviewRef = (entry) => entry?.audio?.[0] || null;
export function extractMeta(message) { const x=message?.m3ss_v2; return Array.isArray(x)?x[0]||null:x||null; }

export function defaultProject(meta) {
  const take=meta?.takes?.find((t)=>t.id==="take-1")||meta?.takes?.[0], duration=Number(take?.duration)||1;
  return {edit_schema_version:1,project_id:"",view:{zoom:1,scroll_seconds:0},takes:(meta?.takes||[]).map(t=>({id:t.id,input:t.input,name:t.name||t.id,enabled:true})),tracks:[{id:"main",name:"Main Comp",clips:[{id:uid("clip"),source_id:"take-1",source_in:0,source_out:duration,timeline_start:0,gain_db:0,pan:0,muted:false,reverse:false,fade_in:{duration:0,curve:"linear"},fade_out:{duration:0,curve:"linear"},gain_envelope:[]}]}],master:{gain_db:0,channel_mode:"preserve",normalize:{enabled:false,target_peak_dbfs:-1}},reserved:{}};
}

export function normalizeProject(raw, meta) {
  const fallback=defaultProject(meta), p=raw&&typeof raw==="object"?clone(raw):fallback, takeMap=new Map((meta?.takes||[]).map(t=>[t.id,t]));
  p.edit_schema_version=1; p.project_id=typeof p.project_id==="string"?p.project_id:"";
  p.view=p.view&&typeof p.view==="object"?p.view:{}; p.view.zoom=clamp(p.view.zoom||1,.05,100); p.view.scroll_seconds=Math.max(0,Number(p.view.scroll_seconds)||0);
  p.takes=(meta?.takes||[]).map(t=>{const e=Array.isArray(p.takes)?p.takes.find(x=>x?.id===t.id):null; return {...(e||{}),id:t.id,input:t.input,name:e?.name||t.name||t.id,enabled:e?.enabled!==false};});
  p.tracks=Array.isArray(p.tracks)&&p.tracks.length?p.tracks:fallback.tracks; if(!Array.isArray(p.tracks[0]?.clips)||!p.tracks[0].clips.length)p.tracks[0].clips=fallback.tracks[0].clips;
  for(const track of p.tracks){track.id||=uid("track"); track.name||="Main Comp"; track.clips=Array.isArray(track.clips)?track.clips:[]; for(const c of track.clips){c.id||=uid("clip"); if(!takeMap.has(c.source_id))c.source_id="take-1"; const src=takeMap.get(c.source_id)||meta?.takes?.[0], max=Number(src?.duration)||1; c.source_in=clamp(c.source_in,0,max); c.source_out=clamp(c.source_out??max,0,max); if(c.source_out<=c.source_in)c.source_out=Math.min(max,c.source_in+.01); c.timeline_start=Math.max(0,Number(c.timeline_start)||0); c.gain_db=clamp(c.gain_db,-60,24); c.pan=clamp(c.pan,-1,1); c.muted=!!c.muted; c.reverse=!!c.reverse; c.fade_in=c.fade_in&&typeof c.fade_in==="object"?c.fade_in:{duration:0,curve:"linear"}; c.fade_out=c.fade_out&&typeof c.fade_out==="object"?c.fade_out:{duration:0,curve:"linear"}; c.fade_in.duration=clamp(c.fade_in.duration,0,clipDuration(c)); c.fade_out.duration=clamp(c.fade_out.duration,0,clipDuration(c)); if(!FADE_CURVES.includes(c.fade_in.curve))c.fade_in.curve="linear"; if(!FADE_CURVES.includes(c.fade_out.curve))c.fade_out.curve="linear"; c.gain_envelope=Array.isArray(c.gain_envelope)?c.gain_envelope:[];}}
  p.master=p.master&&typeof p.master==="object"?p.master:{}; p.master.gain_db=clamp(p.master.gain_db,-60,24); if(!CHANNEL_MODES.includes(p.master.channel_mode))p.master.channel_mode="preserve"; p.master.normalize=p.master.normalize&&typeof p.master.normalize==="object"?p.master.normalize:{}; p.master.normalize.enabled=!!p.master.normalize.enabled; p.master.normalize.target_peak_dbfs=clamp(p.master.normalize.target_peak_dbfs??-1,-60,0); p.reserved=p.reserved&&typeof p.reserved==="object"?p.reserved:{}; return p;
}
export function mainTrack(p){if(!p.tracks?.length)p.tracks=[{id:"main",name:"Main Comp",clips:[]}]; return p.tracks[0];}

export function semanticOverlay(node) {
  const graph=app.graph; if(!graph)return []; const q=[{n:node,d:0}], seen=new Set(), found=[];
  while(q.length){const {n,d}=q.shift(); if(!n||d>12||seen.has(n.id))continue; seen.add(n.id); if(n!==node&&nodeClass(n)===V1_NODE_ID)found.push(n); for(const s of n.inputs||[]){if(s?.link==null)continue; const l=graph.links?.[s.link], origin=l?graph.getNodeById?.(l.origin_id):null; if(origin)q.push({n:origin,d:d+1});}}
  const unique=[...new Map(found.map(n=>[n.id,n])).values()]; if(unique.length!==1)return []; const w=getWidget(unique[0],"project_json"); if(!w?.value)return [];
  try{const p=JSON.parse(w.value); let cursor=0; return (p?.timeline?.sections||[]).map(s=>{const start=cursor; cursor+=Math.max(0,Number(s.duration)||0); return {start,end:cursor,label:s.label||s.type||"Section"};});}catch{return [];}
}

export const snapshot=(p)=>JSON.stringify(p); export const parseSnapshot=(s)=>JSON.parse(s);
export function splitClip(c,time){const start=Number(c.timeline_start),end=clipEnd(c); if(!(time>start+1e-6&&time<end-1e-6))return null; const off=time-start,l=clone(c),r=clone(c); l.id=uid("clip");r.id=uid("clip");r.timeline_start=time; if(c.reverse){const cut=Number(c.source_out)-off;l.source_in=cut;r.source_out=cut;}else{const cut=Number(c.source_in)+off;l.source_out=cut;r.source_in=cut;} for(const x of [l,r]){x.fade_in={duration:0,curve:x.fade_in?.curve||"linear"};x.fade_out={duration:0,curve:x.fade_out?.curve||"linear"};x.gain_envelope=[];} return [l,r];}
export function deleteTimelineRange(track,start,end){if(!(end>start))return; const out=[]; for(const c of track.clips){const cs=Number(c.timeline_start),ce=clipEnd(c); if(ce<=start||cs>=end){out.push(c);continue;} let pieces=[c]; for(const cut of [end,start]){const next=[]; for(const p of pieces){const s=splitClip(p,cut); next.push(...(s||[p]));} pieces=next;} for(const p of pieces){const ps=Number(p.timeline_start),pe=clipEnd(p); if(pe<=start||ps>=end)out.push(p);}} track.clips=out;}
