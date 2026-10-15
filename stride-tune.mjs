import fs from 'node:fs';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {makeGait} from './gait-search.mjs';
import {initPhysics,PhysicsSimulation,DT} from './static/physics-core.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const robot=read('static/robot.json'),model=read('static/physics-model.json');
if(!isMainThread){
  await initPhysics();parentPort.on('message',({p,settings})=>{
    const sim=new PhysicsSimulation(robot,model,makeGait(p),settings);let half=0,halfSteps=0,maxSide=0;
    for(let i=0;i<20/DT&&!sim.fall;i++){
      sim.step();maxSide=Math.max(maxSide,Math.abs(sim.metrics.com.x));
      if(i===10/DT-1){half=sim.metrics.displacement;const g=sim.stepObserver.snapshot();halfSteps=g.L.steps+g.R.steps;}
    }
    const gait=sim.stepObserver.snapshot(),steps=gait.L.steps+gait.R.steps,late=sim.metrics.displacement-half;
    const result={p,settings,gait,lateSteps:steps-halfSteps,distance:sim.metrics.displacement,late,maxSide,tilt:sim.maxTilt,fall:sim.fall};
    result.score=sim.fall?-100:late+sim.metrics.displacement*.3+(steps-halfSteps)*.004-maxSide*.5;
    sim.dispose();parentPort.postMessage(result);
  });
}else{
  const jobs=[],rows=[];let index=0,best=-Infinity;
  for(const period of [.5,.6,.7])for(const roll of [6,7.5])for(const rollPhase of [.2,.3])for(const uvcPitch of [.5,3])jobs.push({p:{stride:16,period,duty:.6,lift:8,down:124,lean:2,hipBias:1,roll,rollPhase,arms:10,armSwing:8,elbow:25,clip:true},settings:{uvc:true,uvcPitch,uvcRoll:0,uvcLimit:8}});
  await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{
    const w=new Worker(new URL(import.meta.url));
    const next=()=>index<jobs.length?w.postMessage(jobs[index++]):(w.terminate(),resolve());
    w.on('error',reject);w.on('message',r=>{rows.push(r);fs.writeFileSync('data/stride-tuning.json',JSON.stringify(rows.sort((a,b)=>b.score-a.score),null,2));if(r.score>best){best=r.score;console.log(JSON.stringify({completed:rows.length,total:jobs.length,best:r}));}next();});next();
  })));
  console.log('Finished',rows.length);
}
