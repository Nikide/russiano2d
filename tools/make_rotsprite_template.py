#!/usr/bin/env python3
"""PNG-шаблон для разработчиков: те же области, что у атласа маскота."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

N = 64
ROOT = Path(__file__).resolve().parent.parent
REGIONS = [
    ('HEAD / UV',0,0,4,2,'#e8c3a4'),
    ('EAR L',4,0,1,1,'#a0d5ac'), ('BACK',4,1,1,1,'#5d936b'),
    ('EAR R',5,0,1,1,'#c6dfa1'), ('BACK',5,1,1,1,'#8baa61'),
    ('LONG HAIR',6,0,2,2,'#628776'),
    ('TORSO',0,2,4,2,'#8aa1c9'),
    ('ARM L',4,2,2,2,'#b39bd3'), ('ARM R',6,2,2,2,'#d0aad3'),
    ('PELVIS / SKIRT',0,4,4,2,'#9b88aa'),
    ('LEG L',4,4,2,2,'#d6a185'), ('LEG R',6,4,2,2,'#e9ba92'),
    ('TAIL',0,6,2,2,'#76a698'), ('BANGS',2,6,2,2,'#94be8a'),
    ('HANDS',4,6,2,2,'#ecc7a4'), ('SHOES',6,6,2,2,'#8b92a1'),
]


def main():
    image = Image.new('RGBA',(8*N,8*N))
    d = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=12)
    for name,x,y,w,h,color in REGIONS:
        x,y,w,h = x*N,y*N,w*N,h*N
        d.rectangle((x,y,x+w-1,y+h-1),fill=color,outline='#28343c',width=2)
        for gx in range(x+16,x+w,16): d.line((gx,y+2,gx,y+h-3),fill='#ffffff')
        for gy in range(y+16,y+h,16): d.line((x+2,gy,x+w-3,gy),fill='#ffffff')
        d.rectangle((x+3,y+3,x+w-4,y+22),fill='#28343c')
        d.text((x+6,y+5),name,font=font,fill='#ffffff')
    # Фронт в u=.5, затылок на краях. Метки помогают рисовать на поверхности.
    d.line((2*N,24,2*N,2*N-3),fill='#99596a',width=2)
    d.text((N+20,2*N-18),'FRONT u=0.5',font=font,fill='#28343c')
    for x in (2*N-22,2*N+22):
        d.rectangle((x-8,74,x+8,80),fill='#28343c')
    target = ROOT / 'assets/rotsprite/rotsprite_v1_template.png'
    target.parent.mkdir(parents=True,exist_ok=True)
    image.save(target)
    print(f'{target}: 512×512, общий шаблон персонажа')


if __name__ == '__main__': main()
