import { createStudioWindow } from '../../web/studio_shell.js';
import { numberInput } from '../../web/semantic_studio_core.js';

const shell=createStudioWindow({title:'Fixture Studio',subtitle:'Resizable shell',storageKey:'m3ss-test-window',defaultWidth:900,defaultHeight:620,minWidth:640,minHeight:420});
const body=document.createElement('div');body.style.padding='16px';
const duration=numberInput(3,0.5,360,0.5);duration.id='duration-input';body.appendChild(duration);shell.content.appendChild(body);shell.mount();
