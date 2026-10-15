import fs from 'node:fs';
import {initPhysics,PhysicsSimulation,DT} from './static/physics-core.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const robot=read('./static/robot.json'),model=read('./static/physics-model.json');
await initPhysics();
export function run(id,settings={},duration=30,push=null,full=false){
  const program=read('./data/programs/'+id+'.json');
  const sim=new PhysicsSimulation(robot,model,program,{...settings,duration});
  let maxSide=0,activeSteps=0,saturatedSteps=0;
  for(let i=0;i<Math.round(duration/DT);i++){
    if(push&&i===Math.round(push.time/DT))sim.push(push.impulse,push.direction);
    sim.step();maxSide=Math.max(maxSide,Math.abs(sim.metrics.com.x));
    if(sim.controller.state.active)activeSteps++;
    if(sim.controller.state.saturated.length)saturatedSteps++;
    if(sim.fall)break;
  }
  const r={program:id,settings,requestedDuration:duration,push,elapsed:sim.time,fall:sim.fall,forward_m:sim.metrics.displacement,maxSide_m:maxSide,maxTilt_deg:sim.maxTilt,activeFraction:activeSteps/sim.steps,saturatedFraction:saturatedSteps/sim.steps,...(full?{report:sim.report()}:{})};
  sim.dispose();return r;
}
if(process.argv[2]==='search'){
  const rows=[];
  for(const id of ['example-walk','example-stable-forward']){
    rows.push(run(id,{uvc:false},15));console.log(JSON.stringify(rows.at(-1)));
    for(const pitch of [.25,1,3,8])for(const roll of [0,1,4]){
      rows.push(run(id,{uvc:true,uvcPitch:pitch,uvcRoll:roll,uvcLimit:8},15));
      console.log(JSON.stringify(rows.at(-1)));
      fs.writeFileSync('data/uvc-search.json',JSON.stringify(rows,null,2));
    }
  }
}
if(process.argv[2]==='verify'){
  const rows=[];
  const save=()=>fs.writeFileSync('data/uvc-validation.json',JSON.stringify({schema:'astra-uvc-comparison-v1',source:'https://ai2001.ifdef.jp/uvc/QandA_Eng.html',method:'Independent contact-weighted hip-angle integral; no original code copied; same physics and gait for each off/on pair.',rows},null,2));
  for(const id of ['example-walk','example-stable-forward']){
    const scenarios=id==='example-walk'?[null]:[null,{time:5,impulse:.15,direction:'forward'},{time:5,impulse:.15,direction:'side'},{time:5,impulse:.3,direction:'forward'}];
    for(const push of scenarios)for(const enabled of [false,true]){
      const r=run(id,{uvc:enabled,uvcPitch:3,uvcRoll:0,uvcLimit:8},!push&&id==='example-stable-forward'?120:30,push,true);
      rows.push(r);const {report,...summary}=r;console.log(JSON.stringify(summary));save();
    }
  }
}
