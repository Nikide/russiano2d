#!/usr/bin/env python3
"""Compile pig-soldier source art into editable RE2DSprite surface atlases.

Front/back paintings supply albedo. Runtime receives surface coordinates, not
facing images. Every cylindrical sample is part of an articulated surface.
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image
from compile_rotsprite import compile_surface, patches, save_png, section

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'demos/re2d_npcs'
VARIANTS = ['assault', 'scout', 'heavy', 'sniper', 'medic', 'commander']


def views(path):
    image = Image.open(path).convert('RGBA')
    result = []
    for side in range(2):
        part = image.crop((side*image.width//2, 0, (side+1)*image.width//2, image.height))
        box = part.getchannel('A').point(lambda a: 255 if a >= 200 else 0).getbbox()
        if not box:
            raise ValueError('source requires two nonempty front/back figures')
        result.append(part.crop(box))
    return result


def build(name):
    front, back = views(DEST / 'source' / (name+'.png'))
    material = Image.new('RGBA', (1024, 1024))
    surface = dict(version=1, patches=[])
    cursor = [0, 0, 0]
    heavy = name == 'heavy'

    def rectangle(w, h):
        if cursor[0]+w > 1024:
            cursor[0] = 0
            cursor[1] += cursor[2]
            cursor[2] = 0
        if cursor[1]+h > 768:
            raise ValueError('surface UV capacity exceeded')
        rect = [cursor[0], cursor[1], w, h]
        cursor[0] += w
        cursor[2] = max(cursor[2], h)
        return rect

    def loft(part, texture, rows, w=128, h=96):
        surface['patches'].append(dict(type='loft', id=part, rect=rectangle(w,h),
                                       sections=rows, texture=texture))

    def row(v, rx, front_z, back_z, x, y, z=0):
        return [v, rx, front_z, back_z, x, y, z, 0]

    loft(1, 'head', [row(0,3,3,3,0,-15),row(.13,10,6,7,0,-12),
        row(.40,13,7,8,0,-5),row(.68,12,8,8,0,5),row(.90,8,6,6,0,12),row(1,2,2,2,0,15)], 256,128)
    for sign in [-1,1]:
        loft(2, 'ear', [row(0,.4,1,1,sign*12,-9),row(.35,5.5,2,2,sign*15,-6),
            row(.75,4.5,1,1,sign*15,-2),row(1,.5,.5,.5,sign*12,1)],64,48)
    hair_end = 11 if name=='scout' else 26
    loft(3, 'hair', [row(0,2,2,2,0,-15,-5),row(.18,12.5,4,5,0,-10,-5),
        row(.5,13,3,5,0,4,-6),row(.8,10,2,4,0,hair_end*.7,-6),row(1,6,1,2,0,hair_end,-6)],192,128)
    if name in ['scout','heavy','commander']:
        loft(5,'hat',[row(0,3,3,3,0,-17),row(.35,12,7,8,0,-15),row(1,13,8,8,0,-9)],128,32)
    width=11 if heavy else 9
    loft(6,'torso',[row(0,5,4,4,0,-14),row(.18,width,6,5,0,-10),
        row(.55,width,7 if heavy else 6,5,0,2),row(.82,8,5,4,0,13),row(1,9,5,5,0,21)],192,128)
    loft(9,'pelvis',[row(0,9,5,5,0,17),row(.4,10,6,6,0,22),row(1,8,4,4,0,27)],128,48)
    for sign, arm, forearm, hip, knee, shoe in [(-1,7,20,8,10,13),(1,11,21,12,15,14)]:
        ax=sign*10
        loft(arm,'arm',[row(0,3.8 if heavy else 3,3,3,ax,-10),
            row(.5,3.4,3,3,ax,-3),row(1,2.6,2.5,2.5,ax,4)],96,48)
        loft(forearm,'forearm',[row(0,2.6,2.5,2.5,ax,4),row(.65,2.1,2,2,ax,13),
            row(.83,2.8,2,2,ax,16),row(1,2.4,2,2,ax,20)],96,48)
        x=sign*5
        loft(hip,'leg',[row(0,4.4,4.5,4.5,x,22),row(.6,4,4,4,x,30),row(1,3.4,3.5,3.5,x,36)],96,64)
        loft(knee,'leg',[row(0,3.4,3.5,3.5,x,36),row(.4,3.1,3,3,x,42),row(1,2.5,2.5,2.5,x,49)],96,64)
        loft(shoe,'boot',[row(0,2.7,2.7,2.7,x,46),row(.6,3,4,3,x,53),row(1,3,6,3,x,56,1)],96,48)
    if name in ['medic','heavy','sniper']:
        loft(60,'backpack',[row(0,3,2,2,0,-9,-7),row(.15,8,3,3,0,-5,-7),
            row(.85,8,3,3,0,10,-7),row(1,4,2,2,0,14,-7)],128,64)
    samples=[]
    tail_rect=rectangle(128,32)
    for j in range(8):
        v=j/7; angle=-.5+v*math.tau*1.15
        for i in range(32):
            u=i/32;around=u*math.tau
            samples.append([tail_rect[0]+i*4,tail_rect[1]+j*4,4,
                3*math.cos(angle)+math.cos(around),20+3*math.sin(angle)+math.sin(around),-9-2*v])
    surface['patches'].append(dict(type='samples',texture='tail',samples=samples))

    def color(part, texture, x, y, z):
        # Source coordinates describe material coverage, never runtime facing.
        rear = z < (-5 if texture in ['head','hair','hat'] else 0)
        image = back if rear or texture in ['hair','backpack','tail'] else front
        if texture in ['head','hair','hat']:
            nx=.5+(x if image is front else -x)*.020
            ny=(y+16)/32*.235
            if texture=='hair':ny=max(.04,min(.25,ny))
            if texture=='hat':ny=(y+18)/10*.10
        elif texture=='ear':
            nx=.24 if x<0 else .76;ny=.085+(y+8)*.004
        elif texture=='torso':
            nx=.5+(x if image is front else -x)*.021
            ny=.235+(y+14)/35*.245
        elif texture=='pelvis':
            nx=.5+(x if image is front else -x)*.021;ny=.48+(y-17)/10*.11
        elif texture in ['arm','forearm']:
            t=(y+10)/30;center=.30-.21*t
            side=-1 if x<0 else 1
            nx=.5+side*(.5-center)+(x-side*10)*.018
            ny=.27+t*.28
        elif texture=='leg':
            side=-1 if x<0 else 1
            nx=.5+side*.14+(x-side*5)*.026
            ny=.565+(y-22)/27*.285
        elif texture=='boot':
            side=-1 if x<0 else 1
            nx=.5+side*.16+(x-side*5)*.028;ny=.82+(y-46)/10*.17
        elif texture=='backpack':
            nx=.5-x*.022;ny=.245+(y+9)/23*.19
        else:
            nx=.5+x*.016;ny=.465+(y-20)*.008
        sx=max(0,min(image.width-1,round(nx*(image.width-1))))
        sy=max(0,min(image.height-1,round(ny*(image.height-1))))
        rgb=image.getpixel((sx,sy))
        if rgb[3]<128:
            # Transparent source margins must never punch holes in support surfaces.
            # Search nearby albedo; retain an explicit fallback for unpainted undersides.
            for radius in [2,5,10,20,40]:
                found=False
                for dx,dy in [(-radius,0),(radius,0),(0,-radius),(0,radius)]:
                    q=image.getpixel((max(0,min(image.width-1,sx+dx)),max(0,min(image.height-1,sy+dy))))
                    if q[3]>=200:rgb=q;found=True;break
                if found:break
            if rgb[3]<128:rgb=(77,82,61,255) if texture not in ['head','hair','ear','tail'] else (225,145,151,255)
        return (*rgb[:3],255)

    pixels=material.load()
    for sample, patch in patches(surface):
        u,v,part,x,y,z=sample
        for dy in range(4):
            for dx in range(4):
                xx,yy,zz=x,y,z
                if patch['type']=='loft':
                    px,py,pw,ph=patch['rect']
                    t=(v-py+dy)/ph;angle=((u-px+dx)/pw-.5)*math.tau
                    rx,f,b,cx,cy,cz,offset=section(patch['sections'],t)
                    angle+=offset
                    xx=cx+rx*math.sin(angle);yy=cy;zz=cz+(f if math.cos(angle)>=0 else b)*math.cos(angle)
                pixels[u+dx,v+dy]=color(part,patch['texture'],xx,yy,zz)
    save_png(material,DEST/(name+'.material.png'))
    (DEST/(name+'.surface.json')).write_text(json.dumps(surface,separators=(',',':'))+'\n')
    save_png(compile_surface(surface,material=DEST/(name+'.material.png'),size=4096),DEST/(name+'.png'))
    print(name, 'compiled', flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('variants', nargs='*', choices=VARIANTS)
    args=parser.parse_args()
    for name in args.variants or VARIANTS:build(name)
