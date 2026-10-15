"""Local Flask API for Uncle Labs Simulator. Motion files contain data, never code."""
from pathlib import Path
import argparse
import json
import math
import os
import re
import tempfile
import uuid
from flask import Flask, jsonify, render_template, request, send_file, abort
from werkzeug.exceptions import HTTPException

ROOT = Path(__file__).resolve().parent
MODELS = {
    'astra-v1': {'id':'astra-v1','name':'ASTRA V1 · 12 แกน','robotUrl':'/static/robot.json','meshUrl':'/static/meshes.json','physicsUrl':'/static/physics-model.json',
                 'studioProgram':'example-walk','physicsProgram':'example-forward-steps','physicsDefaults':{'uvc':True,'uvcPitch':3,'uvcRoll':0,'uvcLimit':8,'batteryMass':.18,'batteryX':0,'batteryY':42,'batteryZ':232}},
    'astra-v2': {'id':'astra-v2','name':'ASTRA V2 · PRIMER-inspired · 16 แกน','robotUrl':'/static/models/astra-v2/robot.json','meshUrl':'/static/models/astra-v2/meshes.json','physicsUrl':'/static/models/astra-v2/physics-model.json',
                 'studioProgram':'example-walk','physicsProgram':'example-walk','physicsDefaults':{'uvc':True,'uvcPitch':3,'uvcRoll':0,'uvcLimit':8,'batteryMass':.15,'batteryX':0,'batteryY':24,'batteryZ':247}},
}

def validate_program(value, robot):
    if not isinstance(value, dict):
        raise ValueError('โปรแกรมต้องเป็น JSON object')
    model_id=robot.get('id','astra-v1')
    if value.get('modelId',model_id)!=model_id:
        raise ValueError('โปรแกรมนี้เป็นของหุ่นคนละรุ่น กรุณาเลือกโมเดลให้ตรงกัน')
    name = value.get('name', '')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise ValueError('ชื่อโปรแกรมต้องยาว 1–100 ตัวอักษร')
    frames = value.get('frames')
    if not isinstance(frames, list) or not 2 <= len(frames) <= 1000:
        raise ValueError('ต้องมี 2–1,000 keyframes')
    limits = {j['name']: j['limits'] for j in robot['joints']}
    clean = []
    previous = -1
    def number(v, label):
        if isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v):
            raise ValueError(label + ' ต้องเป็นตัวเลขที่มีค่าจำกัด')
        return float(v)
    for i, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise ValueError(f'Keyframe {i+1} ไม่ถูกต้อง')
        t = number(frame.get('t'), 'เวลา')
        if (i == 0 and t != 0) or t <= previous or t > 600:
            raise ValueError('เวลาเริ่มต้องเป็น 0 และเพิ่มขึ้นตามลำดับ ไม่เกิน 600 วินาที')
        previous = t
        angles = frame.get('joints')
        if not isinstance(angles, dict) or set(angles) != set(limits):
            raise ValueError(f'Keyframe {i+1} ต้องมีข้อต่อครบ {len(limits)} แกนของ {model_id} และไม่มีชื่อเกิน')
        a = {}
        for key, bounds in limits.items():
            angle = number(angles[key], key)
            if not bounds[0] - 1e-6 <= angle <= bounds[1] + 1e-6:
                raise ValueError(f'{key}: มุมต้องอยู่ระหว่าง {bounds[0]} ถึง {bounds[1]}°')
            a[key] = max(bounds[0], min(bounds[1], angle))
        root = frame.get('root', [0, 0, 0])
        if not isinstance(root, list) or len(root) != 3:
            raise ValueError('root ต้องเป็น [x, y, z] หน่วยมิลลิเมตร')
        root = [number(v, 'root') for v in root]
        if any(abs(v) > 10000 for v in root):
            raise ValueError('root เกินขอบเขต ±10,000 มม.')
        clean.append({'t': t, 'joints': a, 'root': root})
    easing = value.get('interpolation', 'smooth')
    if easing not in ('linear', 'smooth'):
        raise ValueError('interpolation ต้องเป็น linear หรือ smooth')
    if not isinstance(value.get('loop', True), bool):
        raise ValueError('loop ต้องเป็น true หรือ false')
    desc = value.get('description', '')
    if not isinstance(desc, str) or len(desc) > 1000:
        raise ValueError('คำอธิบายยาวเกิน 1,000 ตัวอักษร')
    return {'version': 1, 'modelId':model_id, 'name': name.strip(), 'description': desc,
            'loop': value.get('loop', True), 'interpolation': easing, 'frames': clean}

