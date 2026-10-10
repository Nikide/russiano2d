#!/usr/bin/env python3
"""Author the guns (OBJ models via make_guns.py) and bake them with the SDK.

    python3 demos/rotsprite/weapons/bake_guns.py [name ...]

Every PNG/JSON comes from `build/r2d-sdk bake-re2d --type weapon`; this script only
adds the game sockets (trigger / foregrip / muzzle) to the baked *.character.json.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import make_guns  # noqa: E402

SDK = ROOT / 'build' / 'r2d-sdk'


def bake(name):
    make_guns.BUILDERS[name.replace('_fp', '')](fp=name.endswith('_fp'))
    model = HERE / 'source' / f'{name}_model.obj'
    run = subprocess.run([str(SDK), 'bake-re2d', str(model), '--type', 'weapon', '--output', str(HERE),
                          '--name', name, '--uv', 'existing', '--size', '4096', '--scale', '1',
                          '--origin', 'center', '--style', 'anime'], capture_output=True, text=True)
    report = json.loads(run.stdout)
    if not report.get('ok'):
        raise SystemExit(f'{name}: bake failed: {run.stdout[:600]}')
    for d in report.get('diagnostics', []):
        print(f"  {name}: {d['severity']} {d['code']} {d['message'][:140]}")
    meta = json.loads((HERE / 'source' / f'{name}_model.json').read_text())
    lo, hi = meta['min'], meta['max']
    cx, cy, cz = (lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2   # OBJ is Y-up, Re2D Y-down
    path = HERE / f'{name}.character.json'
    char = json.loads(path.read_text())
    sockets = [dict(name=k, bone='object', point=[round(p[0] - cx, 3), round(p[1] - cy, 3), round(p[2] - cz, 3)])
               for k, p in meta['sockets'].items()]
    sockets.append(dict(name='grip', bone='object', point=sockets[0]['point']))
    char['rig']['sockets'] = sockets
    char.get('defaults', {}).pop('motion', None)
    # The baker adds a looping `spin` preview clip (and the engine plays a lone clip by itself): a held weapon must not rotate.
    char['animations'] = dict(version=1, clips={})
    (HERE / f'{name}.animations.json').unlink(missing_ok=True)
    path.write_text(json.dumps(char, indent=2) + '\n')
    print(f"{name}: samples {report['samples']}, atlas use {report['atlasUsage']:.2%}, fit x{report['fit']['x']} y{report['fit']['y']}")


if __name__ == '__main__':
    names = sys.argv[1:] or [n + sfx for n in make_guns.BUILDERS for sfx in ('', '_fp')]
    for n in names:
        bake(n)
