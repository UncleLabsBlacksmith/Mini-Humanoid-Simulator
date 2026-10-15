import fs from 'node:fs';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import * as THREE from './static/vendor/three.module.js';
import {initPhysics,PhysicsSimulation,DT} from './static/physics-core.mjs';
const robot=JSON.parse(fs.readFileSync(new URL('./static/robot.json',import.meta.url),'utf8'));
const model=JSON.parse(fs.readFileSync(new URL('./static/physics-model.json',import.meta.url),'utf8'));
const base={stride:24,period:2,duty:.6,lift:2,down:124,lean:3,hipBias:0,roll:0,rollPhase:0,arms:10,armSwing:8,elbow:25};
export function makeGait(params){
  const p={...base,...params},frames=[];
  for(let i=0;i<=160;i++){
    const phase=i/160+(p.startPhase||0),angles=Object.fromEntries(robot.joints.map(j=>[j.name,0]));
    for(const [side,shift]of [['L',0],['R',.5]]){
      const full=phase+shift,k=Math.floor(full),q=full-k;
      let foot=p.stride*(p.duty/2+k-shift),lift=0;
      if(q>p.duty){const u=(q-p.duty)/(1-p.duty);foot+=p.stride*u*u*(3-2*u);lift=p.lift*Math.sin(Math.PI*u)**2;}
      const dy=p.stride*phase-foot,down=p.down-lift,cos=(dy*dy+down*down-2*63*63)/(2*63*63);
      if(cos>1||cos< -1)return null;
      const beta=Math.acos(cos),alpha=Math.atan2(dy,down)-beta/2;
      angles[side+'_HipPitch']=-alpha*180/Math.PI+p.hipBias;
      angles[side+'_KneePitch']=beta*180/Math.PI;
      angles[side+'_AnklePitch']=(alpha+beta)*180/Math.PI+p.lean;
      angles[side+'_Hip_Roll']=p.roll*Math.sin(2*Math.PI*(phase+p.rollPhase));
      angles[side+'_ShoulderPitch']=p.arms+p.armSwing*Math.sin(2*Math.PI*(phase+shift));
      angles[side+'_ElbowPitch']=p.elbow;
    }
    for(const j of robot.joints){
      if(p.clip)angles[j.name]=Math.max(j.limits[0],Math.min(j.limits[1],angles[j.name]));
      else if(angles[j.name]<j.limits[0]-1e-6||angles[j.name]>j.limits[1]+1e-6)return null;
    }
    frames.push({t:i/160*p.period,joints:angles,root:[0,-p.stride*i/160,p.down-126]});
  }
  return {version:1,name:'Physics gait candidate',description:'Joint-only gait optimization candidate; physics root motion is ignored.',loop:true,interpolation:'linear',frames};
}
export function evaluate(p,seconds=10,settings={}){
  const program=makeGait(p);if(!program)return {p,score:-100,invalid:true};
  const s=new PhysicsSimulation(robot,model,program,{...settings,duration:seconds});
  const startX=s.metrics.com.x;let atTwo=0,atHalf=0,sideMax=0,peak=0,clearance={L:0,R:0},liftSamples={L:0,R:0},contacts={L:0,R:0};
  for(let i=0;i<Math.round(seconds/DT);i++){
    s.step();if(s.fall)break;
    sideMax=Math.max(sideMax,Math.abs(s.metrics.com.x-startX));peak=Math.max(peak,s.metrics.tilt);
    if(s.time<=2)atTwo=s.metrics.displacement;if(s.time<=seconds/2)atHalf=s.metrics.displacement;
    if(i%8===0&&s.time>2)for(const side of ['L','R']){
      const body=s.bodies[side+'_Foot'],q=body.rotation(),pivot=s.pivots[side+'_Foot'];
      const lowest=Math.min(...robot.footCorners[side].map(c=>new THREE.Vector3(...c).multiplyScalar(.001).sub(pivot).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w)).add(body.translation()).z));
      clearance[side]=Math.max(clearance[side],lowest);if(lowest>.0005)liftSamples[side]++;if(s.metrics.forces[side]>.5)contacts[side]++;
    }
  }
  const forward=new THREE.Vector3(0,-1,0).applyQuaternion(s.bodies.Torso.rotation());const yaw=Math.atan2(forward.x,-forward.y)*180/Math.PI;
  const d=s.metrics.displacement,travel=d-atTwo,late=d-atHalf;
  const score=s.fall?-1+Math.min(.8,s.time/seconds)*.1:travel+late*.5-sideMax*.7-Math.max(0,peak-15)*.001-Math.abs(yaw)*.0003;
  const result={p,score,distance:d,travel,late,sideMax,peak,yaw,clearance,liftSamples,contacts,fall:s.fall,seconds:s.time};s.dispose();return result;
}

