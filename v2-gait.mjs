import fs from 'node:fs';
const robot=JSON.parse(fs.readFileSync(new URL('./static/models/astra-v2/robot.json',import.meta.url),'utf8'));
export const v2Base={stride:20,period:.5,duty:.6,lift:8,down:128,roll:4,rollPhase:.5,ankleRollRatio:1,lean:1,hipBias:0};
export function makeV2(params={}){
  const p={...v2Base,...params},frames=[];
  for(let i=0;i<=160;i++){
    const phase=i/160,angles=Object.fromEntries(robot.joints.map(j=>[j.name,0]));
    const roll=p.roll*Math.sin(2*Math.PI*(phase+p.rollPhase));
    for(const [side,shift] of [['L',0],['R',.5]]){
      const full=phase+shift,q=full%1,k=Math.floor(full);
      let foot=p.stride*(p.duty/2+k-shift),lift=0;
      if(q>p.duty){const u=(q-p.duty)/(1-p.duty);foot+=p.stride*u*u*(3-2*u);lift=p.lift*Math.sin(Math.PI*u)**2;}
      const dy=p.stride*phase-foot,down=p.down-lift,cos=(dy*dy+down*down-2*65*65)/(2*65*65);
      if(cos>1||cos< -1)throw Error('Leg target exceeds reach');
      const beta=Math.acos(cos),alpha=Math.atan2(dy,down)-beta/2;
      angles[side+'_HipPitch']=-alpha*180/Math.PI+p.hipBias;
      angles[side+'_KneePitch']=beta*180/Math.PI;
      angles[side+'_AnklePitch']=(alpha+beta)*180/Math.PI+p.lean;
      angles[side+'_Hip_Roll']=roll;angles[side+'_AnkleRoll']=roll*p.ankleRollRatio;
      angles[side+'_ShoulderPitch']=8*Math.sin(2*Math.PI*full);
      angles[side+'_ShoulderRoll']=8;angles[side+'_ElbowPitch']=20;
    }
    for(const j of robot.joints)if(angles[j.name]<j.limits[0]||angles[j.name]>j.limits[1])throw Error('Angle exceeds limits: '+j.name);
    frames.push({t:i/160*p.period,joints:angles,root:[0,-p.stride*phase,p.down-130]});
  }
  return {version:1,modelId:'astra-v2',name:'V2 · ท่าเดินจากพารามิเตอร์',description:'ท่า IK ของ ASTRA V2 16 แกน ต้องทดสอบ Physics ใหม่เมื่อเปลี่ยนพารามิเตอร์',loop:true,interpolation:'linear',frames};
}
if(process.argv[1]?.endsWith('v2-gait.mjs')){
  const folder=new URL('./data/programs/astra-v2/',import.meta.url);
  const neutral=Object.fromEntries(robot.joints.map(j=>[j.name,0]));
  const save=(id,p)=>fs.writeFileSync(new URL(id+'.json',folder),JSON.stringify(p,null,2));
  const walk=makeV2();walk.name='V2 · เดินหน้าสลับเท้า + UVC';walk.description='ASTRA V2 16 แกน · รอบ 0.5 s · ใช้ค่าฟิสิกส์ตั้งต้นและ UVC หน้า–หลัง 3 / ด้านข้าง 0 / จำกัด 8° · ทดสอบ 60 s เดินหน้า 1.999 m ยังไม่พบการล้มในแบบจำลองนี้ ผลจริงต้องสอบเทียบ';save('example-walk',walk);
  save('example-blank',{version:1,modelId:'astra-v2',name:'V2 · ยืนตรง / โปรแกรมใหม่',description:'ท่ายืนตรงของหุ่น 16 แกน',loop:false,interpolation:'smooth',frames:[{t:0,joints:neutral,root:[0,0,0]},{t:2,joints:neutral,root:[0,0,0]}]});
  const sway=makeV2({stride:0,lift:0,roll:5,rollPhase:0,period:4,lean:0});sway.name='V2 · โยกตัวและชดเชยข้อเท้า';sway.description='สาธิต hip roll และ ankle roll สวนแกนกัน รอบ 4 s ไม่มีเป้าหมายเดินหน้า';save('example-sway',sway);
}
