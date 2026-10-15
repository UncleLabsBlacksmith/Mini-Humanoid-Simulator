import copy
import json
import tempfile
import unittest
from pathlib import Path
from app import create_app, validate_program, ROOT

class MotionAPI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.client = create_app(self.tmp.name).test_client()
        self.robot = json.loads((ROOT/'static/robot.json').read_text(encoding='utf-8'))
        self.program = json.loads((ROOT/'data/programs/example-walk.json').read_text(encoding='utf-8'))
    def tearDown(self): self.tmp.cleanup()
    def test_examples_are_valid(self):
        for path in (ROOT/'data/programs').glob('example-*.json'):
            with self.subTest(path=path):
                validate_program(json.loads(path.read_text(encoding='utf-8')),self.robot)
    def test_save_load_and_list(self):
        result=self.client.post('/api/programs',json=self.program)
        self.assertEqual(result.status_code,201)
        id=result.json['id']
        fetched=self.client.get('/api/programs/'+id)
        self.assertEqual(fetched.json['frames'],self.program['frames'])
        self.assertEqual(self.client.get('/api/programs').json[0]['id'],id)
        self.assertEqual(len(list(Path(self.tmp.name).glob('*.json'))),1)
    def test_reject_unsafe_motion(self):
        bad=[]
        p=copy.deepcopy(self.program);p['frames'][1]['t']=0;bad.append(p)
        p=copy.deepcopy(self.program);p['frames'][0]['joints']['L_KneePitch']=90;bad.append(p)
        p=copy.deepcopy(self.program);del p['frames'][0]['joints']['L_KneePitch'];bad.append(p)
        p=copy.deepcopy(self.program);p['frames'][0]['root'][0]=float('nan');bad.append(p)
        p=copy.deepcopy(self.program);p['frames'][0]['joints']['L_Hip_Roll']=True;bad.append(p)
        p=copy.deepcopy(self.program);p['frames'][0]['root']=[0,0];bad.append(p)
        for p in bad:
            with self.subTest(program=p): self.assertEqual(self.client.post('/api/programs',json=p).status_code,400)
        self.assertEqual(list(Path(self.tmp.name).glob('*.json')),[])
    def test_routes_and_invalid_id(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertEqual(self.client.get('/physics').status_code,200)
        with self.client.get('/static/physics-model.json') as response:
            self.assertEqual(response.status_code,200)
        self.assertTrue(self.client.get('/api/health').json['ok'])
        self.assertEqual(self.client.get('/api/programs/no-such-motion').status_code,404)
        self.assertEqual(self.client.get('/api/programs/..').status_code,400)
        self.assertEqual(self.client.post('/api/validate',data='bad',content_type='application/json').status_code,400)
        self.assertEqual(self.client.get('/design/v2').status_code,200)
        self.assertEqual(self.client.get('/design/v2/files/unknown').status_code,404)
        with self.client.get('/design/v2/files/gait') as response:
            self.assertEqual(response.status_code,200)
            self.assertIn('attachment',response.headers['Content-Disposition'])
            self.assertEqual(json.loads(response.data)['modelId'],'astra-v2')

    def test_model_selection_and_program_isolation(self):
        models=self.client.get('/api/models').json
        self.assertEqual({m['id']:m['jointCount'] for m in models},{'astra-v1':12,'astra-v2':16})
        v2=self.client.get('/api/robot?model=astra-v2').json
        self.assertEqual(v2['height'],298)
        self.assertEqual(len(v2['links']),17)
        for path in (ROOT/'data/programs/astra-v2').glob('example-*.json'):
            validate_program(json.loads(path.read_text(encoding='utf-8')),v2)
        p=json.loads((ROOT/'data/programs/astra-v2/example-walk.json').read_text(encoding='utf-8'))
        response=self.client.post('/api/programs?model=astra-v2',json=p)
        self.assertEqual(response.status_code,201)
        id=response.json['id']
        self.assertEqual(self.client.get('/api/programs').json,[])
        self.assertEqual(self.client.get('/api/programs/'+id).status_code,404)
        fetched=self.client.get('/api/programs/'+id+'?model=astra-v2').json
        self.assertEqual(fetched['modelId'],'astra-v2')
        self.assertEqual(fetched['frames'],p['frames'])
        self.assertEqual(self.client.post('/api/validate',json=p).status_code,400)
        self.assertEqual(self.client.post('/api/validate?model=astra-v2',json=self.program).status_code,400)
        p['modelId']='astra-v1'
        self.assertEqual(self.client.post('/api/validate?model=astra-v2',json=p).status_code,400)
        self.assertEqual(self.client.get('/api/robot?model=../../other').status_code,400)
        self.assertEqual(self.client.get('/api/programs?model=unknown').status_code,400)

if __name__=='__main__':unittest.main()
