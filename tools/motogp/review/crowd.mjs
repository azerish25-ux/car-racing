import { build } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const out=resolve(process.argv[2]??'../evidence/crowd');await mkdir(out,{recursive:true});
const result=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:resolve('e2e/fixtures/people-lab.ts'),name:'GPLab',formats:['iife']}}});
const output=Array.isArray(result)?result[0]:result;const chunk=output.output.find(x=>x.type==='chunk');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:false,args:['--no-sandbox','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist']});
try{const page=await browser.newPage({viewport:{width:1000,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.setContent('<!doctype html><title>Production crowd geometry and shading inspection, not a full race</title>');await page.addScriptTag({content:chunk.code});
const result=await page.evaluate(()=>window.GPLab.crowdLab([{name:'spectators-near',eye:[-2,2,4.3],target:[2.1,1.0,0],fov:40},{name:'spectators-full-stand',eye:[-7,4,9],target:[3,1,0],fov:40}],{time:3,family:1}));
for(const[name,image]of Object.entries(result.images))await writeFile(resolve(out,`${name}.png`),Buffer.from(image.split(',')[1],'base64'));
await writeFile(resolve(out,'metrics.json'),JSON.stringify({info:result.info,errors},null,2));if(errors.length)throw Error(JSON.stringify(errors));}finally{await browser.close()}
