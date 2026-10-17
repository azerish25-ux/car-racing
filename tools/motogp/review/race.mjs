import { build } from 'vite';
import { chromium } from 'playwright';
import { resolve, extname, relative } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
const out=resolve(process.argv[2]??'../evidence/r5-race');mkdirSync(out,{recursive:true});
console.log('Compiling controlled production circuit fixture');
const bundle=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:resolve('e2e/fixtures/motogp-race-review.ts'),name:'GPScene',formats:['iife']}}});
const result=Array.isArray(bundle)?bundle[0]:bundle,chunk=result.output.find(o=>o.type==='chunk');
console.log('Fixture compiled',chunk.code.length);
const assets={};const receipts=[];
function walk(root){for(const entry of readdirSync(root,{withFileTypes:true})){const p=resolve(root,entry.name);if(entry.isDirectory())walk(p);else if(/\.(webp|png|jpg|jpeg|avif|ktx2|wasm|js)$/.test(p)){const key=relative(resolve('public'),p);const data=readFileSync(p);assets[key]=`data:${/\.(jpg|jpeg)$/.test(p)?'image/jpeg':p.endsWith('.webp')?'image/webp':p.endsWith('.png')?'image/png':p.endsWith('.js')?'application/javascript':'application/octet-stream'};base64,${data.toString('base64')}`;receipts.push({path:key,bytes:data.length});}}}
walk(resolve('public/assets/basis'));walk(resolve('public/assets/third-party/texture'));walk(resolve('public/assets/third-party/ground'));walk(resolve('public/assets/third-party/hdri'));
console.log('Supplying exact local image bytes',receipts.length);
writeFileSync(resolve(out,'input-images.json'),JSON.stringify(receipts,null,2));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:false,args:['--no-sandbox','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--gpu-watchdog-timeout-seconds=120']});
try {
 const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error') { errors.push(m.text()); writeFileSync(resolve(out,'errors.json'),JSON.stringify(errors,null,2)); console.log('ERROR',m.text().slice(0,1500)); }else console.log('PAGE',m.text().slice(0,180));});
 await page.setContent('<!doctype html><title>Controlled production GP circuit composition; constructor path, not full application or native pit factory</title>');
 await page.addScriptTag({content:chunk.code});await page.evaluate(a=>window.GPScene.installOfflineAssets(a),assets);
 const result=await page.evaluate(([weather,preset])=>window.GPScene.captureGPRace(weather,preset),[process.argv[3]??'clear',process.argv[4]??'high']);
 for(const c of result.captures){writeFileSync(resolve(out,`${c.view}.png`),Buffer.from(c.image.split(',')[1],'base64'));delete c.image;}
 writeFileSync(resolve(out,'metrics.json'),JSON.stringify({...result,errors,scope:'Controlled production Simulation/RacingRenderer constructor; native pit async factory and application navigation not exercised.'},null,2));
 if(errors.length||result.glError!==0||!result.unchanged||!result.finite)throw new Error(JSON.stringify({errors,glError:result.glError,unchanged:result.unchanged,finite:result.finite}));
}finally{await browser.close();}
