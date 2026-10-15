import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initPhysics,PhysicsSimulation,DT} from '../static/physics-core.mjs';

const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const robot=read('static/robot.json'),model=read('static/physics-model.json');
const blank=read('data/programs/example-blank.json'),walk=read('data/programs/example-walk.json');
await initPhysics();
function advance(sim,seconds){for(let i=0;i<Math.round(seconds/DT);i++)sim.step();return sim.metrics;}
const stand=new PhysicsSimulation(robot,model,blank);
const staticState=advance(stand,5);
assert.equal(stand.world.bodies.len(),13,'Every link must be a free dynamic body');
assert.ok(Object.values(stand.bodies).every(b=>b.isDynamic()));
assert.ok(Math.abs(stand.mass-1.38)<1e-6);
assert.equal(stand.fall,null,'Neutral stance should remain upright');
assert.ok(staticState.tilt<5);
assert.ok(Math.abs(staticState.forces.L+staticState.forces.R-stand.mass*9.81)<.5,'Measured normal force should balance gravity');
assert.ok(staticState.margin>0,'COM is within the measured contact hull at rest');

const weak=new PhysicsSimulation(robot,model,blank,{motors:false});
advance(weak,2);assert.ok(weak.fall&&weak.fall.time<1,'Disabling motors should let gravity collapse the robot');
assert.ok(weak.metrics.com.z<.1);

const physicalWalk=new PhysicsSimulation(robot,model,walk);
advance(physicalWalk,10);assert.ok(physicalWalk.fall,'Known unbalanced open-loop walk should fall');
assert.equal(physicalWalk.report().result,'fallen_in_simulation');

const feedbackWalk=new PhysicsSimulation(robot,model,walk,{uvc:true,uvcPitch:3,uvcRoll:0,uvcLimit:8,duration:15});
advance(feedbackWalk,15);
assert.equal(feedbackWalk.fall,null,'Selected UVC adaptation should stabilize the known 15 s case');
assert.ok(feedbackWalk.maxTilt<6);
assert.equal(feedbackWalk.report().feedbackBalanceController,'UVC-inspired hip integral v1');
assert.ok(feedbackWalk.trace.some(p=>Math.abs(p.uvc.offsets.L_HipPitch)>.1),'Feedback must actually modify hip targets');
assert.ok(feedbackWalk.trace.every(p=>Object.values(p.uvc.offsets).every(v=>Math.abs(v)<=8)));
assert.equal(feedbackWalk.world.bodies.len(),13,'Feedback must not add an anchored or supporting body');

const forwardSteps=new PhysicsSimulation(robot,model,read('data/programs/example-forward-steps.json'),{uvc:true,uvcPitch:3,uvcRoll:0,uvcLimit:8});
advance(forwardSteps,10);
assert.equal(forwardSteps.fall,null);
assert.ok(forwardSteps.metrics.displacement>.4,'Forward gait must visibly advance, not just oscillate');
const verifiedSteps=forwardSteps.stepObserver.snapshot();
assert.ok(verifiedSteps.L.steps>=10&&verifiedSteps.R.steps>=10,'Both feet must lift and land forward repeatedly');

const floating=new PhysicsSimulation(robot,model,blank,{gravity:0,motors:false});
const initial=floating.metrics.com.z;advance(floating,1);
assert.ok(Math.abs(floating.metrics.com.z-initial)<1e-5,'No artificial gravity or imposed movement');

const altered=structuredClone(walk);for(const f of altered.frames)f.root=[500,-9000,5000];
const a=new PhysicsSimulation(robot,model,walk),b=new PhysicsSimulation(robot,model,altered);
advance(a,1);advance(b,1);for(const key of ['x','y','z'])assert.ok(Math.abs(a.metrics.com[key]-b.metrics.com[key])<1e-7,'JSON root must never drive physical position');
const before=a.bodies.Torso.linvel().y;a.push(.15);assert.ok(a.bodies.Torso.linvel().y<before,'Push applies a real impulse');assert.equal(a.report().pushes.length,1);
console.log(JSON.stringify({standing:{tilt:staticState.tilt,normalForce:staticState.forces.L+staticState.forces.R,mass:stand.mass},unpoweredFall_s:weak.fall.time,walkFall:physicalWalk.fall,rootMotion:'ignored',zeroGravity:'pass',impulse:'pass'},null,2));
for(const sim of [stand,weak,physicalWalk,feedbackWalk,forwardSteps,floating,a,b])sim.dispose();
