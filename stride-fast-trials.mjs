import fs from 'node:fs';
import {makeGait} from './gait-search.mjs';
import {initPhysics,PhysicsSimulation,DT} from './static/physics-core.mjs';
await initPhysics();
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const robot=read('static/robot.json'),model=read('static/physics-model.json'),rows=[];
for(const period of [.65,1])for(const roll of [6,9])for(const rollPhase of [.3,.45,.6]){
  const p={stride:16,period,duty:.6,lift:8,down:124,lean:2,hipBias:1,roll,rollPhase,arms:10,armSwing:8,elbow:25,clip:true};
  const settings={uvc:true,uvcPitch:3,uvcRoll:0,uvcLimit:8};
  const sim=new PhysicsSimulation(robot,model,makeGait(p),settings);
  for(let i=0;i<8/DT&&!sim.fall;i++)sim.step();
  const r={p,settings,steps:sim.stepObserver.snapshot(),distance:sim.metrics.displacement,tilt:sim.maxTilt,fall:sim.fall};rows.push(r);sim.dispose();
  fs.writeFileSync('data/stride-fast-trials.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(r));
}
