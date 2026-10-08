#!/usr/bin/env python3
"""Generic JSON rigs, animated sockets and separate held props in the real engine."""
import json, math, sys, tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from agent_client import Agent,ROOT

def main():
 with tempfile.TemporaryDirectory(prefix='r2d-json-') as temp:
  from compile_rotsprite import compile_surface
  prop=json.loads((Path(ROOT)/'demos/rotsprite/templates/prop.surface.json').read_text());compile_surface(prop,size=3072).save(Path(temp)/'prop3072.png')
  path=Path(temp)/'hero.json';d=json.loads((Path(ROOT)/'demos/rotsprite/russi.character.json').read_text())
  d['atlas']=str(Path(ROOT)/'demos/assets/art/mascot/russi_model_maid.png');d['animations']=str(Path(ROOT)/'demos/rotsprite/russi.animations.json')
  path.write_text(json.dumps(d))
  with Agent(game='tests/fixtures/rotsprite',seed=11) as a:
   a.step(2);before=a.eval('engine.limits().textures')
   a.eval(f"globalThis.sizeTest=$.rotSprite.from({{version:1,atlas:{str(Path(temp)/'prop3072.png')!r},rig:{{bones:[{{name:'root'}}],parts:[{{id:80,bone:'root'}}]}},defaults:{{body:true}}}})")
   assert a.eval('$.rotSprite.info(sizeTest).atlasWidth')==3072;a.eval('sizeTest.remove()')
   a.eval(f"globalThis.hero=$.rotSprite.from({str(path)!r},{{id:'hero'}}).at(400,300).size(400,400).rotHotReload().rotMotion('walk',0)")
   for kind in ['ak47','pistol','shotgun']:
    a.eval(f"globalThis.item=$.rotSprite.from('demos/rotsprite/weapons/{kind}.character.json',{{id:'item'}}).rotAttach(hero,'handRight',{{grip:'trigger',rotation:[0,180,0]}}).rotHotReload()")
    for yaw,time in [(0,0),(90,.3),(-90,.6),(180,.9)]:
     a.eval(f"hero.rotSeek({time}).rotPose({yaw},15)")
     pair=a.eval('({h:$.rotSprite.info(hero),i:$.rotSprite.info(item)})');h,i=pair['h'],pair['i']
     assert i['yaw']==h['yaw'] and i['pitch']==h['pitch']
     assert i['surfaceSamples']>100
     for k in [3,7,11]: assert math.isclose(h['sockets']['handRight']['matrix'][k],i['sockets']['trigger']['matrix'][k],abs_tol=1e-7)
    a.eval('hero.rotReload();item.rotReload()');assert a.eval('$.rotSprite.info(item).attachment.parent')=='hero'
    assert a.eval("(()=>{try{hero.rotAttach(item,'trigger');return false}catch(e){return true}})()")
    a.eval('item.remove()')
   # Aiming pose: both grips align and the barrel follows character forward +Z.
   a.eval("globalThis.aim=$.rotSprite.from('demos/rotsprite/russi.character.json',{id:'aim'}).rotMotion('idle',0).rotLayer('holdRifle',true,0);globalThis.rifle=$.rotSprite.equip(aim,'ak47')")
   for yaw in [0,45,90,180]:
    a.eval(f'aim.rotPose({yaw},10)');pair=a.eval('({h:$.rotSprite.info(aim),i:$.rotSprite.info(rifle)})')
    for hand,grip in [('handRight','trigger'),('handLeft','foregrip')]:
     for k in [3,7,11]:assert math.isclose(pair['h']['sockets'][hand]['matrix'][k],pair['i']['sockets'][grip]['matrix'][k],abs_tol=1e-6)
    direction=[pair['i']['sockets']['muzzle']['matrix'][k]-pair['i']['sockets']['trigger']['matrix'][k] for k in [3,7,11]]
    assert abs(direction[0])<1e-6 and direction[2]>20
   a.eval('rifle.remove();aim.remove()')
   # JSON reload is atomic, and the animated rig is editable without rebuilding C.
   rev=a.eval('$.rotSprite.info(hero).reloads');path.write_text('{broken');a.step(32)
   assert a.eval('$.rotSprite.info(hero).reloads')==rev and a.eval('!!$.rotSprite.info(hero).reloadError')
   d['rig']['sockets'][0]['point'][0]=12;path.write_text(json.dumps(d));a.step(32)
   assert a.eval('$.rotSprite.info(hero).reloads')>rev
   a.eval("globalThis.item=$.rotSprite.from('demos/rotsprite/weapons/pistol.character.json').rotAttach(hero,'handRight',{grip:'trigger'});hero.remove()")
   assert a.eval('$.rotSprite.info(item).attachment') is None
   a.eval('item.remove()');assert a.eval('engine.limits().textures')==before
   a.eval("$.rotSprite.from('demos/rotsprite/templates/animal.character.json',{id:'animal'}).rotMotion('walk').rotSeek(.3);$.rotSprite.from('demos/rotsprite/templates/prop.character.json',{id:'prop'}).rotSeek(.5)")
   assert a.eval("$.rotSprite.info('#animal').surfaceSamples")>100
   assert a.eval("$.rotSprite.info('#prop').surfaceSamples")>100
  with Agent(game='demos',scene='re2dsprite',seed=11) as a:
   a.step(2)
   for kind in ['ak47','pistol','shotgun','none']:
    a.tap('G');a.step(2);assert a.state()['rotSpriteDemo']['equipment']==kind
   a.tap('Escape');a.step(30);assert a.eval("$('rotsprite').length")==0
 print('  ok   RotSprite JSON: sockets, 3 props, reload, cleanup, animal/prop and demo passed')
if __name__=='__main__':main()
