import fs from 'node:fs';
import {PhysicsSimulation,initPhysics,DT} from './static/physics-core.mjs';
import {makeV2} from './v2-gait.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const robot=read('static/models/astra-v2/robot.json'),model=read('static/models/astra-v2/physics-model.json');
const settings={batteryMass:.15,batteryX:0,batteryY:24,batteryZ:247,uvc:true,uvcPitch:3,uvcRoll:0,uvcLimit:8};
await initPhysics();
export function evaluateV2(program,seconds=10,extra={}){
  const sim=new PhysicsSimulation(robot,model,program,{...settings,...extra,duration:seconds});
  let half=0,halfSteps=0;
  for(let i=0;i<Math.round(seconds/DT)&&!sim.fall;i++){sim.step();if(i===Math.round(seconds/2/DT)){half=sim.metrics.displacement;const g=sim.stepObserver.snapshot();halfSteps=g.L.steps+g.R.steps;}}
  const g=sim.stepObserver.snapshot();const r={fall:sim.fall,elapsed:sim.time,distance:sim.metrics.displacement,late:sim.metrics.displacement-half,steps:g,lateSteps:g.L.steps+g.R.steps-halfSteps,peak:sim.maxTilt,report:sim.report()};sim.dispose();return r;
}
if(process.argv[2]==='check'){
  const rows=[];
  for(const [label,p] of [['standing',read('data/programs/astra-v2/example-blank.json')],['walking',makeV2()]]){
    const r=evaluateV2(p);rows.push({label,...r});const {report,...summary}=r;console.log(label,JSON.stringify(summary));
  }
  fs.writeFileSync('data/v2-initial-validation.json',JSON.stringify(rows,null,2));
}
if(process.argv[2]==='verify'){
  const rows=[];
  for(const candidate of read('data/v2-search.json').slice(0,4)){
    const r=evaluateV2(makeV2(candidate.p),60);rows.push({p:candidate.p,...r});
    fs.writeFileSync('data/v2-validation.json',JSON.stringify(rows,null,2));const {report,...summary}=r;console.log(JSON.stringify({p:candidate.p,...summary}));
  }
}
