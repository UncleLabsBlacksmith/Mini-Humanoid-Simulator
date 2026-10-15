export const clone = value => JSON.parse(JSON.stringify(value));
export function sample(program, elapsed) {
  const frames=program.frames, duration=frames.at(-1).t;
  const cycles=program.loop ? Math.floor(Math.max(0,elapsed)/duration) : 0;
  const t=program.loop ? Math.max(0,elapsed)%duration : Math.max(0,Math.min(elapsed,duration));
  let i=0; while(i<frames.length-2 && frames[i+1].t<t) i++;
  const a=frames[i],b=frames[i+1];let u=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));
  if(program.interpolation==='smooth')u=u*u*(3-2*u);
  const joints=Object.fromEntries(Object.keys(a.joints).map(k=>[k,a.joints[k]+(b.joints[k]-a.joints[k])*u]));
  const root=a.root.map((v,j)=>v+(b.root[j]-v)*u+cycles*(frames.at(-1).root[j]-frames[0].root[j]));
  return {joints,root,t,cycles};
}
