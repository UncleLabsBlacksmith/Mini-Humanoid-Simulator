import fs from 'node:fs';
import {evaluate} from './gait-search.mjs';
import {initPhysics} from './static/physics-core.mjs';
await initPhysics();
const rows=[];
for(const roll of [6,9,12])for(const rollPhase of [.25,.4,.55])for(const uvcRoll of [0,4]){
  const p={stride:16,period:1.6,duty:.6,lift:8,down:124,lean:2,hipBias:1,roll,rollPhase,arms:10,armSwing:8,elbow:25,clip:true};
  const settings={uvc:true,uvcPitch:3,uvcRoll,uvcLimit:8};
  const r={...evaluate(p,10,settings),settings};rows.push(r);
  fs.writeFileSync('data/stride-trials.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(r));
}
