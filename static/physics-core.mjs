import * as THREE from './vendor/three.module.js';
import RAPIER from './vendor/rapier.mjs';
import {sample} from './motion.mjs';
import {UpperBodyVerticalController} from './uvc.mjs';
import {StepObserver} from './step-observer.mjs';

export const DT = 1 / 240;
export const defaults = {gravity:9.81, friction:.8, torque:1.2, speed:300, kp:6, kd:.08,
  playback:1, duration:10, settle:1, batteryMass:.18, batteryX:0, batteryY:42, batteryZ:232,
  tilt:0, selfCollision:true, motors:true, uvc:false, uvcPitch:3, uvcRoll:0, uvcLimit:8, masses:{}};
let initialized;
export function initPhysics(){return initialized ||= RAPIER.init();}
const V=a=>new THREE.Vector3(...a);
const Q=q=>new THREE.Quaternion(q.x,q.y,q.z,q.w);
const vector=v=>new THREE.Vector3(v.x,v.y,v.z);
const rad=Math.PI/180;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

export function hull(points){
  const ps=points.map(p=>({x:p.x,y:p.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[],upper=[];
  for(const p of ps){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of ps.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function supportMargin(com,polygon){
  if(polygon.length<3)return null;
  return Math.min(...polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y;return (dx*(com.y-a.y)-dy*(com.x-a.x))/Math.hypot(dx,dy);}));
}

export class PhysicsSimulation {
  constructor(robot,model,program,settings={}){
    this.robot=robot;this.model=model;this.program=structuredClone(program);
    this.settings={...defaults,...settings,masses:{...settings.masses}};
    this.controller=new UpperBodyVerticalController(robot.joints);
    this.stepObserver=new StepObserver();
    this.time=0;this.steps=0;this.fall=null;this.tiltTime=0;this.trace=[];this.pushes=[];this.maxTilt=0;this.maxError=0;
    this.world=new RAPIER.World({x:0,y:0,z:-this.settings.gravity});this.world.timestep=DT;
    const ip=this.world.integrationParameters;ip.numSolverIterations=12;ip.numInternalPgsIterations=2;
    ip.normalizedAllowedLinearError=.00005;ip.normalizedPredictionDistance=.001;ip.maxCcdSubsteps=4;
    this.bodies={};this.colliders={};this.joints={};this.targets={};this.pivots={Torso:new THREE.Vector3()};
    const groups={Torso:new THREE.Group()};
    for(const j of robot.joints){const g=new THREE.Group(),p=V(j.p).multiplyScalar(.001);g.position.copy(p).sub(this.pivots[j.a]);g.quaternion.setFromAxisAngle(V(j.axis),program.frames[0].joints[j.name]*rad);groups[j.a].add(g);groups[j.b]=g;this.pivots[j.b]=p;this.targets[j.name]=program.frames[0].joints[j.name]*rad;}
    // Root JSON translations never drive the physical robot. Only the initial joint pose is used.
    groups.Torso.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),this.settings.tilt*rad);
    groups.Torso.updateMatrixWorld(true);
    const transforms={};for(const [name,g]of Object.entries(groups))transforms[name]={p:g.getWorldPosition(new THREE.Vector3()),q:g.getWorldQuaternion(new THREE.Quaternion())};
    let minZ=Infinity;
    for(const link of model.links)for(const s of link.shapes)for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      const point=V(s.center).add(V([x*s.half[0],y*s.half[1],z*s.half[2]])).sub(this.pivots[link.name]).applyQuaternion(transforms[link.name].q).add(transforms[link.name].p);minZ=Math.min(minZ,point.z);
    }
    if(this.settings.batteryMass>0)for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      const s=this.settings,h=model.battery.half;
      const point=V([s.batteryX/1000+x*h[0],s.batteryY/1000+y*h[1],s.batteryZ/1000+z*h[2]]).applyQuaternion(transforms.Torso.q).add(transforms.Torso.p);
      minZ=Math.min(minZ,point.z);
    }
    const lift=-minZ+.0003;
    this.ground=this.world.createCollider(RAPIER.ColliderDesc.cuboid(10,10,.05).setTranslation(0,0,-.05).setFriction(this.settings.friction).setRestitution(0).setCollisionGroups(0x00010002));
    for(const link of model.links){
      const transform=transforms[link.name];transform.p.z+=lift;
      const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...transform.p.toArray()).setRotation(transform.q).setCanSleep(false).setCcdEnabled(true));
      this.bodies[link.name]=body;this.colliders[link.name]=[];
      const mass=this.settings.masses[link.name]??link.mass;
      for(const shape of link.shapes){const center=V(shape.center).sub(this.pivots[link.name]);const desc=RAPIER.ColliderDesc.cuboid(...shape.half).setTranslation(...center.toArray()).setMass(mass*shape.massFraction).setFriction(this.settings.friction).setRestitution(0).setCollisionGroups(this.settings.selfCollision?0x00020003:0x00020001);this.colliders[link.name].push(this.world.createCollider(desc,body));}
    }
    const s=this.settings;
    if(s.batteryMass>0){const desc=RAPIER.ColliderDesc.cuboid(...model.battery.half).setTranslation(s.batteryX/1000,s.batteryY/1000,s.batteryZ/1000).setMass(s.batteryMass).setFriction(s.friction).setRestitution(0).setCollisionGroups(s.selfCollision?0x00020003:0x00020001);this.colliders.Torso.push(this.world.createCollider(desc,this.bodies.Torso));}
    for(const j of robot.joints){const anchor=V(j.p).multiplyScalar(.001);const data=RAPIER.JointData.revolute(anchor.clone().sub(this.pivots[j.a]),anchor.clone().sub(this.pivots[j.b]),V(j.axis));const joint=this.world.createImpulseJoint(data,this.bodies[j.a],this.bodies[j.b],true);joint.setContactsEnabled(false);joint.setLimits(j.limits[0]*rad,j.limits[1]*rad);joint.configureMotorModel(RAPIER.MotorModel.ForceBased);joint.setMotorMaxForce(s.motors?s.torque:0);this.joints[j.name]=joint;}
    this.mass=Object.values(this.bodies).reduce((sum,b)=>sum+b.mass(),0);
    this.start=vector(this.bodies.Torso.worldCom());this.metrics=this.measure();
  }
  angle(j){const qa=Q(this.bodies[j.a].rotation()),qb=Q(this.bodies[j.b].rotation());const relative=qa.invert().multiply(qb);return wrap(2*Math.atan2(relative.x*j.axis[0]+relative.y*j.axis[1]+relative.z*j.axis[2],relative.w));}
  step(){
    const s=this.settings;const motionTime=Math.max(0,this.time-s.settle)*s.playback;
    const desired=sample(this.program,motionTime);
    const goals=s.uvc?this.controller.update(desired.joints,this.bodies.Torso.rotation(),this.metrics.forces,s,DT,s.motors&&!this.fall):desired.joints;
    for(const j of this.robot.joints){
      const angle=this.angle(j),old=this.targets[j.name],goal=goals[j.name]*rad;
      const target=old+THREE.MathUtils.clamp(goal-old,-s.speed*rad*DT,s.speed*rad*DT);this.targets[j.name]=target;
      const axis=V(j.axis).applyQuaternion(Q(this.bodies[j.a].rotation()));
      const omega=vector(this.bodies[j.b].angvel()).sub(vector(this.bodies[j.a].angvel())).dot(axis);
      // Approximate linear torque-speed envelope; braking can use the configured torque cap.
      const driving=(target-angle)*omega>0;
      const cap=s.motors?s.torque*(driving?Math.max(0,1-Math.abs(omega)/(s.speed*rad)):1):0;
      this.joints[j.name].setMotorMaxForce(cap);
      this.joints[j.name].configureMotorPosition(target,s.kp,s.kd);
    }
    this.world.step();this.steps++;this.time=this.steps*DT;
    this.metrics=this.measure();this.maxTilt=Math.max(this.maxTilt,this.metrics.tilt);this.maxError=Math.max(this.maxError,this.metrics.maxJointError);
    if(!Number.isFinite(this.metrics.com.z)||Object.values(this.bodies).some(b=>!Number.isFinite(b.translation().z)))throw Error('Physics solver produced a non-finite state');
    this.tiltTime=this.metrics.tilt>50?this.tiltTime+DT:0;
    const hit=this.metrics.bodyGround;
    if(!this.fall&&(hit.length||this.tiltTime>.15))this.fall={time:this.time,reason:hit.length?'body_ground_contact':'tilt_over_50_degrees_for_150ms',links:hit};
    this.metrics.fall=this.fall;
    for(const side of ['L','R']){
      const name=side+'_Foot',body=this.bodies[name],pos=vector(body.translation()),rotation=Q(body.rotation());
      const clearance=Math.min(...this.robot.footCorners[side].map(c=>V(c).multiplyScalar(.001).sub(this.pivots[name]).applyQuaternion(rotation).add(pos).z));
      this.stepObserver.update(side,{y:pos.y,clearance,force:this.metrics.forces[side]},DT,this.time>this.settings.settle&&!this.fall&&this.metrics.tilt<35);
    }
    this.metrics.gait=this.stepObserver.snapshot();
    if(this.steps%24===0)this.trace.push(this.snapshot());
    return this.metrics;
  }
  measure(){
    let mass=0;const com=new THREE.Vector3();for(const b of Object.values(this.bodies)){mass+=b.mass();com.addScaledVector(vector(b.worldCom()),b.mass());}com.divideScalar(mass);
    const up=new THREE.Vector3(0,0,1).applyQuaternion(Q(this.bodies.Torso.rotation()));const tilt=Math.acos(THREE.MathUtils.clamp(up.z,-1,1))/rad;
    const forces={L:0,R:0},contacts=[],bodyGround=[];
    for(const [link,colliders]of Object.entries(this.colliders)){
      let impulse=0;const points=[];
      for(const col of colliders)this.world.contactPair(col,this.ground,m=>{let localImpulse=0;for(let i=0;i<m.numContacts();i++)localImpulse+=m.contactImpulse(i);impulse+=localImpulse;if(localImpulse>1e-8)for(let i=0;i<m.numSolverContacts();i++){const p=m.solverContactPoint(i);if(p)points.push(p);}});
      if(link==='L_Foot'||link==='R_Foot'){forces[link[0]]=impulse/DT;if(impulse>1e-8)contacts.push(...points);}
      else if(impulse/DT>.01)bodyGround.push(link);
    }
    const support=hull(contacts),margin=supportMargin(com,support);
    const errors=this.robot.joints.map(j=>({name:j.name,angle:this.angle(j)/rad,target:this.targets[j.name]/rad}));
    const maxJointError=Math.max(...errors.map(j=>Math.abs(j.target-j.angle)));
    return {time:this.time,com:com.toArray().reduce((o,v,i)=>(o[['x','y','z'][i]]=v,o),{}),tilt,forces,support,margin,
      displacement:-(this.bodies.Torso.worldCom().y-this.start.y),bodyGround,maxJointError,errors,fall:this.fall};
  }
  push(impulse=.08,direction='forward'){
    const v=direction==='side'?{x:impulse,y:0,z:0}:{x:0,y:-impulse,z:0};
    this.bodies.Torso.applyImpulse(v,true);this.pushes.push({time:this.time,impulse_Ns:v});
  }
  snapshot(){const {time,com,tilt,forces,margin,displacement,maxJointError,gait}=this.metrics;return {time,com,tilt,forces,margin,displacement,maxJointError,gait,...(this.settings.uvc?{uvc:structuredClone(this.controller.state)}:{})};}
  report(){return {schema:'astra-physics-report-v1',robot:{id:this.robot.id||'astra-v1',name:this.robot.name,height_mm:this.robot.height,joints:this.robot.joints.length,links:this.robot.links.length},engine:'Rapier 0.21.0',dt:DT,settings:structuredClone(this.settings),program:this.program,
    collisionAndMassModel:this.model,jointDefinitions:this.robot.joints,solver:{iterations:12,internalPgsIterations:2,allowedLinearError_m:.00005,predictionDistance_m:.001,ccdSubsteps:4},
    mass_kg:this.mass,elapsed_s:this.time,fall:this.fall,maximumTilt_deg:this.maxTilt,maximumJointError_deg:this.maxError,pushes:this.pushes,
    result:this.fall?'fallen_in_simulation':this.time>=this.settings.duration?'no_fall_observed_in_test':'incomplete',
    assumptions:this.model.assumptions,rootMotionIgnored:true,gait:this.stepObserver.snapshot(),stepDefinition:{soleClearance_m:.002,minimumAirTime_s:.05,forwardLanding_m:.003,contactForce_N:.5},feedbackBalanceController:this.settings.uvc?'UVC-inspired hip integral v1':false,
    ...(this.settings.uvc?{controllerSource:'https://ai2001.ifdef.jp/uvc/QandA_Eng.html',controllerState:structuredClone(this.controller.state)}:{}),trace:this.trace};}
  dispose(){this.world.free();}
}
