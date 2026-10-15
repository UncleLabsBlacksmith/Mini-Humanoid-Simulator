export const modelId=new URLSearchParams(location.search).get('model')||'astra-v1';
export function modelApi(url){
  if(!url.startsWith('/api/'))return url;
  const u=new URL(url,location.origin);u.searchParams.set('model',modelId);return u.pathname+u.search;
}
export async function setupModels(){
  const response=await fetch('/api/models');if(!response.ok)throw Error('โหลดรายการโมเดลไม่ได้');
  const models=await response.json(),selected=models.find(m=>m.id===modelId);
  if(!selected)throw Error('ไม่พบรุ่นหุ่นยนต์: '+modelId);
  const select=document.getElementById('robot-model');
  for(const m of models){const option=document.createElement('option');option.value=m.id;option.textContent=m.name;select.append(option);}
  select.value=modelId;select.disabled=false;
  select.onchange=()=>{const u=new URL(location.href);u.searchParams.set('model',select.value);location.assign(u.href);};
  document.getElementById('model-info').textContent=`${selected.height} mm · ${selected.jointCount} แกน · โปรแกรมแยกตามรุ่น`;
  const badge=document.getElementById('model-badge');if(badge)badge.textContent=`${selected.height} mm / ${selected.jointCount} DOF`;
  for(const a of document.querySelectorAll('a[href="/"],a[href="/physics"]'))a.href=a.getAttribute('href')+'?model='+modelId;
  return selected;
}
