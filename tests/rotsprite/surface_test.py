#!/usr/bin/env python3
"""Authoring primitives and strict map encoding."""
import sys, unittest,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from compile_rotsprite import compile_surface,patches,save_png
class Surfaces(unittest.TestCase):
 def test_custom_grid_and_segmentation(self):
  d={'version':1,'patches':[{'type':'grid','id':80,'rect':[0,0,8,8],'points':[[[0,0,0],[2,0,0]],[[0,2,0],[2,2,0]]]}],'segments':[{'id':80,'axis':'y','greaterThan':.5,'assign':91}]}
  rows=list(patches(d));self.assertEqual(rows[-1][0],[4,4,80,1.,1.,0.])
  im=compile_surface(d,segments=True);self.assertEqual(im.getpixel((1,769))[0],91);self.assertEqual(im.getpixel((768,768))[:2],(128,128));self.assertEqual(im.getpixel((2,960)),(2,4,4,255))
 def test_strict_rejections(self):
  for sample in [[0,0,255,0,0,0],[0,0,80,32,0,0],[1,0,80,0,0,0],[0,0,80,float('nan'),0,0]]:
   with self.assertRaises(ValueError):compile_surface({'version':1,'patches':[{'type':'samples','samples':[sample]}]})
  with self.assertRaises(ValueError):compile_surface({'version':1,'patches':[{'type':'samples','samples':[[0,0,80,0,0,0]]*2}]})
 def test_atomic_publication(self):
  from PIL import Image
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'live.png'
   save_png(Image.new('RGBA',(8,8),(1,2,3,255)),target)
   save_png(Image.new('RGBA',(16,16),(2,3,4,255)),target)
   with Image.open(target) as image:self.assertEqual(image.size,(16,16))
   self.assertEqual(list(Path(directory).iterdir()),[target])
 def test_loft(self):
  d={'version':1,'patches':[{'type':'loft','id':90,'rect':[0,0,16,16],'sections':[[0,2,3,4,0,-2,0,0],[1,3,4,5,0,2,0,0]]}]}
  self.assertEqual(len(list(patches(d))),16);self.assertEqual(compile_surface(d).size,(1024,1024))
if __name__=='__main__':unittest.main()
