#!/usr/bin/env python3
"""JSON surface + one material PNG -> strict RotSprite PNG (no baked views)."""
import argparse,json,math,os,stat,tempfile
from pathlib import Path
from PIL import Image

def finite(v):
    if not isinstance(v,(float,int)) or isinstance(v,bool) or not math.isfinite(v):raise ValueError('finite surface coordinate required')
    return v

def lerp(a,b,t):return [x+(y-x)*t for x,y in zip(a,b)]
def section(rows,v):
    if v<=rows[0][0]:return rows[0][1:]
    for a,b in zip(rows,rows[1:]):
        if v<=b[0]:return lerp(a[1:],b[1:],(v-a[0])/(b[0]-a[0]))
    return rows[-1][1:]
def patches(data):
    if data.get('version')!=1 or not isinstance(data.get('patches'),list):raise ValueError('surface version=1, patches required')
    for p in data['patches']:
        if p['type']=='samples':
            for row in p['samples']:
                if len(row)!=6:raise ValueError('sample: [u,v,id,x,y,z]')
                yield row,p
            continue
        x,y,w,h=p['rect'];part=p['id']
        if any(not isinstance(v,int) or v%4 for v in (x,y,w,h)) or w<4 or h<4:raise ValueError('rect must align to four texels')
        for yy in range(y,y+h,4):
            v=(yy-y)/h
            for xx in range(x,x+w,4):
                u=(xx-x)/w
                if p['type']=='loft':
                    rows=p['sections']
                    if len(rows)<2 or any(len(r)!=8 for r in rows) or any(a[0]>=b[0] for a,b in zip(rows,rows[1:])):raise ValueError('ordered loft sections [v,rx,front,back,cx,cy,cz,angleOffset]')
                    rx,front,back,cx,cy,cz,offset=section(rows,v);angle=(u-.5)*math.tau+offset
                    point=[cx+rx*math.sin(angle),cy,cz+(front if math.cos(angle)>=0 else back)*math.cos(angle)]
                elif p['type']=='grid':
                    rows=p['points'];rh=len(rows);rw=len(rows[0])
                    if rh<2 or rw<2 or any(len(row)!=rw for row in rows):raise ValueError('rectangular control grid >=2x2')
                    a=min(rw-2,int(u*(rw-1)));b=min(rh-2,int(v*(rh-1)));du=u*(rw-1)-a;dv=v*(rh-1)-b
                    point=lerp(lerp(rows[b][a],rows[b][a+1],du),lerp(rows[b+1][a],rows[b+1][a+1],du),dv)
                else:raise ValueError('surface type: samples / loft / grid')
                matrix=p.get('matrix',[1,0,0,0,0,1,0,0,0,0,1,0])
                if len(matrix)!=12 or len(point)!=3:raise ValueError('affine matrix / xyz point')
                point=[sum(matrix[r*4+j]*point[j] for j in range(3))+matrix[r*4+3] for r in range(3)]
                yield [xx,yy,part,*point],p

def encode_coordinates(X,Y,Z):
    """v2 SUB extension: preserve sixteenth-cell coordinates in unused map channels."""
    values=[X*4+128,Y*2+128,Z*4+128]
    cells=[min(4080,max(0,round(v*16))) for v in values]
    xi,yi,zi=(v//16 for v in cells)
    return (zi,(cells[2]%16)*17,zi,255),(xi,yi,(cells[0]%16)*16+cells[1]%16,255)

def compile_surface(data,material=None,size=1024,segments=False):
    if size not in (1024,2048,3072,4096):raise ValueError('square PNG 1024/2048/3072/4096')
    if material:
        im=Image.open(material).convert('RGBA')
        if im.width!=im.height or im.width not in (1024,2048,3072,4096):raise ValueError('strict square material PNG')
        im=im.resize((1024,1024),Image.Resampling.NEAREST)
    else:im=Image.new('RGBA',(1024,1024))
    im.paste((0,0,0,0),(0,768,1024,1024));px=im.load();used=set()
    for row,p in patches(data):
        x,y,part,X,Y,Z=row
        if any(not isinstance(v,int) for v in (x,y,part)) or not 0<=x<1024 or not 0<=y<768 or x%4 or y%4 or not 1<=part<=254:raise ValueError('aligned UV and ID 1..254')
        if (x,y) in used:raise ValueError('overlapping surface UV cells')
        used.add((x,y));X,Y,Z=map(finite,(X,Y,Z))
        if not (-32<=X<=31.75 and -64<=Y<=63.5 and -32<=Z<=31.75):raise ValueError('surface outside coordinate encoding range')
        group=part;blend_part=blend_weight=0
        if segments:
            for rule in data.get('segments',[]):
                axis=rule['axis'];target=rule['assign']
                if axis not in ('x','y','z') or not isinstance(target,int) or not 1<=target<=254:raise ValueError('segment axis / assign ID')
                if part==rule['id']:
                    offset=(X,Y,Z)[('x','y','z').index(axis)]-finite(rule['greaterThan'])
                    width=finite(rule.get('blendWidth',0))
                    if width<0:raise ValueError('blendWidth must be nonnegative')
                    original=part
                    if offset>0:part=target
                    if width and abs(offset)<width/2:
                        t=.5+offset/width;t=t*t*(3-2*t)
                        blend_part=original if offset>0 else target
                        blend_weight=round((1-t if offset>0 else t)*255)
        if not material:
            color=p.get('color',[150,170,160]);
            if len(color)!=3 or any(not isinstance(v,int) or not 0<=v<=255 for v in color):raise ValueError('RGB color')
            im.paste(tuple(color)+(255,),(x,y,x+4,y+4))
        mx,my=x//4,y//4
        depth,coords=encode_coordinates(X,Y,Z)
        px[mx,768+my]=(part,group,blend_part,255);px[256+mx,768+my]=(depth[0],depth[1],blend_weight,255)
        px[512+mx,768+my]=(255 if px[x,y][3] else 128,255,255,255);px[768+mx,768+my]=coords
    for i,c in enumerate(((82,50,68,255),(82,79,84,255),(2,4,4,255),(83,85,66,255),(66,76,68,255))):px[i,960]=c
    return im.resize((size,size),Image.Resampling.NEAREST)

def save_png(image,target):
    """Publish a complete PNG on the same filesystem for live-reload readers."""
    target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    mode=stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
    with tempfile.NamedTemporaryFile(dir=target.parent,prefix='.'+target.name+'.',suffix='.png',delete=False) as f:temporary=Path(f.name)
    try:
        image.save(temporary,format='PNG');temporary.chmod(mode);os.replace(temporary,target)
    finally:temporary.unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('surface');parser.add_argument('--material');parser.add_argument('--output',required=True);parser.add_argument('--size',type=int,default=1024);parser.add_argument('--segments',action='store_true');args=parser.parse_args()
    data=json.loads(Path(args.surface).read_text());im=compile_surface(data,args.material,args.size,args.segments)
    target=Path(args.output);save_png(im,target)
if __name__=='__main__':main()
