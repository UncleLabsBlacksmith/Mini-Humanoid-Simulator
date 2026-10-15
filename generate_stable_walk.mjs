import fs from 'node:fs';
import {makeGait,evaluate} from './gait-search.mjs';
import {initPhysics,PhysicsSimulation,defaults,DT} from './static/physics-core.mjs';

await initPhysics();
const params={stride:16,period:1.2,duty:.6,lift:8,down:124,lean:2,hipBias:1,roll:14,rollPhase:.75,arms:10,armSwing:8,elbow:25,clip:true};
const program=makeGait(params);
program.name='เดินก้าวสั้นเน้นเสถียรภาพ';
program.description='ท่าก้าวสั้นสำหรับ Physics Lab ค่ามาตรฐาน: มวลรวม 1.38 kg, แรงเสียดทาน 0.8, แรงบิด 1.2 N·m, ความเร็วโปรแกรม 1×, พักเริ่ม 1 s มีการไถลและเบี่ยงด้านข้างได้ ผลทดสอบไม่รับรองฮาร์ดแวร์จริง';
const robot=JSON.parse(fs.readFileSync('static/robot.json','utf8'));
const model=JSON.parse(fs.readFileSync('static/physics-model.json','utf8'));
// Test the exact serialized artifact, without rounding angles or changing the physics.
const text=JSON.stringify(program,null,2);
const replay=JSON.parse(text);
const sim=new PhysicsSimulation(robot,model,replay,{duration:120});
let at60=null,peakSide=0;
const x0=sim.metrics.com.x;
for(let i=0;i<Math.round(120/DT);i++){
  sim.step();peakSide=Math.max(peakSide,Math.abs(sim.metrics.com.x-x0));
  if(i===14400-1){at60=sim.snapshot();console.log('60 s:',JSON.stringify(at60));}
  if(sim.fall)break;
}
const report=sim.report();report.searchParameters=params;report.candidatesScreened=229;
report.distance_m=sim.metrics.displacement;report.maximumLateralDisplacement_m=peakSide;report.at60=at60;
console.log('Long test:',JSON.stringify({seconds:sim.time,fall:sim.fall,distance:sim.metrics.displacement,peakTilt:sim.maxTilt,lateral:peakSide}));
if(sim.fall||sim.metrics.displacement<.1)throw Error('Candidate did not pass the long test; no final motion was published');
fs.writeFileSync('data/programs/example-stable-forward.json',text);
fs.writeFileSync('data/stable-forward-validation.json',JSON.stringify(report,null,2));sim.dispose();
const checks=[];
for(const [label,settings]of [['friction_0.7',{friction:.7}],['friction_0.9',{friction:.9}],['torque_1.0',{torque:1}],['battery_0.20',{batteryMass:.2}],['initial_tilt_1deg',{tilt:1}]]){
  const result=evaluate(params,30,settings);checks.push({label,settings,...result});console.log('Sensitivity:',JSON.stringify({label,fall:result.fall,distance:result.distance,peak:result.peak}));
}
report.sensitivityChecks=checks;fs.writeFileSync('data/stable-forward-validation.json',JSON.stringify(report,null,2));
