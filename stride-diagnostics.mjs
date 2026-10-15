import fs from 'node:fs';
import {makeGait,evaluate} from './gait-search.mjs';
import {initPhysics} from './static/physics-core.mjs';
await initPhysics();
const original={stride:16,period:1.2,duty:.6,lift:8,down:124,lean:2,hipBias:1,roll:14,rollPhase:.75,arms:10,armSwing:8,elbow:25,clip:true};
const settings={uvc:true,uvcPitch:3,uvcRoll:0,uvcLimit:8};
const rows=[evaluate(original,12,settings)];
console.log('CURRENT',JSON.stringify(rows[0]));
for(const period of [1.2,1.6,2])for(const roll of [12,15])for(const rollPhase of [0,.25,.5,.75]){
  const p={...original,stride:24,period,roll,rollPhase};
  const r=evaluate(p,10,settings);rows.push(r);
  fs.writeFileSync('data/stride-diagnostics.json',JSON.stringify(rows,null,2));
  console.log(JSON.stringify(r));
}
