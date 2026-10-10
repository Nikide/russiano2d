#!/usr/bin/env python3
"""Bake the animated first-person AKS-74U (FBX with hands) into Re2DSprite frames — all through the SDK.

    python3 demos/re2d_dust2/aks74u/bake_aks74u.py <dir with source/fp_hands_aks74u.fbx and textures/>

Every PNG/JSON comes from `build/r2d-sdk bake-re2d` (FBX loader: sdk/native/sdk_fbx.c). One call per frame
with a fixed --pivot/--scale, so the frames of a clip line up. The result is a flip-book of ordinary
Re2DSprite assets (no mesh, no skeleton at runtime); frames.json lists the clips for main.js.
The FBX and its 40 MB of textures are NOT in the repository (third-party asset, supplied by the user).
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
SDK = ROOT / 'build' / 'r2d-sdk'

# Fixed pivot (centre of the union of all clip bounding boxes, metres, Y up) and scale (units/metre).
PIVOT = '0.006,-0.249,-0.283'
SCALE = 55
SIZE = 1024
TINT = 'aks74u=#4a4f58,aks74u.wood=#8a4a20,bullet=#d0aa58'

CLIPS = [  # name, FBX stack, seconds, frames
    ('idle', 'armatureAction', 0.0, 1),
    ('draw', 'Put_in', 1.0, 8),
    ('fire', 'Fire_single', 0.3, 6),
    ('reload', 'reload', 1.883, 16),
]


def bake(fbx, ao, name, stack, t):
    cmd = [str(SDK), 'bake-re2d', str(fbx), '--type', 'weapon', '--output', str(HERE), '--name', name,
           '--uv', 'auto', '--size', str(SIZE), '--scale', str(SCALE), '--pivot', PIVOT, '--style', 'anime',
           '--fbx-stack', stack, '--fbx-time', f'{t:.4f}', '--fbx-tint', TINT, '--fbx-ao', f'aks74u={ao},aks74u.wood={ao}']
    out = subprocess.run(cmd, capture_output=True, text=True)
    rep = json.loads(out.stdout)
    if not rep.get('ok'):
        raise SystemExit(f'{name}: bake failed: {out.stdout[:500]}')
    char = HERE / f'{name}.character.json'
    data = json.loads(char.read_text())
    data.get('defaults', {}).pop('motion', None)
    data['animations'] = dict(version=1, clips={})
    char.write_text(json.dumps(data, indent=1) + '\n')
    (HERE / f'{name}.animations.json').unlink(missing_ok=True)
    return rep


def main(src):
    src = Path(src)
    fbx = next(src.rglob('fp_hands_aks74u.fbx'))
    ao = next(src.rglob('AKS74U_AO.png'))
    frames = {}
    for clip, stack, length, count in CLIPS:
        names = []
        for i in range(count):
            t = length * i / max(1, count - 1)
            name = clip if clip == 'idle' else f'{clip}_{i:02d}'
            rep = bake(fbx, ao, name, stack, t)
            names.append(name)
            print(f'{name:12s} {stack}@{t:.3f}s  samples {rep["samples"]}')
        frames[clip] = dict(frames=names, seconds=length if count > 1 else 0)
    (HERE / 'frames.json').write_text(json.dumps(frames, indent=1) + '\n')
    print('frames.json written:', {k: len(v['frames']) for k, v in frames.items()})


if __name__ == '__main__':
    main(sys.argv[1])
