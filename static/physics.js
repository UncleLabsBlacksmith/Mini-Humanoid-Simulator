import {setupModels,modelApi} from './model-selection.mjs';
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {PhysicsSimulation,initPhysics,DT,defaults} from './physics-core.mjs';

const $=id=>document.getElementById(id);
const fields=['duration','playback','friction','gravity','torque','speed','kp','kd','batteryMass','batteryX','batteryY','batteryZ','settle','tilt','uvcPitch','uvcRoll','uvcLimit'];
let selectedModel,robot,model,program,sim,scene,renderer,camera,controls,light,grid,floor,battery,debugLines,comBall,projection,comLine,supportLine;
let running=false,pending=false,busy=false,accumulator=0,lastUI=0,lastTarget=new THREE.Vector3(),toastTimer,requestVersion=0;
let trail,startMarker,trailCount=-1;
const visualLinks={},readouts={};
function toast(msg,error=false){$('toast').textContent=msg;$('toast').className='show'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').className='',4500);}
async function api(url,body){const res=await fetch(modelApi(url),body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||'โหลดข้อมูลไม่ได้');return data;}
function guard(fn){return async(...a)=>{try{await fn(...a);}catch(e){toast(e.message,true);console.error(e);}};}
function pause(){running=false;if(sim)$('play').textContent=sim.time?'▶ เล่นต่อ':'▶ เริ่มทดสอบ';}
function readSettings(){const settings={};for(const id of fields){const input=$(id);if(!input.checkValidity()||input.value==='')throw Error('ตรวจค่าที่กรอก: '+input.parentElement.textContent);settings[id]=Number(input.value);}settings.selfCollision=$('selfCollision').checked;settings.motors=$('motors').checked;settings.uvc=$('uvc').checked;settings.masses={};for(const l of model.links){const input=$('mass-'+l.name);if(!input.checkValidity()||input.value==='')throw Error('มวล '+l.name+' ต้องอยู่ในช่วง 0.005–5 kg');settings.masses[l.name]=Number(input.value);}return settings;}
function updateMass(){let mass=Number($('batteryMass').value)||0;for(const l of model.links)mass+=Number($('mass-'+l.name).value)||0;$('mass-total').textContent=mass.toFixed(3)+' kg';}
function changed(){pending=true;pause();$('pending').textContent='ค่าที่กรอกเปลี่ยนแล้ว → กดใช้ค่าที่ตั้งและเริ่มใหม่';$('pending').classList.add('changed');for(const id of ['play','step','push-forward','push-side'])$(id).disabled=true;updateMass();}
function makeControls(){for(const link of model.links){const row=document.createElement('label');row.className='mass-entry';row.textContent=link.name+' (kg)';const input=document.createElement('input');Object.assign(input,{id:'mass-'+link.name,type:'number',min:'.005',max:'5',step:'any',value:String(link.mass)});input.oninput=changed;row.append(input);$('masses').append(row);}for(const j of robot.joints){const row=document.createElement('div');row.className='angle-readout';const name=document.createElement('span');name.textContent=j.label;const value=document.createElement('b');row.append(name,value);$('joint-readings').append(row);readouts[j.name]=value;}updateMass();}
function initScene(meshes){
  scene=new THREE.Scene();scene.fog=new THREE.Fog(0x101a29,1.8,8);camera=new THREE.PerspectiveCamera(38,1,.005,30);camera.up.set(0,0,1);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;$('viewport').prepend(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.25;controls.maxDistance=3;controls.maxPolarAngle=Math.PI*.86;
  scene.add(new THREE.HemisphereLight(0xd1e5ff,0x40546e,2.3));light=new THREE.DirectionalLight(0xfff5e8,3);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-.7,right:.7,top:.7,bottom:-.7,near:.01,far:3});light.shadow.bias=-.00015;scene.add(light,light.target);
  floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0x142031,roughness:.98}));floor.position.z=-.0002;floor.receiveShadow=true;scene.add(floor);
  grid=new THREE.GridHelper(8,160,0x52738d,0x263e53);grid.rotation.x=Math.PI/2;grid.position.z=.0002;grid.material.transparent=true;grid.material.opacity=.5;scene.add(grid);
  trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffce73,depthTest:false}));trail.renderOrder=4;scene.add(trail);
  startMarker=new THREE.Group();scene.add(startMarker);
  const originLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.23,0,.002),new THREE.Vector3(.23,0,.002)]),new THREE.LineBasicMaterial({color:0xffce73}));startMarker.add(originLine);
  startMarker.add(new THREE.ArrowHelper(new THREE.Vector3(0,-1,0),new THREE.Vector3(.21,0,.003),.24,0xffce73,.035,.018));
  for(let i=0;i<=6;i++){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffd78a';ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.fillText(i?`${i*10} cm`:'START',128,43);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));sprite.scale.set(.095,.024,1);sprite.position.set(.24,-i*.1,.014);startMarker.add(sprite);
  }
  const pivots={Torso:[0,0,0]};for(const j of robot.joints)pivots[j.b]=j.p;
  for(const name of robot.links){const g=new THREE.Group();visualLinks[name]=g;scene.add(g);}
  for(const item of meshes){const positions=new Float32Array(item.positions),pivot=pivots[item.link];for(let i=0;i<positions.length;i++)positions[i]=(positions[i]-pivot[i%3])*.001;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(item.indices);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:item.color,roughness:.54,metalness:.3}));mesh.castShadow=true;mesh.receiveShadow=true;visualLinks[item.link].add(mesh);}
  battery=new THREE.Mesh(new THREE.BoxGeometry(...model.battery.half.map(x=>x*2)),new THREE.MeshStandardMaterial({color:0x6979a3,roughness:.7}));battery.castShadow=true;visualLinks.Torso.add(battery);
  comBall=new THREE.Mesh(new THREE.SphereGeometry(.004,12,8),new THREE.MeshBasicMaterial({color:0xffd879,depthTest:false}));comBall.renderOrder=3;
  projection=new THREE.Mesh(new THREE.RingGeometry(.003,.005,24),new THREE.MeshBasicMaterial({color:0xffd879,side:THREE.DoubleSide,depthTest:false}));projection.renderOrder=3;
  comLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffd879,transparent:true,opacity:.6,depthTest:false}));
  supportLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x68e0be,depthTest:false}));supportLine.renderOrder=3;
  debugLines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({vertexColors:true,depthTest:false,transparent:true,opacity:.65}));debugLines.visible=false;
  scene.add(comBall,projection,comLine,supportLine,debugLines);
  const resize=()=>{const w=$('viewport').clientWidth,h=$('viewport').clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe($('viewport'));resize();view('iso');
}
function view(which){const center=sim?new THREE.Vector3(sim.metrics.com.x,sim.metrics.com.y,.15):new THREE.Vector3(0,0,.15);if(which==='iso')center.y-=.2;const routeLength=sim?Math.hypot(sim.metrics.com.x-sim.start.x,sim.metrics.com.y-sim.start.y):0;if(which==='route'&&sim)center.set((sim.start.x+sim.metrics.com.x)/2,(sim.start.y+sim.metrics.com.y)/2,.1);const span=Math.max(1,routeLength+ .5);const offsets={iso:[.7,-1.1,.65],front:[0,-.8,.02],side:[.8,0,.03],route:[.65*span,-.75*span,.9*span]};camera.position.copy(center).add(new THREE.Vector3(...offsets[which]));controls.target.copy(center);lastTarget.copy(center);controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===which));}
function lineGeometry(line,points){line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(points);}
function syncScene(){
  if(!sim)return;for(const [name,body]of Object.entries(sim.bodies)){visualLinks[name].position.copy(body.translation());visualLinks[name].quaternion.copy(body.rotation());}
  const m=sim.metrics,center=new THREE.Vector3(m.com.x,m.com.y,.15),delta=center.clone().sub(lastTarget);if($('follow').checked){camera.position.add(delta);controls.target.add(delta);}lastTarget.copy(center);
  light.position.copy(center).add(new THREE.Vector3(-.4,-.5,.8));light.target.position.copy(center);
  // Keep world references fixed, even when the optional following camera is enabled.
  if(sim.trace.length!==trailCount){trailCount=sim.trace.length;lineGeometry(trail,[new THREE.Vector3(sim.start.x,sim.start.y,.003),...sim.trace.map(p=>new THREE.Vector3(p.com.x,p.com.y,.003))]);}
  comBall.position.set(m.com.x,m.com.y,m.com.z);projection.position.set(m.com.x,m.com.y,.001);const balance=$('balance').checked;
  for(const obj of [comBall,projection,comLine,supportLine])obj.visible=balance;
  lineGeometry(comLine,[comBall.position.clone(),projection.position.clone()]);
  const polygon=m.support.map(p=>new THREE.Vector3(p.x,p.y,.001));if(polygon.length)polygon.push(polygon[0].clone());lineGeometry(supportLine,polygon);
  debugLines.visible=$('debug').checked;if(debugLines.visible){const debug=sim.world.debugRender();debugLines.geometry.dispose();debugLines.geometry=new THREE.BufferGeometry();debugLines.geometry.setAttribute('position',new THREE.BufferAttribute(debug.vertices,3));debugLines.geometry.setAttribute('color',new THREE.BufferAttribute(debug.colors,4));}
}
function reset(){
  const settings=readSettings();const replacement=new PhysicsSimulation(robot,model,program,settings);sim?.dispose();sim=replacement;pause();accumulator=0;pending=false;
  trailCount=-1;startMarker.position.set(sim.start.x,sim.start.y,0);
  $('pending').textContent='ใช้ค่าที่ตั้งแล้ว · มวลและเซอร์โวยังเป็นค่าประมาณ';$('pending').classList.remove('changed');$('mass-used').textContent=sim.mass.toFixed(3)+' kg';
  battery.visible=settings.batteryMass>0;battery.position.set(settings.batteryX/1000,settings.batteryY/1000,settings.batteryZ/1000);
  for(const id of ['play','reset','step','apply','export','push-forward','push-side'])$(id).disabled=false;
  syncScene();view('iso');updateUI();
}
async function loadProgram(id){const version=++requestVersion;busy=true;pause();$('play').disabled=true;try{const data=await api('/api/programs/'+id);if(version!==requestVersion)return;program=data;$('description').textContent=data.description;reset();}finally{if(version===requestVersion)busy=false;}}
function advance(count){for(let i=0;i<count;i++){if(sim.time+DT/2>=sim.settings.duration){pause();break;}sim.step();}if(sim.time+DT/2>=sim.settings.duration)pause();syncScene();}
function updateUI(){
  if(!sim)return;const m=sim.metrics,done=sim.time+DT/2>=sim.settings.duration;
  $('time').textContent=m.time.toFixed(2)+' s';$('lean').textContent=m.tilt.toFixed(1)+'°';$('distance').textContent=(m.displacement*1000).toFixed(1)+' mm';$('com-height').textContent=(m.com.z*1000).toFixed(1)+' mm';
  const gait=sim.stepObserver.snapshot(),steps=gait.L.steps+gait.R.steps;
  $('step-count').textContent=`${steps} (ซ้าย ${gait.L.steps} / ขวา ${gait.R.steps})`;
  $('walking-status').textContent=sim.time<2?'รอตรวจการยกเท้า':steps?`พบก้าวยกเท้าไปข้างหน้า ${steps} ครั้ง`:'ยังไม่พบก้าวยกเท้าไปข้างหน้า · ระยะเคลื่อนอาจมาจากการไถล';
  $('progress').style.width=Math.min(100,sim.time/sim.settings.duration*100)+'%';$('phase').textContent=done?'จบการทดสอบ':sim.time<sim.settings.settle?'ช่วงพักท่าเริ่มต้น':'กำลังใช้โปรแกรมข้อต่อ';
  for(const [side,id]of [['L','left'],['R','right']]){$('force-'+id).textContent=m.forces[side].toFixed(1)+' N';$(id+'-dot').classList.toggle('on',m.forces[side]>.05);}
  $('margin').textContent=m.margin===null?'ไม่มีฐานสัมผัส':(m.margin*1000).toFixed(1)+' mm';$('margin').style.color=m.margin!==null&&m.margin<0?'#ffb795':'#b9d4e6';$('error').textContent=m.maxJointError.toFixed(1)+'°';$('fall-time').textContent=sim.fall?sim.fall.time.toFixed(2)+' s':'ยังไม่พบ';$('live-result').textContent=sim.fall?'ล้มที่ '+sim.fall.time.toFixed(2)+' s':done?'ยังไม่ล้มในช่วงทดสอบ':sim.time?'ทดสอบ '+sim.time.toFixed(1)+' s':'พร้อมทดสอบ';$('live-result').style.color=sim.fall?'#ffb6c3':'#a9d2e8';$('live-result').style.background=sim.fall?'#512538':'#183348';
  if(sim.fall){$('result').className='result fallen';$('result-title').textContent='ล้มในแบบจำลอง';$('result-detail').textContent=sim.fall.reason==='body_ground_contact'?'ลิงก์สัมผัสพื้น: '+sim.fall.links.join(', '):'ลำตัวเอียงเกิน 50° ต่อเนื่องเกิน 0.15 วินาที';}
  else if(done){$('result').className='result done';$('result-title').textContent='ยังไม่ล้มในช่วงทดสอบ';$('result-detail').textContent=`ทดสอบ ${sim.time.toFixed(1)} วินาที ด้วยค่าชุดนี้ ไม่ใช่การรับรองว่าจะไม่ล้มบนหุ่นจริง`;}
  else if(sim.time){$('result').className='result running';$('result-title').textContent=running?'กำลังทดสอบ':'หยุดชั่วคราว';$('result-detail').textContent='ยังไม่พบการล้ม · ต้องดูผลจนครบเวลาที่ตั้ง';}
  else{$('result').className='result ready';$('result-title').textContent='พร้อมทดสอบ';$('result-detail').textContent='กดเริ่มเพื่อปล่อยหุ่นเดินด้วยมอเตอร์';$('phase').textContent='พร้อมเริ่ม';}
  for(const j of m.errors){readouts[j.name].textContent=`${j.target.toFixed(1)} / ${j.angle.toFixed(1)}°`;readouts[j.name].style.color=Math.abs(j.target-j.angle)>5?'#ffbc8c':'#c8dbeb';}
  $('live-controller').textContent=sim.settings.uvc?'UVC เปิด':'UVC ปิด';const u=sim.controller.state;$('uvc-status').textContent=!sim.settings.uvc?'ปิด UVC':!sim.settings.motors?'UVC พัก · มอเตอร์ปิด':sim.fall?'UVC พัก · ตรวจพบล้ม':u.active?(running?'UVC กำลังชดเชยสะโพก':'UVC ค่าชดเชยล่าสุด'):'UVC รอแรงสัมผัสเท้า / ลำตัวเอียงมาก';$('uvc-angles').textContent=sim.settings.uvc?`หน้า ${u.pitch.toFixed(1)}° · ข้าง ${u.roll.toFixed(1)}°`:'—';$('uvc-offsets').textContent=sim.settings.uvc?Object.entries(u.offsets).map(([name,v])=>robot.joints.find(j=>j.name===name).label+': '+v.toFixed(2)+'°').join(' · '):'ยังใช้มุมจาก JSON โดยตรง';$('uvc-limit-status').textContent=u.saturated.length?'ถึงขีดจำกัด: '+u.saturated.join(', '):'';
  if(done)$('play').textContent='▶ ทดสอบอีกครั้ง';drawChart();
}
function drawChart(){const canvas=$('chart'),w=canvas.clientWidth,h=100,dpr=Math.min(devicePixelRatio,2);if(canvas.width!==w*dpr||canvas.height!==h*dpr){canvas.width=w*dpr;canvas.height=h*dpr;}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const x=t=>8+t/sim.settings.duration*(w-16),y=deg=>h-12-deg/180*(h-20);ctx.strokeStyle='#854858';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(8,y(50));ctx.lineTo(w-8,y(50));ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#8ab8ff';ctx.lineWidth=1.6;ctx.beginPath();sim.trace.forEach((p,i)=>{if(i)ctx.lineTo(x(p.time),y(p.tilt));else ctx.moveTo(x(p.time),y(p.tilt));});ctx.stroke();ctx.fillStyle='#6f879f';ctx.font='9px Segoe UI';ctx.fillText('0',8,h-2);ctx.fillText(sim.settings.duration+' s',w-32,h-2);}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function bind(){
  $('uvc-preset').onclick=guard(async()=>{if(busy)return;pause();for(const id of fields)$(id).value=selectedModel.physicsDefaults[id]??defaults[id];$('duration').value=10;$('follow').checked=false;for(const id of ['selfCollision','motors'])$(id).checked=defaults[id];$('uvc').checked=selectedModel.physicsDefaults.uvc;for(const link of model.links)$('mass-'+link.name).value=link.mass;changed();$('programs').value=selectedModel.physicsProgram;await loadProgram(selectedModel.physicsProgram);updateMass();toast('โหลดชุดเดินหน้า + UVC แล้ว · กดเริ่มทดสอบ');});
  for(const id of fields)$(id).oninput=changed;for(const id of ['selfCollision','motors','uvc'])$(id).onchange=changed;
  $('programs').onchange=guard(()=>loadProgram($('programs').value));$('apply').onclick=guard(reset);$('reset').onclick=guard(reset);
  $('play').onclick=guard(()=>{if(busy||pending)return;if(running)pause();else{if(sim.time+DT/2>=sim.settings.duration)reset();running=true;$('play').textContent='Ⅱ หยุด';}updateUI();});
  $('step').onclick=guard(()=>{pause();advance(24);updateUI();});
  for(const [id,direction]of [['push-forward','forward'],['push-side','side']])$(id).onclick=guard(()=>{const input=$('push-force');if(!input.checkValidity()||!input.value)throw Error('อิมพัลส์ต้องอยู่ระหว่าง 0.01–3 N·s');if(sim.time>=sim.settings.duration)throw Error('จบการทดสอบแล้ว กดตั้งใหม่ก่อน');sim.push(Number(input.value),direction);toast('เพิ่มอิมพัลส์แล้ว'+(running?'':' · กดเล่นเพื่อดูผล'));});
  $('debug').onchange=syncScene;$('balance').onchange=syncScene;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
  $('export').onclick=()=>{download(sim.report(),'astra-physics-report.json');toast('ส่งออกรายงาน พร้อมค่าที่ใช้ โปรแกรม และผลตามเวลาแล้ว');};
  $('import').onclick=()=>$('file').click();$('file').onchange=guard(async e=>{const f=e.target.files[0];if(!f)return;if(f.size>2*1024*1024)throw Error('ไฟล์ต้องไม่เกิน 2 MB');pause();program=await api('/api/validate',JSON.parse(await f.text()));$('programs').value='';$('description').textContent=program.name+' · '+program.description;reset();e.target.value='';toast('โหลดโปรแกรมแล้ว');});
}
async function init(){try{
  selectedModel=await setupModels();for(const id of fields)$(id).value=selectedModel.physicsDefaults[id]??defaults[id];$('uvc').checked=selectedModel.physicsDefaults.uvc;const [r,m,meshes,programs]=await Promise.all([api('/api/robot'),api(selectedModel.physicsUrl),api(selectedModel.meshUrl),api('/api/programs'),initPhysics()]);robot=r;model=m;makeControls();initScene(meshes);bind();
  for(const p of programs){const o=document.createElement('option');o.value=p.id;o.textContent=p.id==='example-blank'?'ท่ายืน / ตรวจสมดุล':(p.example?'':'บันทึก · ')+p.name;$('programs').append(o);}$('programs').disabled=false;$('programs').value=selectedModel.physicsProgram;await loadProgram(selectedModel.physicsProgram);$('status').textContent='● Physics พร้อม';$('uvc-preset').disabled=false;$('loading').style.display='none';
  let previous=performance.now();function tick(now){requestAnimationFrame(tick);const delta=Math.min((now-previous)/1000,.1);previous=now;try{if(running){accumulator=Math.min(accumulator+delta*Number($('view-speed').value),.25);let n=0;while(accumulator>=DT&&n<24){accumulator-=DT;n++;}advance(n);}controls.update();renderer.render(scene,camera);if(now-lastUI>100){updateUI();lastUI=now;}}catch(e){pause();$('status').textContent='การคำนวณหยุด';toast(e.message,true);console.error(e);}}requestAnimationFrame(tick);
}catch(e){console.error(e);$('loading').textContent='เปิด Physics ไม่สำเร็จ: '+e.message;$('status').textContent='โหลดไม่สำเร็จ';toast(e.message,true);}}
init();
