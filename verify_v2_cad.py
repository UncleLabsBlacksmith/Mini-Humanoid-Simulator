"""Reopen the saved CAD and exercise each revolute joint independently."""
from pathlib import Path
import json, subprocess
root=Path(__file__).resolve().parent.parent/'MiniHumanoid_V2'
manifest=json.loads((root/'design_manifest.json').read_text(encoding='utf-8'))
commands=[{'command':'document.inspect','params':{'measure':True}}]
for j in manifest['robot']['joints']:
    commands.extend([{'command':'joint.drive','params':{'joint':j['name'],'value':5}},
                     {'command':'joint.solve','params':{}}, {'command':'component.list','params':{}},
                     {'command':'joint.drive','params':{'joint':j['name'],'value':0}}])
commands.append({'command':'joint.solve','params':{}})
(root/'verification_commands.json').write_text(json.dumps(commands,indent=2))
result=subprocess.run([r'C:\Program Files\SolidCraft\solidcraft-cli.exe','run',str(root/'verification_commands.json'),'--in',str(root/'ASTRA_V2_298_Concept.solidcraft'),'--results'],capture_output=True,text=True,encoding='utf-8',check=True)
(root/'verification_results.json').write_text(result.stdout,encoding='utf-8')
results=json.loads(result.stdout);build=json.loads((root/'build_results.json').read_text(encoding='utf-8-sig'))
expected={b['name']:b['bbox'] for b in build[-2]['bodies']}
delta=max(abs(b['bbox'][side][i]-expected[b['name']][side][i]) for b in results[0]['bodies'] for side in ['min','max'] for i in range(3))
assert delta<.001
checks=[]
for k,j in enumerate(manifest['robot']['joints']):
    solve=results[2+k*4];assert not solve.get('errors') and not solve.get('conflicts'),solve
    children=[o for c in results[3+k*4]['components'] for o in c.get('children',[]) if o['name']==j['b']+':1']
    T=children[0]['transform'];motion=max(abs(T[r][c]-(1 if r==c else 0)) for r in range(4) for c in range(4))
    assert motion>.001,j['name']
    checks.append({'joint':j['name'],'angle_deg':5,'child_moves':True,'solver_errors':[]})
report={'joints':len(checks),'links':len(manifest['robot']['links']),'reload_bbox_difference_mm':delta,'independent_motion_checks':checks,'neutral_envelope':json.loads((root/'envelope-check.json').read_text()),'scope':'Concept assembly and independent 5 degree motion; not a full-range clearance or strength certification.'}
(root/'verification_report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'joints_verified':len(checks),'reload_bbox_difference_mm':delta}))
