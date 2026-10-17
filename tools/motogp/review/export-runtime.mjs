import { build } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const out = resolve(process.argv[2] || '../evidence/runtime-exchange');
mkdirSync(out, { recursive: true });
const result = await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:resolve('tools/motogp/review/export-runtime.ts'),name:'GPExchange',formats:['iife']}}});
const bundle=Array.isArray(result)?result[0]:result;
const chunk=bundle.output.find((v)=>v.type==='chunk');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:false,args:['--no-sandbox','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist']});
const page=await browser.newPage();
const errors=[];const warnings=[];
page.on('pageerror',(e)=>errors.push(e.message));
page.on('console',(m)=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
try {
 await page.setContent('<!doctype html><title>Production GP native exchange</title>');
 await page.addScriptTag({content:chunk.code});
 const assets=[];
 for(const id of ['gpr1','gpr2']) {
   const result=await page.evaluate((id)=>window.GPExchange.exportRuntimeGP(id),id);
   const data=Buffer.from(result.binary,'base64');
   if(data.toString('ascii',0,4)!=='glTF'||data.readUInt32LE(8)!==data.length)throw Error('Invalid GLB');
   writeFileSync(resolve(out,`${id}-runtime.glb`),data);delete result.binary;
   assets.push({...result,sha256:createHash('sha256').update(data).digest('hex')});
   console.log(id,result.bytes,result.visibleTriangles,result.visibleMeshes);
 }
 writeFileSync(resolve(out,'manifest.json'),JSON.stringify({assets,errors,warnings},null,2)+'\n');
 if(errors.length)throw Error(JSON.stringify(errors));
}finally{await browser.close();}
