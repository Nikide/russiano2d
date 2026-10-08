#!/usr/bin/env python3
"""Compile artwork into a single PNG: color + ID/Z/coverage/XY maps."""
from pathlib import Path
import json
from compile_rotsprite import patches,save_png
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent
S=1024

def build(template=False, costume=None, short=False):
    source=Image.open(ROOT/'demos/rotsprite/source/russi_parts.png').convert('RGBA')
    result=Image.new('RGBA',(S,S))
    def patch(box, rect):
        part=source.crop(box).resize((rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS)
        part.putalpha(part.getchannel('A').point(lambda a:255 if a>=128 else 0))
        result.paste(part,rect[:2])
    clean=Image.open(ROOT/'demos/rotsprite/source/head_identity.png').convert('RGBA')
    clean.putalpha(clean.getchannel('A').point(lambda a:255 if a>=128 else 0))
    box=clean.getbbox()
    head=clean.crop(box).resize((640,192),Image.Resampling.LANCZOS)
    head.putalpha(head.getchannel('A').point(lambda a:255 if a>=128 else 0))
    result.paste(head,(0,0))
    # A small front material mark follows the same surface as the nose silhouette.
    nose=Image.open(ROOT/'demos/rotsprite/source/nose_detail.png').convert('RGBA')
    nose_box=nose.getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox()
    nose=nose.crop(nose_box).resize((6,5),Image.Resampling.LANCZOS)
    result.alpha_composite(nose,(318,153))
    patch((780,28,973,237),(640,0,832,192))
    patch((0,250,973,487),(0,208,832,396))
    hair=Image.open(ROOT/'demos/rotsprite/source/hair_soft.png').convert('RGBA')
    hair.putalpha(hair.getchannel('A').point(lambda a:255 if a>=128 else 0))
    hair=hair.crop(hair.getbbox())
    # Normalize each source ribbon independently; sheet gutters are not UV seams.
    for i in range(8):
        ribbon=hair.crop((round(i*hair.width/8),0,round((i+1)*hair.width/8),hair.height))
        box=ribbon.getbbox()
        if box:
            result.paste(ribbon.crop(box).resize((104,188),Image.Resampling.LANCZOS),(i*104,208))
    # A tail uses a continuous ribbon, not the spiral/accessory collage.
    ribbon=hair.crop((round(7*hair.width/8),0,hair.width,hair.height))
    result.paste(ribbon.crop(ribbon.getbbox()).resize((192,188),Image.Resampling.LANCZOS),(832,208))
    # Tail material is normalized above.
    patch((0,500,384,770),(0,408,320,576))
    patch((384,500,625,770),(320,408,512,576))
    patch((625,500,800,770),(512,408,704,576))
    patch((800,500,1254,770),(704,408,1024,576))
    patch((0,780,690,952),(0,576,576,768))
    patch((690,780,1254,952),(576,576,1024,768))
    # Normalize individual cutouts into documented cells; source art is kept untouched.
    result.paste((0,0,0,0),(832,0,1024,192))
    face=Image.open(ROOT/'demos/rotsprite/source/face_parts.png').convert('RGBA')
    fw,fh=face.size
    for row in range(4):
        def face_cell(left,right,target,size):
            cell=face.crop((round(fw*left),round(fh*row/4),round(fw*right),round(fh*(row+1)/4)))
            # The machine atlas keeps binary coverage; projection resolves smooth edges.
            cell.putalpha(cell.getchannel('A').point(lambda a:255 if a>=192 else 0))
            box=cell.getbbox()
            if box: result.paste(cell.crop(box).resize(size,Image.Resampling.LANCZOS),target)
        face_cell(0,.5,(836,row*48+8),(88,32))
        face_cell(.5,.75,(936,row*48+16),(32,16))
        face_cell(.75,1,(976,row*48+16),(44,16))
    if costume:
        donor=Image.open(ROOT/f'demos/rotsprite/source/{costume}_parts.png').convert('RGBA')
        dw,dh=donor.size
        def donor_patch(box,rect):
            piece=donor.crop(tuple(round(v) for v in box)).resize((rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS)
            piece.putalpha(piece.getchannel('A').point(lambda a:255 if a>=128 else 0))
            result.paste(piece,rect[:2])
        for left,right,dleft,dright in [(0,.3125,0,320),(.3125,.5,320,512),(.5,.6875,512,704),(.6875,1,704,1024)]:
            donor_patch((dw*left,0,dw*right,dh*.5),(dleft,408,dright,576))
        donor_patch((0,dh*.5,dw*.5625,dh),(0,576,576,768))
        donor_patch((dw*.5625,dh*.5,dw,dh),(576,576,1024,768))
    if not costume:
        # Four actual continuous material bands: torso, sleeve, skirt, stocking.
        # Locate opaque rows rather than assuming image_gen kept exact canvas gutters.
        cloth=Image.open(ROOT/'demos/rotsprite/source/maid_unwrap.png').convert('RGBA')
        cloth.putalpha(cloth.getchannel('A').point(lambda a:255 if a>=128 else 0))
        mask=cloth.getchannel('A')
        rows=[];start=None
        for y in range(cloth.height):
            dense=sum(v==255 for v in mask.crop((0,y,cloth.width,y+1)).getdata())>cloth.width*.8
            if dense and start is None:start=y
            if start is not None and (not dense or y==cloth.height-1):
                if y-start>cloth.height*.1:rows.append((start,y))
                start=None
        if len(rows)!=4:raise ValueError('maid unwrap must contain four continuous bands')
        def band(row,rect):
            lo,hi=rows[row]
            cell=cloth.crop((12,lo+2,cloth.width-12,hi-2))
            result.paste(cell.resize((rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS),rect[:2])
        band(0,(0,408,320,576))
        band(1,(320,408,416,576));band(1,(416,408,512,576))
        band(3,(512,408,608,576));band(3,(608,408,704,576))
        band(2,(704,408,1024,576))
    # Ear material is a cutout; mirror the same front material for the pair.
    result.paste((0,0,0,0),(640,0,832,192))
    ear=Image.open(ROOT/'demos/rotsprite/source/ear_anime.png').convert('RGBA')
    ear.putalpha(ear.getchannel('A').point(lambda a:255 if a>=128 else 0))
    ear=ear.crop(ear.getbbox()).resize((96,128),Image.Resampling.LANCZOS)
    result.paste(ear,(640,0))
    bow=Image.open(ROOT/'demos/rotsprite/source/bow_clean.png').convert('RGBA')
    bow.putalpha(bow.getchannel('A').point(lambda a:255 if a>=128 else 0))
    result.paste(bow.crop(bow.getbbox()).resize((96,64),Image.Resampling.LANCZOS),(640,128))
    ear=result.crop((640,0,736,192))
    result.paste(ear,(736,0))
    result.putalpha(result.getchannel('A').point(lambda a:255 if a>=128 else 0))
    px=result.load()
    def put(x,y,part,X,Y,Z):
        if not px[x,y][3]: return
        if template: px[x,y]=((part*47)%180+50,(part*83)%180+50,(part*29)%180+50,255)
        mx,my=x//4,y//4
        enc=lambda v:max(0,min(255,round(v*4+128)))
        px[mx,768+my]=(part,(part*83)%180+50,(part*47)%180+50,255)
        px[256+mx,768+my]=(enc(Z),enc(Z),enc(Z),255)
        px[512+mx,768+my]=(255,255,255,255)
        px[768+mx,768+my]=(enc(X),max(0,min(255,round(Y*2+128))),0,255)
    # Surface coordinates are editable authoring JSON, shared with the generic compiler.
    surface_name=costume or ('short' if short else 'maid')
    surface=json.loads((ROOT/f'demos/rotsprite/source/russi_{surface_name}.surface.json').read_text())
    for sample,_ in patches(surface):put(*sample)
    if template:
        for y in range(768):
            for x in range(S):
                if not px[x,y][3]: continue
                part=px[x//4,768+y//4][0]
                px[x,y]=((part*47)%180+50,(part*83)%180+50,(part*29)%180+50,255) if part else (110,120,125,255)
    for i,c in enumerate([(82,50,68,255),(82,79,84,255),(2,4,4,255)]): px[i,960]=c
    target=ROOT/('assets/rotsprite/rotsprite_v2_template.png' if template else f'demos/assets/art/mascot/russi_rotsprite_{costume or ("short" if short else "v2")}.png')
    target.parent.mkdir(parents=True,exist_ok=True)
    save_png(result.resize((4096,4096),Image.Resampling.NEAREST),target)
    return target
if __name__=='__main__':
    print(build()); print(build(True)); print(build(costume='police')); print(build(costume='swim')); print(build(short=True))
