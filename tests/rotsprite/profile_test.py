#!/usr/bin/env python3
"""Check anatomy landmarks in the actual atlas, not pre-rendered poses."""
import sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
for name in ('v2','swim','police','short'):
 im=Image.open(ROOT/f'demos/assets/art/mascot/russi_rotsprite_{name}.png').convert('RGBA')
 k=im.width//1024
 def depth(mx,my):
  p=im.getpixel(((256+mx)*k,(768+my)*k));assert p[3]==255
  return (p[0]-128)/4
 assert depth(80,39)>depth(80,43)>depth(80,47),name
 for my in (35,38,40,43,47):
  left=im.getpixel(((768+79)*k,(768+my)*k));right=im.getpixel(((768+80)*k,(768+my)*k))
  assert abs((left[0]-128)+(right[0]-128))<=1 and left[1]==right[1],name
  assert abs(depth(79,my)-depth(80,my))<=.25,name
 assert depth(80,38)-depth(80,34)>=1.25,name
 assert depth(80,38)-depth(80,40)>=1.5,name
 # Keep a real lower-face span below the mouth in the actual compiled PNG.
 points=[]
 for my in range(40,48):
  for mx in range(76,85):
   ident=im.getpixel((mx*k,(768+my)*k))
   skin=im.getpixel((mx*4*k,my*4*k))
   if ident[0]==1 and skin[0]>skin[1] and skin[0]>skin[2]:
    xy=im.getpixel(((768+mx)*k,(768+my)*k));points.append((xy[1]-128)/2)
 assert max(points)>=10.5 and max(points)-7.2>=3,name
print('Profile: nose, lips, chin and left/right symmetry pass for all four PNGs')
