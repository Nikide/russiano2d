#!/usr/bin/env python3
"""Editor Collision studio: click-to-add, mouse move/resize/vertex with one undo per drag, real Box2D physics, validated Save."""
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run

E = '$.editorApp'
A = E + '.activeTab().inst'
checks = 0


def check(value, message):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + message, flush=True)
    if not value:
        raise AssertionError(message)


def main():
    recents = Path(ROOT) / 'state.local.json'
    previous = recents.read_bytes() if recents.exists() else None
    try:
        test()
        print('editor_collision_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def at(a, x, y):
    p = a.eval(A + '.ops.screenOf(%r,%r)' % (x, y))
    a.mouse_move(x=p['x'], y=p['y']); a.step(1)


def drag(a, frm, to, steps=5):
    at(a, *frm); a.mouse(1, 'down'); a.step(1)
    for i in range(1, steps + 1):
        at(a, frm[0] + (to[0] - frm[0]) * i / steps, frm[1] + (to[1] - frm[1]) * i / steps)
    a.mouse(1, 'up'); a.step(2)


def shape(a, i):
    return a.eval(A + '.state.data.shapes[%d]' % i)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-collision-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Collision","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        data = {'version': 1, 'shapes': [{'name': 'floor', 'tag': 'wall', 'shape': 'box', 'x': 400, 'y': 560, 'w': 800, 'h': 40},
                                         {'name': 'tri', 'shape': 'polygon', 'x': 200, 'y': 300, 'points': [-30, 20, 30, 20, 0, -30]}]}
        path = root / 'level.collision.json'
        path.write_text(json.dumps(data))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=6) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            gravity = a.eval('$.world.gravity()')
            a.eval(E + '.openFile("level.collision.json");1')
            settle(a, '!!' + A + ' && !!' + A + '.state.data')
            a.step(4)
            check(a.eval(E + '.activeTab().studio.id==="collision" && ' + E + '.studios.studioById("collision-tools").id==="collision"'), 'opens in native Collision studio; old id is an alias')
            check(not a.eval(A + '.dirty()') and a.eval(A + '.diagnostics().length') == 0, 'clean and valid on open')

            # Click-to-add with the circle tool (snapped to 8).
            a.eval(A + '.ops.action("tool:circle");1')
            at(a, 603, 205); a.mouse(1, 'click'); a.step(2)
            c = shape(a, 2)
            check(c and c['shape'] == 'circle' and c['x'] == 600 and c['y'] == 208, 'circle tool places a snapped shape at the click')
            check(a.eval(A + '.state.selected') == 2 and a.eval(A + '.state.ext.tool') == 'select', 'new shape is selected; tool returns to Select')

            # Move floor by drag: one undo step.
            a.eval(A + '.ops.select(0);1'); a.step(1)
            drag(a, (300, 560), (340, 520))
            f = shape(a, 0)
            check(f['x'] == 440 and f['y'] == 520, 'drag moves the box by snapped delta')
            check(a.eval(A + '.undo()') and shape(a, 0)['x'] == 400 and shape(a, 0)['y'] == 560, 'one drag = one undo')

            # Resize by the SE corner handle: opposite corner stays.
            drag(a, (800, 580), (816, 600))
            f = shape(a, 0)
            check(f['w'] == 816 and f['h'] == 56 and f['x'] - f['w'] / 2 == 0 and f['y'] - f['h'] / 2 == 540, 'corner handle resizes, opposite corner fixed')

            # Polygon vertex drag.
            a.eval(A + '.ops.select(1);1'); a.step(1)
            drag(a, (200, 270), (200, 251))
            check(shape(a, 1)['points'][5] == -48, 'polygon vertex follows the mouse (local, snapped)')
            a.eval(A + '.ops.action("vertex:add");1'); a.step(1)
            check(len(shape(a, 1)['points']) == 8, 'add vertex')

            # Physics: real bodies; ball falls and rests on the floor.
            check(a.eval(A + '.ops.physics(true)'), 'physics mode on')
            a.step(1)
            check(a.eval(A + '.ops.bodies()') == 3, 'physics mode builds a body per shape')
            a.eval(A + '.ops.dropBall(400,400);1')
            a.step(120)
            p = a.eval(A + '.ops.ballPos(0)')
            check(p and 480 < p['y'] < 545, 'dropped ball lands on the floor (y=%s)' % (p and round(p['y'])))
            a.eval(A + '.ops.physics(false);1'); a.step(1)
            g = a.eval('$.world.gravity()')
            check(abs(g['x'] - gravity['x']) < 1e-6 and abs(g['y'] - gravity['y']) < 1e-6, 'world gravity restored after physics')

            check(path.read_bytes() == original, 'nothing is written before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            saved = json.loads(path.read_text())
            check(len(saved['shapes']) == 3 and saved['shapes'][0]['w'] == 816, 'saved file has the edits')
            check(not list(root.glob('.r2d-editor-*')), 'validation draft removed')

            # Closing the tab with physics on restores gravity.
            a.eval(A + '.ops.physics(true);' + E + '.closeTab("level.collision.json");1'); a.step(2)
            g = a.eval('$.world.gravity()')
            check(abs(g['y'] - gravity['y']) < 1e-6, 'closing an active physics tab restores gravity')


if __name__ == '__main__':
    sys.exit(main())
