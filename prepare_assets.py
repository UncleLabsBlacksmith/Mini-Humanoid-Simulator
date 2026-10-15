"""Convert the exported, neutral CAD assembly and generate editable motion examples."""
import json, math, pathlib, zipfile, xml.etree.ElementTree as ET
R=pathlib.Path(__file__).parent
CAD=R.parent/'MiniHumanoid_DS3225'
manifest=json.loads((CAD/'assembly_manifest.json').read_text())
owner={n:c for c,names in manifest['component_bodies'].items() for n in names}
with zipfile.ZipFile(R/'robot.3mf') as z: root=ET.fromstring(z.read('3D/3dmodel.model'))
ns={'m':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
colors=[b.attrib['displaycolor'] for b in root.findall('m:resources/m:basematerials/m:base',ns)]
meshes=[]
for obj in root.findall('m:resources/m:object',ns):
    name=obj.attrib['name']
    vertices=[round(float(v.attrib[k]),5) for v in obj.findall('m:mesh/m:vertices/m:vertex',ns) for k in ('x','y','z')]
    indices=[int(v.attrib[k]) for v in obj.findall('m:mesh/m:triangles/m:triangle',ns) for k in ('v1','v2','v3')]
    meshes.append({'name':name,'link':owner[name],'color':colors[int(obj.attrib['pindex'])],'positions':vertices,'indices':indices})
(R/'static'/'meshes.json').write_text(json.dumps(meshes,separators=(',',':')))
labels={'Hip_Roll':'สะโพกเอียง','HipPitch':'สะโพกหน้า–หลัง','KneePitch':'เข่า','AnklePitch':'ข้อเท้า','ShoulderPitch':'ไหล่','ElbowPitch':'ข้อศอก'}
joints=[]
for item in manifest['joints']:
    j=dict(item); kind=j['name'][2:]
    # Anatomical angles are consistent left/right. The CAD shaft direction is retained as metadata.
    j['cad_axis']=j['axis']
    j['axis']=[0,-1,0] if kind=='Hip_Roll' else ([1,0,0] if kind=='KneePitch' else [-1,0,0])
    j['label']=labels[kind]+(' ซ้าย' if j['name'].startswith('L') else ' ขวา')
    j['group']='arm' if 'Shoulder' in kind or 'Elbow' in kind else 'leg'
    joints.append(j)
robot={'name':'ASTRA / DS3225MG','height':295,'width':275,'depth':95,'units':'mm',
       'joints':joints,'links':list(manifest['component_bodies']),'meshCount':len(meshes),
       'source':'MiniHumanoid_DS3225_295_Assembly.solidcraft',
       'angleConvention':'Anatomical angles, identical left/right; not raw servo commands.',
       'simulation':'kinematic','footCorners':{side:[[x,y,0] for x in ((-83,-13) if side=='L' else (13,83)) for y in (-54,41)] for side in ['L','R']}}
(R/'static'/'robot.json').write_text(json.dumps(robot,ensure_ascii=False,indent=2),encoding='utf-8')
zero={j['name']:0 for j in joints}
def frame(t,angles=None,root=(0,0,0)):return {'t':round(t,5),'joints':dict(zero,**(angles or {})),'root':[round(v,6) for v in root]}
def save(id,name,description,frames,loop=True,interpolation='smooth'):
    p={'version':1,'name':name,'description':description,'loop':loop,'interpolation':interpolation,'frames':frames}
    (R/'data'/'programs'/('example-'+id+'.json')).write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding='utf-8')
def ik(dy,down):
    L=63
    beta=math.acos(max(-1,min(1,(dy*dy+down*down-2*L*L)/(2*L*L))))
    alpha=math.atan2(dy,down)-beta/2
    return [-math.degrees(alpha),math.degrees(beta),math.degrees(alpha+beta)]
# Alternating stance and swing. Each stance foot remains fixed in world Y.
# Small steps fit the existing provisional CAD joint limits. This is not dynamic balance.
walk=[]
stride=32; period=2.4
for i in range(97):
    p=i/96; forward=stride*p; a={}; support={}
    for side,phase in [('L',p),('R',p+.5)]:
        k=math.floor(phase); q=phase-k
        if q<.5:
            foot=8+stride*k-(16 if side=='R' else 0);lift=0
        else:
            u=(q-.5)*2;s=u*u*(3-2*u)
            foot=8+stride*k+stride*s-(16 if side=='R' else 0)
            lift=3*math.sin(math.pi*u)**2
        dy=forward-foot
        hip,knee,ankle=ik(dy,125-lift)
        a.update({side+'_HipPitch':hip,side+'_KneePitch':knee,side+'_AnklePitch':ankle,
                  side+'_ShoulderPitch':15*math.sin(2*math.pi*p+(0 if side=='L' else math.pi)),
                  side+'_ElbowPitch':20})
    walk.append(frame(p*period,a,(0,-forward,-1)))
save('walk','เดินไปข้างหน้า','ก้าวสั้นสลับซ้าย–ขวา ใช้ inverse kinematics ให้เท้าข้างรับน้ำหนักอยู่กับที่ · 32 มม. ต่อรอบ',walk,interpolation='linear')
march=[]
for i in range(49):
    p=i/48;a={}
    for side,shift in [('L',0),('R',.5)]:
        lift=3*max(0,math.sin(2*math.pi*(p+shift)))**2
        h,k,an=ik(0,125-lift)
        a.update({side+'_HipPitch':h,side+'_KneePitch':k,side+'_AnklePitch':an,
                  side+'_ShoulderPitch':12*math.sin(2*math.pi*(p+shift)),side+'_ElbowPitch':20})
    march.append(frame(p*2.4,a,(0,0,-1)))
save('march','ย่ำเท้าอยู่กับที่','สลับยกเท้าสั้น ๆ โดยไม่เลื่อนลำตัวไปข้างหน้า',march,interpolation='linear')
squat=[]
# Dense samples keep root height consistent with the leg angles between poses.
for i in range(153):
    t=3.8*i/152
    u=t/1.6 if t<1.6 else ((3.8-t)/1.6 if t>2.2 else 1)
    u=max(0,min(1,u))
    knee=35*u*u*(3-2*u)
    a={}
    for side in ['L','R']:a.update({side+'_HipPitch':knee/2,side+'_KneePitch':knee,side+'_AnklePitch':knee/2,side+'_ShoulderPitch':knee/2})
    squat.append(frame(t,a,(0,0,126*math.cos(math.radians(knee/2))-126)))
save('squat','ย่อตัว','พับสะโพก เข่า และข้อเท้าสัมพันธ์กัน พร้อมลดระดับลำตัว',squat,interpolation='linear')
save('arms','ทักทายด้วยแขน','ทดสอบไหล่และข้อศอกแยกจากขา',[
    frame(0),frame(.8,{'R_ShoulderPitch':30,'R_ElbowPitch':55}),
    frame(1.3,{'R_ShoulderPitch':30,'R_ElbowPitch':25}),frame(1.8,{'R_ShoulderPitch':30,'R_ElbowPitch':55}),
    frame(2.3,{'R_ShoulderPitch':30,'R_ElbowPitch':25}),frame(3.1)])
save('blank','โปรแกรมใหม่','เริ่มจากท่ายืน แล้วปรับข้อต่อและบันทึก Keyframe',[frame(0),frame(1)],False)
print('CAD meshes:',len(meshes),'triangles:',sum(len(m['indices'])//3 for m in meshes))
print('Walk ranges:',{j['name']:[round(min(f['joints'][j['name']] for f in walk),2),round(max(f['joints'][j['name']] for f in walk),2)] for j in joints})
