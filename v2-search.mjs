import fs from 'node:fs';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {makeV2} from './v2-gait.mjs';
import {evaluateV2} from './v2-validate.mjs';
if(!isMainThread){parentPort.on('message',p=>{const {report,...r}=evaluateV2(makeV2(p),10);const n=r.steps.L.steps+r.steps.R.steps;parentPort.postMessage({...r,p,score:r.fall?-100:r.distance+r.late*.5+n*.003});});}
else{
  const jobs=[],rows=[];let next=0,best=-Infinity;
  for(const period of [.5,.8,1.2])for(const roll of [4,8,12])for(const rollPhase of [.2,.5,.75])jobs.push({period,roll,rollPhase});
  await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{
    const w=new Worker(new URL(import.meta.url));const send=()=>next<jobs.length?w.postMessage(jobs[next++]):(w.terminate(),resolve());
    w.on('error',reject);w.on('message',r=>{rows.push(r);fs.writeFileSync('data/v2-search.json',JSON.stringify(rows.sort((a,b)=>b.score-a.score),null,2));if(r.score>best){best=r.score;console.log(JSON.stringify({done:rows.length,best:r}));}send();});send();
  })));console.log('Complete',rows.length);
}
