#!/usr/bin/env python3
"""Re2DSprite v3: загрузка плотных спрайтов (автомат, зомби, Руся из v2), клип, свет, время синтеза; convert-re2d3."""
import json, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'tools')
from agent_client import Agent

fails = 0
def check(c, m):
    global fails
    print(('ok ' if c else 'FAIL ') + m)
    if not c: fails += 1

with tempfile.TemporaryDirectory() as tmp:
    out = subprocess.run(['build/r2d-sdk', 'convert-re2d3', 'demos/assets/art/mascot/russi_model_maid.png', '--output', tmp, '--name', 'r', '--density', '4',
                          '--character', 'demos/rotsprite/russi.character.json'], capture_output=True, text=True)
    rep = json.loads(out.stdout)
    check(rep.get('ok') and rep['grid'] == [1024, 768] and rep['texels'] > 100000, 'convert-re2d3 builds a dense v3 from the mascot v2 PNG')
    bad = subprocess.run(['build/r2d-sdk', 'convert-re2d3', 'demos/assets/art/mascot/../../../rotsprite/russi3.png', '--output', tmp], capture_output=True, text=True)
    check(bad.returncode != 0, 'convert-re2d3 rejects a PNG that is not v2')

with Agent(game='demos/re2d_gun_viewer', seed=7) as a:
    a.step(4)
    for path, clip in (('demos/re2d_dust2/aks3/aks.character.json', 'fire'), ('demos/re2d_dust2/zombie3/zombie.character.json', 'walk'), ('demos/rotsprite/russi3.character.json', None)):
        a.eval('showV3("%s",30,-5,700%s)' % (path, ',"%s",0.1' % clip if clip else ''))
        a.step(6)
        info = json.loads(a.eval('JSON.stringify($.re2dSprite.info(v3node))'))
        check(info['version'] == 3 and info['levels'] >= 1 and info['surfaceSamples'] > 100000, '%s loads as v3 (%d texels)' % (path.split('/')[-1], info['surfaceSamples']))
        check(sum(info['synthMs']) < 80, 'synthesis time %.1f ms' % sum(info['synthMs']))
sys.exit(1 if fails else 0)
