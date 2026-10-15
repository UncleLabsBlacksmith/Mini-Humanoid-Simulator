import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../static/vendor/three.module.js';
import {sample} from '../static/motion.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const robot=read('static/robot.json'),walk=read('data/programs/example-walk.json');
function fk(pose){
  const links={Torso:new THREE.Group()},pivots={Torso:new THREE.Vector3()};links.Torso.position.set(...pose.root);
  for(const j of robot.joints){const g=new THREE.Group(),p=new THREE.Vector3(...j.p);g.position.copy(p).sub(pivots[j.a]);g.quaternion.setFromAxisAngle(new THREE.Vector3(...j.axis),pose.joints[j.name]*Math.PI/180);links[j.a].add(g);links[j.b]=g;pivots[j.b]=p;}
  links.Torso.updateMatrixWorld(true);
  const feet={};for(const side of ['L','R'])feet[side]=robot.footCorners[side].map(c=>links[side+'_Foot'].localToWorld(new THREE.Vector3(...c).sub(pivots[side+'_Foot'])));
  return {feet,links};
}
const start=sample(walk,0),end=sample(walk,2.4),next=sample(walk,4.8);
for(const k of Object.keys(start.joints))assert.ok(Math.abs(start.joints[k]-end.joints[k])<1e-8);
assert.equal(end.root[1],-32);assert.equal(next.root[1],-64);
assert.ok(Math.abs(sample(walk,2.4-1e-6).root[1]-end.root[1])<.001);
let maxPenetration=0,maxStanceDrift=0,maxLift=0;
for(let i=0;i<=960;i++){
  const time=i/400,pose=sample(walk,time),{feet}=fk(pose);
  for(const side of ['L','R']){
    const phase=time/2.4+(side==='R'?.5:0),q=phase-Math.floor(phase),zs=feet[side].map(p=>p.z);
    maxPenetration=Math.max(maxPenetration,-Math.min(...zs));maxLift=Math.max(maxLift,Math.min(...zs));
    assert.ok(Math.max(...zs)-Math.min(...zs)<1e-6,'sole should remain flat');
    if(q<.5){const expected=-54-(8+32*Math.floor(phase)-(side==='R'?16:0));maxStanceDrift=Math.max(maxStanceDrift,Math.abs(feet[side][0].y-expected));}
  }
}
assert.ok(maxPenetration<.02,`penetration ${maxPenetration}`);
assert.ok(maxStanceDrift<.02,`stance drift ${maxStanceDrift}`);
assert.ok(maxLift>2.9);
const neutral=read('data/programs/example-blank.json');assert.equal(sample(neutral,99).t,1);
const zero=fk(neutral.frames[0]);assert.equal(zero.feet.L[0].z,0);
const moved=structuredClone(neutral.frames[0]);moved.joints.L_KneePitch=30;const bent=fk(moved);
assert.ok(bent.feet.L[0].distanceTo(zero.feet.L[0])>10);assert.ok(bent.feet.R[0].distanceTo(zero.feet.R[0])<1e-9);
console.log(JSON.stringify({checks:'loop continuity, limits via API, flat soles, stance stability, swing lift, link hierarchy',maxPenetration_mm:maxPenetration,maxStanceDrift_mm:maxStanceDrift,maxLift_mm:maxLift},null,2));