def create_app(program_dir=None):
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024
    app.config['TEMPLATES_AUTO_RELOAD'] = True
    folder = Path(program_dir or ROOT / 'data' / 'programs')
    folder.mkdir(parents=True, exist_ok=True)
    robots={id:dict(json.loads((ROOT/meta['robotUrl'].lstrip('/')).read_text(encoding='utf-8')),id=id) for id,meta in MODELS.items()}
    def selected():
        id=request.args.get('model','astra-v1')
        if id not in MODELS:raise ValueError('ไม่พบโมเดลหุ่นยนต์ที่เลือก')
        return id
    def program_folder():
        id=selected();path=folder if id=='astra-v1' else folder/id
        path.mkdir(parents=True,exist_ok=True)
        return path
    @app.get('/')
    def index(): return render_template('index.html')
    @app.get('/physics')
    def physics(): return render_template('physics.html')
    @app.get('/design/v2')
    def design_v2(): return render_template('design-v2.html')
    @app.get('/design/v2/files/<key>')
    def design_file(key):
        files={'cad':'ASTRA_V2_298_Concept.solidcraft','step':'ASTRA_V2_298_Concept.step','bom':'BOM.csv','gait':'ASTRA_V2_Forward_Walk.json','result':'physics-validation.json','zip':'ASTRA_V2_Design_Package.zip'}
        if key not in files:abort(404)
        return send_file(ROOT.parent/'MiniHumanoid_V2'/files[key],as_attachment=True)
    @app.get('/api/health')
    def health(): return jsonify(ok=True, name='Uncle Labs Simulator')
    @app.get('/api/robot')
    def get_robot(): return jsonify(robots[selected()])
    @app.get('/api/models')
    def get_models():return jsonify([{**meta,'height':robots[id]['height'],'jointCount':len(robots[id]['joints'])} for id,meta in MODELS.items()])
    @app.get('/api/programs')
    def programs():
        items=[]
        for path in sorted(program_folder().glob('*.json')):
            try:
                doc=json.loads(path.read_text(encoding='utf-8'))
                items.append({'id':path.stem,'name':doc['name'],'modelId':selected(),
                              'description':doc.get('description',''),
                              'duration':doc['frames'][-1]['t'],
                              'frames':len(doc['frames']),'example':path.stem.startswith('example-')})
            except (ValueError, KeyError, IndexError, OSError): continue
        return jsonify(items)
    def safe_id(id):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', id):
            raise ValueError('รหัสโปรแกรมไม่ถูกต้อง')
        return program_folder() / (id + '.json')
    @app.get('/api/programs/<id>')
    def get_program(id):
        path=safe_id(id)
        if not path.exists(): return jsonify(error='ไม่พบโปรแกรม'),404
        return jsonify(json.loads(path.read_text(encoding='utf-8')))
    @app.post('/api/programs')
    def save_program():
        clean=validate_program(request.get_json(),robots[selected()])
        id='user-'+uuid.uuid4().hex[:12]
        path=safe_id(id)
        with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=program_folder(),delete=False,suffix='.tmp') as out:
            json.dump(clean,out,ensure_ascii=False,indent=2)
            temp=out.name
        os.replace(temp,path)
        return jsonify(id=id,name=clean['name']),201
    @app.post('/api/validate')
    def validate(): return jsonify(validate_program(request.get_json(),robots[selected()]))
    @app.errorhandler(ValueError)
    def invalid(error): return jsonify(error=str(error)),400
    @app.errorhandler(HTTPException)
    def http_error(error): return jsonify(error=error.description),error.code
    return app

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=5055)
    args=parser.parse_args()
    create_app().run(host='127.0.0.1',port=args.port,debug=False)
