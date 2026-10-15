import fs from 'node:fs';
import assert from 'node:assert/strict';
import {evaluateV2} from './v2-validate.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const program=read('data/programs/astra-v2/example-walk.json');
const rows=[];
for(const [label,p,seconds] of [['standing',read('data/programs/astra-v2/example-blank.json'),10],['walking-10s',program,10],['walking-60s',program,60]]){
  const r=evaluateV2(p,seconds);rows.push({label,...r});assert.equal(r.fall,null,label);
  if(label==='walking-60s'){assert.ok(r.distance>1.5);assert.ok(r.steps.L.steps>90&&r.steps.R.steps>90);assert.ok(Math.abs(r.steps.L.steps-r.steps.R.steps)<10);}
  const {report,...summary}=r;console.log(label,JSON.stringify(summary));
}
fs.writeFileSync('data/v2-release-validation.json',JSON.stringify(rows,null,2));
