#!/usr/bin/env python3
"""bake-re2d FBX loader (sdk/native/sdk_fbx.c): mesh, material colour/tint, pivot, errors, character gate."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/fixtures/sdk'))
from make_fbx_fixtures import cube_fbx  # noqa: E402

SDK = ROOT / 'build' / 'r2d-sdk'
failed = []


def check(ok, name):
    print(('ok ' if ok else 'FAIL ') + name, flush=True)
    if not ok:
        failed.append(name)


def bake(src, out, *args):
    run = subprocess.run([str(SDK), 'bake-re2d', str(src), '--output', str(out), '--size', '1024', *args], capture_output=True, text=True)
    return json.loads(run.stdout)


with tempfile.TemporaryDirectory(prefix='r2d-fbx-') as tmp:
    tmp = Path(tmp)
    fbx = tmp / 'cube.fbx'
    fbx.write_text(cube_fbx((1, 0, 0)))
    rep = bake(fbx, tmp / 'a', '--type', 'prop', '--name', 'cube')
    check(rep['ok'] and rep['source']['kind'] == 'fbx' and rep['source']['triangles'] == 12 and rep['source']['materials'] == 1, 'an ASCII FBX cube bakes as a prop: 12 triangles, 1 material')
    check((tmp / 'a' / 'cube.png').exists() and (tmp / 'a' / 'cube.character.json').exists(), 'FBX produces the usual PNG v2 + character.json')
    rep2 = bake(fbx, tmp / 'b', '--type', 'weapon', '--name', 'gun', '--fbx-tint', 'Paint=#2060ff', '--scale', '10', '--pivot', '0,0,0')
    check(rep2['ok'] and abs(rep2['fit']['x'][0] + 10) < 1e-3 and abs(rep2['fit']['x'][1] - 10) < 1e-3, '--pivot/--scale keep the cube centred on the given point (x in -10..10)')
    rep3 = bake(fbx, tmp / 'c', '--type', 'weapon', '--name', 'gun', '--scale', '10', '--pivot', '1,0,0')
    check(rep3['ok'] and abs(rep3['fit']['x'][0] + 20) < 1e-3, 'a shifted pivot moves the model (x min -20)')
    png_a = (tmp / 'b' / 'gun.png').read_bytes()
    png_c = (tmp / 'c' / 'gun.png').read_bytes()
    check(png_a != png_c, 'different pivots/tints give different atlases')
    bad = bake(fbx, tmp / 'd', '--type', 'weapon', '--name', 'x', '--fbx-stack', 'nope')
    check(not bad['ok'] and any(d['code'] == 'SDK_BAKE_FBX_STACK' for d in bad['diagnostics']), 'an unknown animation clip is reported (SDK_BAKE_FBX_STACK)')
    ch = bake(fbx, tmp / 'e', '--type', 'character', '--name', 'x')
    check(not ch['ok'] and any(d['code'] in ('SDK_BAKE_HUMANOID_INCOMPLETE', 'SDK_BAKE_CHARACTER_NO_HUMANOID') for d in ch['diagnostics']), 'a non-humanoid FBX is rejected as a character')
    broken = tmp / 'broken.fbx'
    broken.write_text('not an fbx')
    bb = bake(broken, tmp / 'f', '--type', 'prop')
    check(not bb['ok'], 'garbage input is rejected without a crash')

print('FAILED: %d' % len(failed) if failed else 'sdk_fbx_test: все проверки пройдены')
sys.exit(1 if failed else 0)
