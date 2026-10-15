"""Generate a short-stride kinematic running loop for the existing 12-axis robot."""
import json
import math
from pathlib import Path
from app import validate_program

ROOT = Path(__file__).resolve().parent
robot = json.loads((ROOT / 'static/robot.json').read_text(encoding='utf-8'))
period, stride, stance = 0.85, 44.0, 0.36
frames = []
for i in range(201):
    p = i / 200
    forward = stride * p
    root_z = -2.5 + 2 * math.sin(2 * math.pi * (p - stance / 2)) ** 2
    angles = {j['name']: 0.0 for j in robot['joints']}
    for side, shift in [('L', 0.0), ('R', 0.5)]:
        phase = p + shift
        cycle, q = math.floor(phase), phase % 1
        foot = stride * (stance / 2 + cycle - shift)
        lift = 0.0
        if q > stance:
            u = (q - stance) / (1 - stance)
            foot += stride * u * u * (3 - 2 * u)
            lift = 4 * math.sin(math.pi * u) ** 2
        dy, down = forward - foot, 126 + root_z - lift
        cosine = (dy * dy + down * down - 2 * 63 ** 2) / (2 * 63 ** 2)
        if not -1 <= cosine <= 1:
            raise ValueError('Foot target lies outside leg reach')
        beta = math.acos(cosine)
        alpha = math.atan2(dy, down) - beta / 2
        angles.update({
            side + '_HipPitch': -math.degrees(alpha),
            side + '_KneePitch': math.degrees(beta),
            side + '_AnklePitch': math.degrees(alpha + beta),
            side + '_ShoulderPitch': 26 * math.sin(2 * math.pi * phase),
            side + '_ElbowPitch': 45 + 8 * math.cos(2 * math.pi * phase),
        })
    frames.append({'t': round(p * period, 6),
                   'joints': {k: round(v, 6) for k, v in angles.items()},
                   'root': [0.0, round(-forward, 6), round(root_z, 6)]})

program = validate_program({
    'version': 1,
    'name': 'วิ่งก้าวสั้น',
    'description': 'วิ่งสลับขาและแกว่งแขน 44 มม. ต่อรอบ 0.85 วินาที ยกเท้าสูงสุด 4 มม. มีช่วงเท้าทั้งสองลอยจากพื้น 2 ครั้งต่อรอบ · เป็น kinematic simulation ไม่ใช่โปรแกรมควบคุมหุ่นจริง',
    'loop': True,
    'interpolation': 'linear',
    'frames': frames,
}, robot)
path = ROOT / 'data/programs/example-run.json'
path.write_text(json.dumps(program, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Created {path.name}: {len(frames)} keyframes, {period} s, {stride} mm/cycle')
