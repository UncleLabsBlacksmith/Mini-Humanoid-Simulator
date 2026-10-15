// Counts forward landings only after a sole cleared the ground by 2 mm for 50 ms.
// A displacement alone is not evidence of a step (the foot may be sliding).
export class StepObserver {
  constructor(){this.feet={L:{count:0},R:{count:0}};}
  update(side,{y,clearance,force},dt,enabled){
    const f=this.feet[side];f.clearance=clearance;
    if(!enabled){f.groundedY=undefined;f.takeoffY=undefined;f.air=0;f.lifted=false;return;}
    if(force>.5){
      if(f.lifted&&f.takeoffY!==undefined&&f.takeoffY-y>.003)f.count++;
      f.groundedY=y;f.takeoffY=undefined;f.air=0;f.lifted=false;
    }else{
      if(f.takeoffY===undefined)f.takeoffY=f.groundedY;
      f.air=clearance>.002?(f.air||0)+dt:0;
      if(f.air>=.05&&f.takeoffY!==undefined)f.lifted=true;
    }
  }
  snapshot(){return Object.fromEntries(Object.entries(this.feet).map(([side,f])=>[side,{steps:f.count,clearance:f.clearance??0}]));}
}
