"""Parametric 298 mm / 16 DOF concept. One geometry source for CAD and simulation.
Servo housings include nominal mounting-lug envelopes; holes, cables and splines are provisional.
"""
from pathlib import Path
import json, math, itertools, csv, subprocess
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'static/models/astra-v2';OUT.mkdir(parents=True,exist_ok=True)
CAD=ROOT.parent/'MiniHumanoid_V2';CAD.mkdir(exist_ok=True)
PROGRAMS=ROOT/'data/programs/astra-v2';PROGRAMS.mkdir(exist_ok=True)
parts=[];joints=[];links=['Torso'];commands=[]
BLUE='#437DD5';WHITE='#DEE7F0';DARK='#26364A';GOLD='#EAC078'
def box(name,link,center,size,color=WHITE,mass=None,servo=False,collide=True):
    if mass is None:mass=math.prod(size)*2700/1e9
    parts.append(dict(name=name,link=link,center=center,size=size,color=color,mass=mass,servo=servo,collide=collide))
def joint(side,kind,parent,child,p,axis,limits,label,group='leg'):
    name=side+'_'+kind;links.append(child)
    joints.append(dict(name=name,a=parent,b=child,p=p,axis=axis,limits=limits,label=label+(' ซ้าย' if side=='L' else ' ขวา'),group=group))
    return name
def servo(name,parent,p,kind,s,child):
    x,y,z=p
    # Output shaft is 2 mm beyond the case face; long-axis shaft offset = 10 mm.
    if kind=='pitch':
        box(name+'_Case',parent,[x-s*22.25,y,z-10],[40.5,20,40],DARK,.057,True)
        for dz in [-33.625,13.625]:box(name+'_Lug_'+str(dz),parent,[x-s*13.3,y,z+dz],[3,20,7.25],DARK,.0015,True)
        box(name+'_Horn',child,[x+s*1.5,y,z],[3,14,14],GOLD,.002)
    else:
        # Roll servos lie across the pelvis / foot, or vertically at the shoulder.
        horizontal=kind=='roll-horizontal'
        cx=x+s*10 if name.endswith('Hip_Roll') else x-s*10
        center=[cx,y+22.25,z] if horizontal else [x,y+22.25,z-10]
        size=[40,40.5,20] if horizontal else [20,40.5,40]
        box(name+'_Case',parent,center,size,DARK,.057,True)
        for offset in [-23.625,23.625]:
            c=[center[0]+offset,y+13.3,z] if horizontal else [x,y+13.3,center[2]+offset]
            box(name+'_Lug_'+str(offset),parent,c,[7.25,3,20] if horizontal else [20,3,7.25],DARK,.0015,True)
        box(name+'_Horn',child,[x,y-1.5,z],[14,3,14],GOLD,.002)