if(!isMainThread&&process.argv[1]?.endsWith('gait-search.mjs')){await initPhysics();parentPort.on('message',task=>{try{parentPort.postMessage(evaluate(task.p,task.seconds));}catch(e){parentPort.postMessage({p:task.p,score:-100,error:String(e)});}});}
else if(process.argv[1]===new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1').replaceAll('%20',' ')||process.argv[1]?.endsWith('gait-search.mjs')){
  const mode=process.argv[2]||'grid';let jobs=[];
  if(mode==='grid'){
    for(const lean of [-2,0,2,4,6])for(const period of [1.2,2,3])for(const stride of [12,24,36])jobs.push({...base,lean,period,stride});
  }else if(mode==='phase'){
    for(const startPhase of [0,.125,.25,.375,.5,.625,.75,.875])for(const period of [1,1.2,1.4])jobs.push({...base,stride:16,period,lift:8,duty:.6,roll:14,rollPhase:.75,lean:2,hipBias:1,clip:true,startPhase});
  }else if(mode==='verify'){
    jobs=JSON.parse(fs.readFileSync('gait-search-results.json','utf8')).filter(r=>!r.invalid&&!r.fall).sort((a,b)=>b.score-a.score).slice(0,6).map(r=>r.p);
  }else if(mode==='strong'){
    for(const period of [1.2,2])for(const stride of [16,28])for(const lift of [5,8])for(const rollPhase of [0,.25,.5,.75])jobs.push({...base,period,stride,lift,duty:.6,roll:14,rollPhase,lean:2,hipBias:1,clip:true});
  }else{
    const previous=JSON.parse(fs.readFileSync('gait-search-results.json','utf8')).filter(r=>!r.invalid&&!r.fall).sort((a,b)=>b.score-a.score).slice(0,8);
    let seed=12345+Number(process.argv[3]||0);const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    jobs=previous.map(r=>r.p);
    for(let i=0;i<120;i++){
      const p={...previous[i%previous.length].p},clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
      p.lean=clamp(p.lean+(random()-.5)*5,-5,9);p.hipBias=clamp((p.hipBias||0)+(random()-.5)*5,-4,5);
      p.period=clamp(p.period+(random()-.5)*1,1,3.5);p.stride=clamp(p.stride+(random()-.5)*18,8,42);
      p.duty=clamp(p.duty+(random()-.5)*.2,.48,.75);p.lift=clamp(p.lift+(random()-.5)*3,.5,5);
      p.down=clamp(p.down+(random()-.5)*2,121,125);p.roll=clamp((p.roll||0)+(random()-.5)*12,-15,15);p.rollPhase=random();
      p.arms=clamp(p.arms+(random()-.5)*12,-5,24);p.armSwing=clamp(p.armSwing+(random()-.5)*8,0,10);jobs.push(p);
    }
  }
  const results=[],workers=[],seconds=mode==='verify'?60:mode==='grid'?8:12;let next=0,best=-Infinity;
  fs.writeFileSync('gait-search-progress.json',JSON.stringify({mode,total:jobs.length,done:0}));
  await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url));workers.push(worker);
    const assign=()=>{if(next<jobs.length)worker.postMessage({p:jobs[next++],seconds});else{worker.terminate();resolve();}};
    worker.on('error',reject);worker.on('message',r=>{results.push(r);if(r.score>best){best=r.score;console.log(JSON.stringify({done:results.length,total:jobs.length,best:r}));}fs.writeFileSync('gait-search-progress.json',JSON.stringify({mode,total:jobs.length,done:results.length,best}));assign();});assign();
  })));
  const old=mode==='grid'?[]:JSON.parse(fs.readFileSync('gait-search-results.json','utf8'));
  fs.writeFileSync('gait-search-results.json',JSON.stringify([...old,...results].sort((a,b)=>b.score-a.score),null,2));
  console.log('Search completed:',results.length);
}
