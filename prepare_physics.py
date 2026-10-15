"""Build collision/mass estimates from CAD meshes, without changing the motion assets."""
import json
from pathlib import Path

folder = Path(__file__).parent / 'static'
meshes = json.loads((folder / 'meshes.json').read_text(encoding='utf-8'))
robot = json.loads((folder / 'robot.json').read_text(encoding='utf-8'))
base = {'Torso': .34}
base.update({j['b']: (.05 if j['b'].endswith('Foot') else .04 if j['b'].endswith('Forearm') else .085) for j in robot['joints']})
links = []
for name in robot['links']:
    shapes = []
    for mesh in meshes:
        if mesh['link'] != name:
            continue
        a = mesh['positions']
        lo = [min(a[k::3]) / 1000 for k in range(3)]
        hi = [max(a[k::3]) / 1000 for k in range(3)]
        shapes.append({'name': mesh['name'], 'center': [(lo[k]+hi[k])/2 for k in range(3)],
                       'half': [max(.0004, (hi[k]-lo[k])/2) for k in range(3)],
                       'servo': mesh['name'].endswith('Servo_Case')})
    motors = sum(s['servo'] for s in shapes)
    frame_mass = base[name] - .06 * motors
    volume = sum(s['half'][0]*s['half'][1]*s['half'][2] for s in shapes if not s['servo'])
    for s in shapes:
        s['massFraction'] = (.06 if s['servo'] else frame_mass*s['half'][0]*s['half'][1]*s['half'][2]/volume) / base[name]
    links.append({'name': name, 'mass': base[name], 'shapes': shapes})
model = {'version': 1, 'units': 'm, kg, s, N',
         'assumptions': 'Estimated masses; box collision proxies from CAD. Servo case weights are estimates. Battery adds mass to torso. Not hardware calibrated.',
         'links': links, 'battery': {'mass': .18, 'center': [0, .042, .232], 'half': [.018, .009, .025]}}
(folder/'physics-model.json').write_text(json.dumps(model, indent=2), encoding='utf-8')
print('Frame mass:', sum(base.values()), 'kg; proxies:', sum(len(l['shapes']) for l in links))