# Open torso bay, board and passive head. Battery is a separate simulator collider.
box('Chest_Front', 'Torso',[0,-16,254],[100,3,42],WHITE)
box('Chest_Back','Torso',[0,47,248],[100,3,54],BLUE)
box('Pelvis_Bridge','Torso',[0,45,213],[168,3,6],BLUE)
box('Chest_Top','Torso',[0,15,275],[100,63,3],BLUE)
box('Controller_Envelope','Torso',[0,-8,251],[48,8,30],DARK,.045)
box('IMU_Envelope','Torso',[0,-8,272],[18,12,3],GOLD,.005)
box('Head','Torso',[0,4,285],[38,32,26],WHITE,.025)
box('Visor','Torso',[0,-12.5,286],[31,1,10],DARK,0,False,False)
for x in [-9,9]:box('Eye_'+str(x),'Torso',[x,-13.2,286],[5,.5,3],'#6BDAF1',0,False,False)
for side,s in [('L',-1),('R',1)]:
    x=s*52
    spec=[('Hip_Roll','Torso',side+'_HipCarrier',[x,0,230],[0,-1,0],[-20,20],'สะโพกเอียง','roll-horizontal'),
          ('HipPitch',side+'_HipCarrier',side+'_Thigh',[x,0,205],[-1,0,0],[-45,60],'สะโพกหน้า–หลัง','pitch'),
          ('KneePitch',side+'_Thigh',side+'_Shin',[x,0,140],[1,0,0],[0,100],'เข่า','pitch'),
          ('AnklePitch',side+'_Shin',side+'_AnkleCarrier',[x,0,75],[-1,0,0],[-45,45],'ข้อเท้าหน้า–หลัง','pitch'),
          ('AnkleRoll',side+'_AnkleCarrier',side+'_Foot',[x,0,24],[0,1,0],[-18,18],'ข้อเท้าเอียง','roll-horizontal')]
    for kind,a,b,p,axis,limits,label,style in spec:
        name=joint(side,kind,a,b,p,axis,limits,label);servo(name,a,p,style,s,b)
    box(side+'_Hip_Link',side+'_HipCarrier',[x,-15,217.5],[22,3,29],BLUE)
    box(side+'_Thigh_Plate',side+'_Thigh',[x+s*5,0,172.5],[3,26,65],WHITE)
    box(side+'_Shin_Plate',side+'_Shin',[x+s*5,0,107.5],[3,26,65],BLUE)
    box(side+'_Ankle_Link',side+'_AnkleCarrier',[x+s*5,-19,49.5],[3,26,51],WHITE)
    box(side+'_Foot_Plate',side+'_Foot',[x,-5,2],[60,95,4],BLUE)
    box(side+'_Foot_Horn_Bracket',side+'_Foot',[x,-4.5,14],[20,3,24],WHITE)
    # Three joints in each arm; yaw and active head deliberately omitted.
    arm=[('ShoulderPitch','Torso',side+'_ShoulderCarrier',[s*98,0,275],[-1,0,0],[-90,90],'ไหล่หน้า–หลัง','pitch'),
         ('ShoulderRoll',side+'_ShoulderCarrier',side+'_UpperArm',[s*110,0,245],[0,-s,0],[-35,80],'ไหล่กางแขน','roll-vertical'),
         ('ElbowPitch',side+'_UpperArm',side+'_Forearm',[s*110,0,190],[-1,0,0],[0,120],'ข้อศอก','pitch')]
    for kind,a,b,p,axis,limits,label,style in arm:
        name=joint(side,kind,a,b,p,axis,limits,label,'arm');servo(name,a,p,style,s,b)
    box(side+'_Shoulder_Link',side+'_ShoulderCarrier',[s*104,-15,260],[16,3,34],BLUE)
    box(side+'_Upperarm_Link',side+'_UpperArm',[s*115,-15,217.5],[3,24,55],WHITE)
    box(side+'_Forearm_Link',side+'_Forearm',[s*115,-15,164],[3,24,52],BLUE)
    box(side+'_Hand',side+'_Forearm',[s*110,-5,135],[24,24,12],WHITE,.012)

def mesh(p):
    c=p['center'];h=[v/2 for v in p['size']]
    vertices=[[c[i]+sign[i]*h[i] for i in range(3)] for sign in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]
    return dict(name=p['name'],link=p['link'],color=p['color'],positions=[v for point in vertices for v in point],indices=indices)
meshes=[mesh(p) for p in parts]
dimensions=[max(p['center'][i]+p['size'][i]/2 for p in parts)-min(p['center'][i]-p['size'][i]/2 for p in parts) for i in range(3)]
robot=dict(id='astra-v2',name='ASTRA V2 · PRIMER-inspired',height=dimensions[2],width=dimensions[0],depth=dimensions[1],units='mm',joints=joints,links=links,meshCount=len(meshes),source='ASTRA_V2_298_Concept.solidcraft',simulation='kinematic',angleConvention='Anatomical joint angles; not servo PWM.',footCorners={side:[[s*52+dx,y,0] for dx in [-30,30] for y in [-52.5,42.5]] for side,s in [('L',-1),('R',1)]})
physics=dict(links=[],battery=dict(mass=.15,center=[0,.024,.247],half=[.018,.009,.023]),assumptions=['16 DS3225 servo envelopes, 60 g each; frames use aluminium density 2700 kg/m3.', 'Concept geometry: housing/lug envelopes, no validated fasteners, wiring or full joint sweep.', 'Masses, motor operating torque and contact friction require measurement.', 'No active yaw axis or actuated toe/heel; not a replica of PRIMER-V5 or a full UVC implementation.'])
for link in links:
    ps=[p for p in parts if p['link']==link and p['collide']];mass=sum(p['mass'] for p in ps)
    physics['links'].append(dict(name=link,mass=mass,shapes=[dict(name=p['name'],center=[v/1000 for v in p['center']],half=[v/2000 for v in p['size']],servo=p['servo'],massFraction=p['mass']/mass) for p in ps]))
