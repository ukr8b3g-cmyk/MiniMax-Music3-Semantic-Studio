import { app } from "../../scripts/app.js";
import { createStudioWindow } from "./studio_shell.js";
import { hideNodeWidgets, installNodeSummary, getNodeWidget } from "./node_compact.js";
import {
  SECTION_TYPES, METERS, KEYS, SCALES, clamp, uid, factoryProject, normalizeProject,
  parseList, totalDuration, summarizeProject, compilePreview, el, button, textInput, numberInput,
  selectInput, textarea, field,
} from "./semantic_studio_core.js";

const EXTENSION_NAME = "minimax.music3.semantic.studio";
const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-style-link";
const NAV = [
  ["overview","Overview"],["global","Global"],["lyrics","Lyrics"],["vocal","Vocal"],
  ["arrangement","Arrangement"],["advanced","Advanced"],["preview","Prompt Preview"],
];

function ensureStyles(){if(document.getElementById(STYLE_ID))return;const link=document.createElement("link");link.id=STYLE_ID;link.rel="stylesheet";link.href=new URL("./semantic_studio.css",import.meta.url).href;document.head.appendChild(link);}
function nodeClass(node){return node?.comfyClass||node?.constructor?.comfyClass||node?.type||"";}

function openStudio(node, compactSummary){
  ensureStyles();
  const projectWidget=getNodeWidget(node,"project_json");
  if(!projectWidget){alert("Music3 Semantic Studio: project_json widget was not found. Restart ComfyUI and reload the workflow.");return;}
  let raw;try{raw=JSON.parse(projectWidget.value||"{}");}catch(error){if(!confirm(`Studio Project JSON is invalid. Reset to V1 defaults?\n\n${error}`))return;raw=factoryProject();}
  let project=normalizeProject(raw);if(!project.project_id)project.project_id=uid("project");
  let active="overview", selectedId=project.timeline.sections[0]?.id||null;

  const shell=createStudioWindow({title:"Music3 Semantic Studio",subtitle:`Phase 1 / Semantic authoring · ${summarizeProject(project)}`,storageKey:"m3ss-semantic-window",defaultWidth:1360,defaultHeight:860,minWidth:820,minHeight:560});
  shell.window.classList.add("m3ss-dialog");
  const workspace=el("div","m3ss-workspace"),nav=el("aside","m3ss-nav"),center=el("main","m3ss-center"),inspector=el("aside","m3ss-inspector"),footer=el("footer","m3ss-footer");
  shell.content.append(workspace,footer);workspace.append(nav,center,inspector);

  const navButtons=new Map();
  for(const [id,label] of NAV){const b=button(label,"m3ss-nav-button");b.dataset.view=id;b.onclick=()=>{active=id;render();};navButtons.set(id,b);nav.appendChild(b);}
  nav.appendChild(el("div","m3ss-nav-note","Simple by default. Detailed controls stay in the inspector and Advanced view."));

  const durationStatus=el("div","m3ss-duration-status"),actions=el("div","m3ss-footer-actions"),reset=button("Reset","m3ss-button secondary"),cancel=button("Cancel","m3ss-button secondary"),save=button("Save to Node","m3ss-button primary");actions.append(reset,cancel,save);footer.append(durationStatus,actions);
  const selected=()=>project.timeline.sections.find(s=>s.id===selectedId)||project.timeline.sections[0]||null;
  const mark=()=>{shell.setSubtitle(`Phase 1 / Semantic authoring · ${summarizeProject(project)}`);durationStatus.textContent=`${totalDuration(project).toFixed(2)} s · ${project.timeline.sections.length} sections · changes stay local until Save to Node`;};
  const update=(fn)=>{fn();mark();};

  function sectionRow(section,index){
    const row=el("button",`m3ss-structure-row${section.id===selectedId?" is-selected":""}`);row.type="button";row.onclick=()=>{selectedId=section.id;render();};
    row.append(el("span","m3ss-row-index",String(index+1)),el("span","m3ss-row-name",section.label||section.type),el("span","m3ss-row-type",section.type),el("span","m3ss-row-duration",`${Number(section.duration).toFixed(1)} s`),el("span","m3ss-row-energy",`${Math.round(Number(section.energy)*100)}%`),el("span","m3ss-row-inst",section.instruments?.slice(0,3).join(", ")||"—"));
    return row;
  }

  function renderOverview(){
    center.replaceChildren();const g=project.global;
    const head=el("div","m3ss-center-head"),headText=el("div");headText.append(el("h3","m3ss-view-title","Global Overview"),el("p","m3ss-view-note","Set the broad musical identity here, then shape sections below."));const add=button("+ Section","m3ss-button secondary");head.append(headText,add);add.onclick=()=>{if(project.timeline.sections.length>=32)return alert("V1 supports up to 32 sections.");const s={id:uid("verse"),type:"Verse",label:`Verse ${project.timeline.sections.filter(x=>x.type==="Verse").length+1}`,duration:16,energy:.5,lyrics:"",instruments:[],vocal:"",directives:""};project.timeline.sections.push(s);selectedId=s.id;mark();render();};center.appendChild(head);
    const grid=el("div","m3ss-overview-grid");
    const genre=textInput(g.genre,"Lo-fi hip-hop, J-Pop, cinematic...");genre.oninput=()=>{g.genre=genre.value;mark();};
    const mood=textInput(g.mood,"dreamy, late-night, warm...");mood.oninput=()=>{g.mood=mood.value;mark();};
    const bpm=numberInput(g.bpm||120,20,400,1);bpm.oninput=()=>{g.bpm=clamp(bpm.value,20,400);mark();};
    const meter=selectInput(METERS.includes(g.meter)?METERS:[...METERS,g.meter],g.meter||"4/4");meter.onchange=()=>{g.meter=meter.value;mark();};
    const mode=selectInput([{value:"vocal",label:"Vocal"},{value:"instrumental",label:"Instrumental"}],g.vocal?.mode||"vocal");mode.onchange=()=>{g.vocal.mode=mode.value;mark();};
    const production=textInput(g.production,"vinyl, tape hiss, warm, wide...");production.oninput=()=>{g.production=production.value;mark();};
    grid.append(field("Genre / Style",genre),field("Mood",mood),field("BPM",bpm),field("Meter",meter),field("Vocal mode",mode),field("Production",production));center.appendChild(grid);
    center.appendChild(el("h3","m3ss-section-heading","Song Structure"));
    const table=el("div","m3ss-structure");table.appendChild(el("div","m3ss-structure-header","#   Section · Type · Duration · Energy · Instruments"));project.timeline.sections.forEach((s,i)=>table.appendChild(sectionRow(s,i)));center.appendChild(table);
  }

  function renderGlobal(){
    center.replaceChildren();center.append(el("h3","m3ss-view-title","Global"),el("p","m3ss-view-note","Finite musical choices use selectors; expressive style fields remain free-form."));const g=project.global,grid=el("div","m3ss-form-grid");
    const specs=[
      ["Working title",textInput(g.title,"Optional project title"),v=>g.title=v,"Project-only; not injected into the caption."],
      ["Genre",textInput(g.genre,"Pop, rock, ambient..."),v=>g.genre=v],
      ["Subgenres / influences",textInput((g.subgenres||[]).join(", "),"city pop, jazz, orchestral"),v=>g.subgenres=parseList(v)],
      ["BPM",numberInput(g.bpm||120,20,400,1),v=>g.bpm=clamp(v,20,400),"Semantic target, not a strict timing guarantee."],
      ["Meter",selectInput(METERS.includes(g.meter)?METERS:[...METERS,g.meter],g.meter||"4/4"),v=>g.meter=v],
      ["Key",selectInput(KEYS.includes(g.key)?KEYS:[...KEYS,g.key],g.key||""),v=>g.key=v],
      ["Scale",selectInput(SCALES.includes(g.scale)?SCALES:[...SCALES,g.scale],g.scale||""),v=>g.scale=v],
      ["Mood / direction",textInput(g.mood,"intimate, energetic, dark..."),v=>g.mood=v],
      ["Production profile",textarea(g.production,"dry, live-room, tape-saturated...",5),v=>g.production=v],
    ];
    for(const [label,control,set,helper=""] of specs){const event=control.tagName==="SELECT"?"change":"input";control.addEventListener(event,()=>{set(control.value);mark();});grid.appendChild(field(label,control,helper));}center.appendChild(grid);
  }

  function renderLyrics(){
    center.replaceChildren();center.append(el("h3","m3ss-view-title","Lyrics"),el("p","m3ss-view-note","Choose a section below. Section tags are generated automatically."));const list=el("div","m3ss-lyrics-list");for(const s of project.timeline.sections){const card=el("article",`m3ss-lyrics-card${s.id===selectedId?" is-selected":""}`);const title=button(`${s.label||s.type} · ${Number(s.duration).toFixed(1)} s`,`m3ss-lyrics-title`);title.onclick=()=>{selectedId=s.id;render();};const area=textarea(s.lyrics,"Lyrics for this section. Do not include [Verse]/[Chorus] tags.",6);area.oninput=()=>{s.lyrics=area.value;mark();};card.append(title,area);list.appendChild(card);}center.appendChild(list);
  }

  function renderVocal(){
    center.replaceChildren();center.append(el("h3","m3ss-view-title","Vocal"),el("p","m3ss-view-note","Song-level vocal character. Per-section delivery remains available in the Section Inspector."));const v=project.global.vocal,grid=el("div","m3ss-form-grid");const items=[
      ["Mode",selectInput([{value:"vocal",label:"Vocal"},{value:"instrumental",label:"Instrumental"}],v.mode||"vocal"),x=>v.mode=x],
      ["Lead / gender",textInput(v.gender,"female, male, duet, androgynous..."),x=>v.gender=x],
      ["Timbre",textInput(v.timbre,"warm, breathy, clear..."),x=>v.timbre=x],
      ["Delivery",textInput(v.delivery,"intimate, rhythmic, powerful..."),x=>v.delivery=x],
      ["Harmony / backing",textarea(v.harmony,"soft harmony in choruses...",4),x=>v.harmony=x],
      ["Vocal effects",textarea(v.effects,"room reverb, tape delay...",4),x=>v.effects=x],
    ];for(const [label,c,set] of items){c.addEventListener(c.tagName==="SELECT"?"change":"input",()=>{set(c.value);mark();});grid.appendChild(field(label,c));}center.appendChild(grid);
  }

  function renderArrangement(){
    center.replaceChildren();center.append(el("h3","m3ss-view-title","Arrangement"),el("p","m3ss-view-note","The lifecycle of instruments and section intensity is edited per section."));const list=el("div","m3ss-arrangement-list");for(const s of project.timeline.sections){const card=el("article",`m3ss-arrangement-card${s.id===selectedId?" is-selected":""}`);const title=button(s.label||s.type,"m3ss-arrangement-title");title.onclick=()=>{selectedId=s.id;render();};const inst=textInput((s.instruments||[]).join(", "),"piano, bass, drums");inst.oninput=()=>{s.instruments=parseList(inst.value);mark();};const directive=textarea(s.directives,"What enters, exits, intensifies, or changes?",4);directive.oninput=()=>{s.directives=directive.value;mark();};card.append(title,field("Instruments",inst),field("Directive",directive));list.appendChild(card);}center.appendChild(list);
  }

  function renderAdvanced(){
    center.replaceChildren();center.append(el("h3","m3ss-view-title","Advanced"),el("p","m3ss-view-note","Generation parameters remain on the ComfyUI node. This view exposes project-level diagnostics without requiring raw JSON editing."));const panel=el("div","m3ss-diagnostic");panel.append(el("strong","",`Project ID: ${project.project_id||"(new project)"}`),el("span","",`Schema: ${project.schema_version}`),el("span","",`Reserved V2 audio edits: ${project.audio_edits?.length||0}`),el("span","",`Reserved takes: ${project.takes?.length||0}`),el("span","",`Reserved V3 conditioning tracks: ${project.conditioning_tracks?.length||0}`));center.appendChild(panel);
  }

  function renderPreview(){const compiled=compilePreview(project);center.replaceChildren();center.append(el("h3","m3ss-view-title","Prompt Preview"),el("div","m3ss-callout","This is the semantic text sent to MiniMax Music3. Timing, BPM, key and energy remain generative targets."));const grid=el("div","m3ss-preview-grid"),a=el("section","m3ss-preview-panel"),b=el("section","m3ss-preview-panel");a.append(el("h4","","Caption"),el("pre","m3ss-pre",compiled.caption));b.append(el("h4","","Lyrics"),el("pre","m3ss-pre",compiled.lyrics||"(section tags only)"));grid.append(a,b);center.appendChild(grid);}

  function renderCenter(){if(active==="overview")renderOverview();else if(active==="global")renderGlobal();else if(active==="lyrics")renderLyrics();else if(active==="vocal")renderVocal();else if(active==="arrangement")renderArrangement();else if(active==="advanced")renderAdvanced();else renderPreview();}

  function renderInspector(){
    inspector.replaceChildren();const s=selected();inspector.appendChild(el("h3","m3ss-inspector-title","Section Inspector"));if(!s){inspector.appendChild(el("div","m3ss-empty","Add a section to edit it."));return;}
    const type=selectInput(SECTION_TYPES,s.type),label=textInput(s.label,s.type),duration=numberInput(s.duration,.5,360,.5),energy=document.createElement("input"),energyValue=el("span","m3ss-energy-value",`${Math.round(s.energy*100)}%`),inst=textInput((s.instruments||[]).join(", "),"piano, bass, drums"),vocal=textInput(s.vocal,"soft, power, instrumental..."),lyrics=textarea(s.lyrics,"Section lyrics",5),directive=textarea(s.directives,"Arrangement directive",5);energy.type="range";energy.min="0";energy.max="100";energy.step="1";energy.value=String(Math.round(s.energy*100));const energyWrap=el("div","m3ss-energy-control");energyWrap.append(energy,energyValue);
    type.onchange=()=>update(()=>{s.type=type.value;if(!s.label)s.label=type.value;});label.oninput=()=>update(()=>s.label=label.value);duration.oninput=()=>update(()=>s.duration=clamp(duration.value,.5,360));energy.oninput=()=>update(()=>{s.energy=Number(energy.value)/100;energyValue.textContent=`${energy.value}%`;});inst.oninput=()=>update(()=>s.instruments=parseList(inst.value));vocal.oninput=()=>update(()=>s.vocal=vocal.value);lyrics.oninput=()=>update(()=>s.lyrics=lyrics.value);directive.oninput=()=>update(()=>s.directives=directive.value);
    const move=el("div","m3ss-inspector-actions"),up=button("↑","m3ss-icon-button"),down=button("↓","m3ss-icon-button"),remove=button("Delete","m3ss-button danger");const index=project.timeline.sections.indexOf(s);up.disabled=index<=0;down.disabled=index>=project.timeline.sections.length-1;up.onclick=()=>{if(index<=0)return;[project.timeline.sections[index-1],project.timeline.sections[index]]=[project.timeline.sections[index],project.timeline.sections[index-1]];mark();render();};down.onclick=()=>{if(index>=project.timeline.sections.length-1)return;[project.timeline.sections[index+1],project.timeline.sections[index]]=[project.timeline.sections[index],project.timeline.sections[index+1]];mark();render();};remove.onclick=()=>{if(project.timeline.sections.length<=1)return alert("At least one section is required.");project.timeline.sections.splice(index,1);selectedId=project.timeline.sections[Math.max(0,index-1)]?.id||null;mark();render();};move.append(up,down,remove);
    inspector.append(field("Type",type),field("Title",label),field("Duration (s)",duration,"Mouse wheel changes by 0.5 s while focused."),field("Energy",energyWrap),field("Instruments",inst),field("Section vocal",vocal),field("Lyrics",lyrics),field("Arrangement",directive),move);
  }

  function render(){for(const [id,b] of navButtons)b.classList.toggle("is-active",id===active);renderCenter();renderInspector();mark();}
  reset.onclick=()=>{if(!confirm("Reset this editor session to V1 defaults? The node is unchanged until Save to Node."))return;const keep=project.project_id;project=factoryProject();project.project_id=keep||uid("project");selectedId=project.timeline.sections[0]?.id||null;active="overview";render();};cancel.onclick=()=>shell.close();save.onclick=()=>{const serialized=JSON.stringify(project);projectWidget.value=serialized;projectWidget.callback?.(serialized);const durationWidget=getNodeWidget(node,"max_duration");if(durationWidget){const max=Number(durationWidget.options?.max),limit=Number.isFinite(max)?max:360;durationWidget.value=Math.round(clamp(totalDuration(project),.04,limit)*100)/100;durationWidget.callback?.(durationWidget.value);}compactSummary?.update(summarizeProject(project));node.setDirtyCanvas?.(true,true);app.graph?.setDirtyCanvas?.(true,true);shell.close();};
  shell.mount();render();
}

app.registerExtension({
  name:EXTENSION_NAME,
  async nodeCreated(node){
    if(nodeClass(node)!==NODE_ID||node._m3ssStudioInstalled)return;node._m3ssStudioInstalled=true;ensureStyles();
    const projectWidget=getNodeWidget(node,"project_json");hideNodeWidgets(node,["project_json"]);let summary="Semantic project";try{summary=summarizeProject(normalizeProject(JSON.parse(projectWidget?.value||"{}")));}catch{}
    const compact=installNodeSummary(node,{widgetName:"Studio Summary",text:summary,minWidth:360});const open=node.addWidget?.("button","Open Semantic Studio",null,()=>openStudio(node,compact),{serialize:false});if(open){open.label="Open Semantic Studio";open.serialize=false;}
    node.setSize?.([Math.max(node.size?.[0]||360,360),Math.min(Math.max(node.computeSize?.()[1]||180,180),330)]);
  },
});
