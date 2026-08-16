import { createStudioWindow } from '../../web/studio_shell.js';
import { installCssSizeDrag, makeVerticalSplitter } from '../../web/layout_splitter.js';
import { numberInput } from '../../web/semantic_studio_core.js';

const shell=createStudioWindow({title:'Fixture Studio',subtitle:'Resizable shell',storageKey:'m3ss-test-window',defaultWidth:900,defaultHeight:620,minWidth:640,minHeight:420});
const body=document.createElement('div');
body.style.cssText='--fixture-side:280px;display:grid;grid-template-columns:minmax(0,1fr) 7px var(--fixture-side);min-height:300px;padding:16px;';
const main=document.createElement('main');main.id='fixture-main';main.style.padding='12px';
const duration=numberInput(3,0.5,360,0.5);duration.id='duration-input';main.appendChild(duration);
const splitter=makeVerticalSplitter('fixture-splitter');splitter.id='fixture-splitter';splitter.style.cssText='width:7px;cursor:col-resize;background:#555;touch-action:none;';
const side=document.createElement('aside');side.id='fixture-side';side.style.cssText='padding:12px;background:#222;';side.textContent='Inspector';
body.append(main,splitter,side);shell.content.appendChild(body);
installCssSizeDrag({handle:splitter,target:body,cssVariable:'--fixture-side',storageKey:'fixture-side-width',defaultSize:280,minSize:180,maxSize:460,invert:true});
shell.mount();
