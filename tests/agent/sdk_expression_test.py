#!/usr/bin/env python3
"""Dense/sparse VRM morph targets and invalid sparse indices exercise real bake."""
import json,os,struct,subprocess,sys
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT=os.path.join(ROOT,'build','sdk_expression');os.makedirs(OUT,exist_ok=True)
SDK=os.environ.get('R2D_SDK_BINARY',os.path.join(ROOT,'build','r2d-sdk'));failed=[]
def check(x,m):
 print(('  ok   ' if x else '  FAIL ')+m)
 if not x:failed.append(m)
def fixture(mode):
 b=open(os.path.join(ROOT,'tests','fixtures','sdk','vrm','humanoid0.vrm' if mode=='v0' else 'humanoid.vrm'),'rb').read();n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);buf=bytearray(b[28+n:]);node=next(i for i,v in enumerate(d['nodes'])if 'mesh' in v);mesh=d['nodes'][node]['mesh'];prim=d['meshes'][mesh]['primitives'][0];count=d['accessors'][prim['attributes']['POSITION']]['count']
 def view(data):
  while len(buf)%4:buf.append(0)
  i=len(d['bufferViews']);d['bufferViews'].append({'buffer':0,'byteOffset':len(buf),'byteLength':len(data)});buf.extend(data);return i
 acc={'componentType':5126,'count':count,'type':'VEC3'}
 # Move the head vertices away from the neutral pose: morph BEFORE skinning.
 values=[(float('inf') if mode=='nan' else -.04 if mode=='v0' else .04,0,-.05 if mode=='v0' else .05)if i<8 else (0,0,0)for i in range(count)]
 if mode=='dense':acc['bufferView']=view(b''.join(struct.pack('<3f',*v)for v in values))
 else:acc['sparse']={'count':8,'indices':{'bufferView':view(bytes([0,1,2,3,4,5,6, count if mode=='bad' else 7])),'componentType':5121},'values':{'bufferView':view(b''.join(struct.pack('<3f',*v)for v in values[:8]))}}
 ai=len(d['accessors']);d['accessors'].append(acc)
 for p in d['meshes'][mesh]['primitives']:p['targets']=[{'POSITION':ai}]
 if mode=='v0':d['extensions']['VRM']['blendShapeMaster']['blendShapeGroups'][0]['binds']=[{'mesh':mesh,'index':0,'weight':100}]
 else:d['extensions']['VRMC_vrm']['expressions']['preset']['happy']={'morphTargetBinds':[{'node':node,'index':0,'weight':1}]}
 d['buffers'][0]['byteLength']=len(buf);raw=json.dumps(d,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);buf+=b'\0'*((-len(buf))%4)
 path=os.path.join(OUT,mode+'.vrm');open(path,'wb').write(struct.pack('<III',0x46546c67,2,28+len(raw)+len(buf))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(buf),0x004e4942)+buf);return path
def bake(src,name,expr=None):
 args=[SDK,'bake-re2d',src,'--type','character','--output',os.path.join(OUT,name),'--name','hero']
 if expr:args+=['--expression',expr]
 p=subprocess.run(args,capture_output=True,text=True,timeout=120);return p.returncode,json.loads(p.stdout)
dense=fixture('dense');sparse=fixture('sparse');bad=fixture('bad');nonfinite=fixture('nan')
rc,n=bake(dense,'neutral');rc,d=bake(dense,'dense','happy');rc2,s=bake(sparse,'sparse','happy')
check(rc==0 and rc2==0 and d['ok'] and s['ok'],'dense and sparse expression bake accepted')
check(open(d['files']['png'],'rb').read()==open(s['files']['png'],'rb').read(),'dense and sparse morph targets produce identical PNG v2')
check(open(n['files']['png'],'rb').read()!=open(d['files']['png'],'rb').read(),'selected expression changes baked surface')
check(len(d['character']['mapping'])==d['character']['vrm']['humanBones'],'report exposes all humanoid mappings')
rc,b=bake(bad,'bad','happy');check(rc==1 and any(x['code']=='SDK_BAKE_MORPH_ACCESSOR'for x in b['diagnostics']),'out of range sparse index rejected')
rc,b=bake(dense,'unknown','absent');check(rc==1 and not b['ok'],'unknown expression fails explicitly')
rc,b=bake(nonfinite,'nonfinite','happy');check(rc==1 and any(x['code']=='SDK_BAKE_POSITION' for x in b['diagnostics']),'nonfinite morph geometry rejected before sampling')
# KHR texCoord overrides the texture's texCoord before selecting the supported UV set.
blob=open(os.path.join(ROOT,'tests','fixtures','sdk','props','crate.glb'),'rb').read();n=struct.unpack_from('<I',blob,12)[0];doc=json.loads(blob[20:20+n]);binary=blob[28+n:]
texture=doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture'];texture['texCoord']=1;texture['extensions']={'KHR_texture_transform':{'texCoord':0}}
raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);path=os.path.join(OUT,'override.glb');open(path,'wb').write(struct.pack('<III',0x46546c67,2,28+len(raw)+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary)
p=subprocess.run([SDK,'bake-re2d',path,'--output',os.path.join(OUT,'override')],capture_output=True,text=True);report=json.loads(p.stdout)
check(p.returncode==0 and not any(x['code']=='SDK_BAKE_TEXCOORD_UNSUPPORTED'for x in report['diagnostics']),'KHR texture transform texCoord override selects UV0 correctly')
rc,v0=bake(fixture('v0'),'v0','joy')
check(rc==0 and v0['ok'],'VRM 0.x blendShape binds use percentage weights')
check(open(v0['files']['png'],'rb').read()==open(d['files']['png'],'rb').read(),'VRM 0.x joy matches equivalent VRM 1.0 happy after axis conversion')
sys.exit(bool(failed))
