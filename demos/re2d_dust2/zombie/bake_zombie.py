#!/usr/bin/env python3
"""Bake the supplied Mixamo zombie into a Re2D character — all through the SDK.

    python3 demos/re2d_dust2/zombie/bake_zombie.py <dir with source/Zombie Walk.fbx and textures/>

1. `r2d-sdk bake-re2d --type character` (FBX skin mesh -> 10-bone Re2D rig, sdk/native/sdk_fbx.c),
2. `r2d-sdk animation-import` retargets the Mixamo walk onto that rig,
3. hit/death are the existing rig clips from demos/re2d_npcs/animations.json (root rotation/translation).
The FBX and textures are third-party assets supplied by the user and are not kept in the repository.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
SDK = ROOT / 'build' / 'r2d-sdk'


def run(cmd):
    out = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, cwd=ROOT)
    rep = json.loads(out.stdout)
    if not rep.get('ok'):
        raise SystemExit('failed: %s\n%s' % (' '.join(map(str, cmd))[:200], out.stdout[:600]))
    return rep


def main(src):
    src = Path(src)
    fbx = next(src.rglob('Zombie Walk.fbx'))
    diffuse = next(src.rglob('zombie_Packed0_Diffuse.png'))
    rep = run([SDK, 'bake-re2d', fbx, '--type', 'character', '--output', HERE, '--name', 'zombie', '--size', '2048',
               '--style', 'anime', '--fbx-ao', f'default={diffuse}',
               '--fbx-rot', 'LeftArm=0,0,-105;RightArm=0,0,105'])   # A-pose: animation-import swings limbs from "hanging down"
    print('zombie mesh: parts', rep['parts'], 'samples', rep['samples'])
    anim = HERE / 'zombie.animations.json'
    run([SDK, 'animation-import', fbx, '--rig', HERE / 'zombie.character.json', '--output', anim, '--clip', 'walk',
         '--stack', 'mixamo.com', '--fps', '15', '--seam', '.15'])
    clips = json.loads(anim.read_text())['clips']
    npc = json.loads((ROOT / 'demos/re2d_npcs/animations.json').read_text())['clips']
    for name in ('hit', 'death'):
        clips[name] = npc[name]
    clips['idle'] = {'duration': 1.0, 'loop': True, 'tracks': []}
    anim.write_text(json.dumps({'version': 1, 'clips': clips}, separators=(',', ':')) + '\n')
    char = HERE / 'zombie.character.json'
    data = json.loads(char.read_text())
    data['animations'] = 'zombie.animations.json'
    data.setdefault('defaults', {})['motion'] = 'idle'      # the baker's preview clip `spin` does not exist in this rig
    char.write_text(json.dumps(data, indent=1) + '\n')
    print('clips:', list(clips))


if __name__ == '__main__':
    main(sys.argv[1])
