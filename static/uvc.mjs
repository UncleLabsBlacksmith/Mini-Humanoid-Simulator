// Independent UVC-inspired adaptation. See README: this is not Dr. Guero's full gait/CPG.
// Joint angles and integral corrections are degrees; gains have units 1/s.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class UpperBodyVerticalController {
  constructor(joints){
    this.joints=joints.filter(j=>/_Hip(Pitch|_Roll)$/.test(j.name));
    this.offsets=Object.fromEntries(this.joints.map(j=>[j.name,0]));
    this.state={active:false,pitch:0,roll:0,weights:{L:0,R:0},offsets:{...this.offsets},saturated:[]};
  }
  update(base,orientation,forces,settings,dt,enabled=true){
    // World vertical expressed in torso coordinates: invariant to heading (yaw).
    const {x,y,z,w}=orientation;
    const up={x:2*(x*z-w*y),y:2*(y*z+w*x),z:1-2*(x*x+y*y)};
    const pitch=Math.atan2(up.y,up.z)*180/Math.PI;
    const roll=-Math.atan2(up.x,up.z)*180/Math.PI;
    const total=forces.L+forces.R;
    const active=enabled&&total>2&&up.z>Math.cos(45*Math.PI/180);
    const weights=active?{L:forces.L/total,R:forces.R/total}:{L:0,R:0};
    const result={...base},saturated=[];
    for(const j of this.joints){
      const weight=weights[j.name[0]],isPitch=j.name.endsWith('Pitch');
      // Hip axes have the opposite sign to the torso's return-to-vertical rotation.
      let offset=this.offsets[j.name];
      if(active){
        offset-=(isPitch?settings.uvcPitch:settings.uvcRoll)*(isPitch?pitch:roll)*weight*dt;
        // Relax an unloaded leg, preventing stored corrections from driving its swing.
        if(weight<.05)offset*=Math.exp(-dt/.3);
      }
      const lower=Math.max(-settings.uvcLimit,j.limits[0]-base[j.name]);
      const upper=Math.min(settings.uvcLimit,j.limits[1]-base[j.name]);
      const bounded=clamp(offset,lower,upper);
      if(Math.abs(offset-bounded)>1e-9)saturated.push(j.name);
      // Project the integrator itself into available joint range (anti-windup).
      this.offsets[j.name]=bounded;
      if(enabled)result[j.name]=clamp(base[j.name]+bounded,...j.limits);
    }
    this.state={active,pitch,roll,weights,offsets:{...this.offsets},saturated};
    return result;
  }
}
