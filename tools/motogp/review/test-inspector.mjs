import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const file=resolve(process.argv[2]??'../handoff/MOTOBOUND_GP_Inspector.html');
const out=resolve(process.argv[3]??'../evidence/inspector');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:false,args:['--no-sandbox','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist']});
const errors=[],requests=[],states=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:880}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 await page.setContent(readFileSync(file,'utf8'),{waitUntil:'load'});
 await page.waitForFunction(()=>window.gpInspector?.getState().frames>=10,{timeout:60000});
 const state=async(label)=>{
   await page.waitForTimeout(400);
   const s=await page.evaluate(()=>window.gpInspector.getState());
   if(s.glError!==0||s.errors.length)throw new Error(JSON.stringify(s));
   states.push({label,...s});console.log(label,s.machine,s.detail,s.triangles,s.frames);
 };
 await state('initial-gpr1');
 if(states.at(-1).triangles!==106729)throw new Error('Unexpected complete GP-R1 geometry');
 await page.screenshot({path:resolve(out,'gp-r1-inspector.png')});
 for(const view of ['front','side','rear','detail','three']) {
   await page.locator(`[data-view="${view}"]`).click(); await state(`view-${view}`);
 }
 await page.locator('#machine').selectOption('gpr2');await state('switch-gpr2');
 if(states.at(-1).triangles!==99028)throw new Error('Unexpected complete GP-R2 geometry');
 await page.screenshot({path:resolve(out,'gp-r2-inspector.png')});
 for(const detail of ['mid','far','high']) {
   await page.locator('#detail').selectOption(detail);await state(`gpr2-${detail}`);
 }
 await page.locator('#lean').evaluate(e=>{e.value='.25';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#tuck').evaluate(e=>{e.value='.2';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#spin').check();await state('posed-and-wheel-animation');
 await page.mouse.move(450,350);await page.mouse.down();await page.mouse.move(630,430,{steps:10});await page.mouse.up();
 await state('pointer-orbit');
 await page.locator('#spin').uncheck();
 await page.locator('#lean').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#tuck').evaluate(e=>{e.value='.75';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#machine').selectOption('gpr1');await state('return-gpr1');
 if(states.at(-1).triangles!==106729)throw new Error('GP-R1 geometry did not restore');
 writeFileSync(resolve(out,'results.json'),JSON.stringify({passed:errors.length===0&&requests.length===0,states,errors,externalHttpRequests:requests,scope:'Interactive standalone production-model inspector tested in an in-memory document. Not the racing application or ordinary file/HTTP navigation.'},null,2));
 if(errors.length||requests.length)throw new Error(JSON.stringify({errors,requests}));
} finally {await browser.close();}