for name,obj in [('robot.json',robot),('meshes.json',meshes),('physics-model.json',physics)]: (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
manifest=dict(robot=robot,parts=parts,battery=physics['battery'],mass_kg=sum(l['mass'] for l in physics['links'])+.15,status='CONCEPT / NOT RELEASED FOR MANUFACTURE')
(CAD/'design_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
with (CAD/'BOM.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['Part','Link','X mm','Y mm','Z mm','Mass kg','Role'])
    for p in parts:w.writerow([p['name'],p['link'],*p['size'],p['mass'],'servo envelope' if p['servo'] else 'concept part'])
    w.writerow(['Battery envelope','Torso',36,18,46,.15,'estimated battery'])

# Neutral envelope screening: distinguish servo housings from adjoining structural pieces.
overlaps=[]
for a,b in itertools.combinations([p for p in parts if p['servo']],2):
    d=[min(a['center'][i]+a['size'][i]/2,b['center'][i]+b['size'][i]/2)-max(a['center'][i]-a['size'][i]/2,b['center'][i]-b['size'][i]/2) for i in range(3)]
    if min(d)>.05:overlaps.append(dict(a=a['name'],b=b['name'],overlap_mm=d))
cross_link=[]
for a,b in itertools.combinations([p for p in parts if p['collide']],2):
    if a['link']==b['link']:continue
    d=[min(a['center'][i]+a['size'][i]/2,b['center'][i]+b['size'][i]/2)-max(a['center'][i]-a['size'][i]/2,b['center'][i]-b['size'][i]/2) for i in range(3)]
    if min(d)>.05:cross_link.append(dict(a=a['name'],b=b['name'],overlap_mm=d))
(CAD/'envelope-check.json').write_text(json.dumps(dict(dimensions_mm=dimensions,servo_envelope_overlaps=overlaps,cross_link_overlaps=cross_link,neutral_only=True),indent=2))
assert len(joints)==16 and dimensions[2]<=300
assert not overlaps,overlaps
assert not cross_link,cross_link

# CAD component bodies and revolute axes from the same data (no hardware changes to V1).
for link in links:
    commands.extend([dict(command='component.activate',params=dict(component='root')),dict(command='component.create',params=dict(name=link))])
    for p in [p for p in parts if p['link']==link]:
        commands.append(dict(command='solid.box',params=dict(corner=[p['center'][i]-p['size'][i]/2 for i in range(3)],length=p['size'][0],width=p['size'][1],height=p['size'][2],operation='new',name=p['name'],body_name=p['name'])))
commands.append(dict(command='component.activate',params=dict(component='root')))
for color in {p['color'] for p in parts}:commands.append(dict(command='appearance.assign',params=dict(bodies=[p['name'] for p in parts if p['color']==color],color=color)))
commands.append(dict(command='occurrence.ground',params=dict(occurrence='Torso:1',grounded=True)))
for j in joints:
    commands.extend([dict(command='joint.origin',params=dict(name=j['name']+'_axis',occurrence=j['a']+':1',point=j['p'],z=j['axis'])),dict(command='joint.as_built',params=dict(type='revolute',a=j['a']+':1',b=j['b']+':1',at=j['name']+'_axis',name=j['name'])),dict(command='joint.limits',params=dict(joint=j['name'],min=j['limits'][0],max=j['limits'][1]))])
commands.extend([dict(command='joint.solve',params={}),dict(command='joint.list',params={}),dict(command='document.inspect',params=dict(measure=True)),dict(command='file.export',params=dict(path=str(CAD/'ASTRA_V2_298_Concept.step')))])
(CAD/'build_commands.json').write_text(json.dumps(commands,indent=2))
print(json.dumps(dict(height=robot['height'],width=robot['width'],depth=robot['depth'],joints=len(joints),links=len(links),mass_kg=manifest['mass_kg'],servo_overlaps=len(overlaps))))
