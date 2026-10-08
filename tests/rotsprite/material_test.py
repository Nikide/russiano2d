#!/usr/bin/env python3
"""Regression: garment UV bands must not contain sprite-sheet cutout holes."""
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
for name in ('v2','short'):
    im=Image.open(ROOT/f'demos/assets/art/mascot/russi_rotsprite_{name}.png').convert('RGBA')
    k=im.width//1024
    def color(x,y):return im.getpixel((x*k,y*k))
    def mapped(x,y,part):
        assert color(x,y)[3]==255,(name,x,y,'material hole')
        assert color(x//4,768+y//4)[0]==part,(name,x,y,'missing map')
    for x in range(8,312,4):
        for y in range(416,568,4):mapped(x,y,6)
    for lo,part in ((320,7),(416,11),(512,8),(608,12)):
        for x in range(lo+8,lo+88,4):
            for y in range(416,568,4):mapped(x,y,part)
    # Each ear/bow cell has its own UV origin; absolute x modulo width splits it.
    for start in (640,736):
        for y in range(0,192,4):
            for x in range(start,start+88,4):
                a=color(x//4,768+y//4);b=color((x+4)//4,768+y//4)
                if a[0]==2 and b[0]==2:
                    xa=color(768+x//4,768+y//4)[0]
                    xb=color(768+(x+4)//4,768+y//4)[0]
                    assert abs(xa-xb)<=2,(name,'ear/bow UV discontinuity',x,y)
    apron=color(160,480);back=color(8,480)
    assert min(apron[:3])>180 and max(back[:3])<120,(name,'torso front/back')
    apron=color(864,480);back=color(712,480)
    assert min(apron[:3])>180 and max(back[:3])<120,(name,'skirt front/back')
    cuff=color(368,520);hand=color(368,556)
    assert min(cuff[:3])>180 and hand[0]>hand[2]+25,(name,'cuff/skin')
print('Materials: continuous garment coverage, front aprons and sleeve transitions pass')
