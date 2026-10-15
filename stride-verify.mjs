import fs from 'node:fs';
import {makeGait} from './gait-search.mjs';
import {initPhysics,PhysicsSimulation,DT} from './static/physics-core.mjs';
await initPhysics();
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const robot=read('static/robot.json'),model=read('static/physics-model.json'),rows=[];
const fast=process.argv[2]==='fast';
for(const roll of fast?[7.5]:[6,9]){
  const p={stride:16,period:fast?.5:.65,duty:.6,lift:8,down:124,lean:2,hipBias:1,roll,rollPhase:fast?.2:.3,arms:10,armSwing:8,elbow:25,clip:true};
  const program=makeGait(p),sim=new PhysicsSimulation(robot,model,program,{uvc:true,uvcPitch:3,uvcRoll:0,uvcLimit:8,duration:60});
  let maxSide=0;
  for(let i=0;i<60/DT&&!sim.fall;i++){sim.step();maxSide=Math.max(maxSide,Math.abs(sim.metrics.com.x));}
  const r={p,steps:sim.stepObserver.snapshot(),distance:sim.metrics.displacement,tilt:sim.maxTilt,maxSide,fall:sim.fall,elapsed:sim.time,report:sim.report()};rows.push(r);sim.dispose();
  fs.writeFileSync(fast?'data/forward-steps-validation.json':'data/stride-validation.json',JSON.stringify(rows,null,2));const {report,...summary}=r;console.log(JSON.stringify(summary));
}
