#!/usr/bin/env python3
"""Editor Particles studio: live <particles>, sections, presets, ramp graph by mouse, one drag = one undo, validated Save."""
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
        print('editor_particles_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def to_points(a, p):
    """RmlUi pixels → logical window points for the agent mouse."""
    k = a.eval('$.window.pixels().w/$.window.size().w')
    return p['x'] / k, p['y'] / k


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-particles-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Particles","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        spec = {'version': 1, 'name': 'fire', 'amount': 32, 'lifetime': [400, 900], 'speed': [20, 70], 'direction': -90,
                'spread': 26, 'size': [12, 22], 'alpha_ramp': [{'t': 0, 'alpha': 1}, {'t': 1, 'alpha': 0}], 'blend': 'add', 'seed': 7}
        path = root / 'fx.particles.json'
        path.write_text(json.dumps(spec))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=5) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("fx.particles.json");1')
            settle(a, '!!' + A + ' && !!' + A + '.state.data')
            a.step(30)
            check(a.eval(E + '.activeTab().studio.id==="particles" && ' + E + '.studios.studioById("particle-studio").id==="particles"'), 'opens in native Particles studio; old id is an alias')
            check(a.eval(A + '.snapshot().node && ' + A + '.ops.count()>0'), 'live <particles> node emits')
            check(a.eval(A + '.diagnostics().length') == 0, 'no diagnostics on a valid emitter')

            # Section form: range written as [lo, hi], equal values collapse, empty optional removed.
            a.eval(A + '.ops.select(1);1'); a.step(2)
            a.eval(A + '.doc.setValue("f-speed-0","50");' + A + '.doc.setValue("f-speed-1","50");' + A + '.doc.setValue("f-spread","");' + A + '.doc.click("aw-apply");1'); a.step(2)
            check(a.eval(A + '.state.data.speed') == 50 and a.eval('!("spread" in ' + A + '.state.data)'), 'range collapses equal values; cleared optional is removed')
            check(a.eval('!("gravity" in ' + A + '.state.data) && !("angle" in ' + A + '.state.data)'), 'untouched absent fields stay absent')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.data.spread') == 26, 'form Apply is one undo step')

            # Ramp graph: click on empty area adds a point.
            a.eval(A + '.ops.rampKind("alpha");1'); a.step(3)
            box = a.eval(A + '.doc.layoutRect("pt-graph")')
            x, y = to_points(a, {'x': box['x'] + box['w'] / 2, 'y': box['y'] + box['h'] / 2})
            a.mouse_move(x=x, y=y); a.step(1); a.mouse(1, 'click'); a.step(3)
            ramp = a.eval(A + '.ops.ramp("alpha")')
            check(len(ramp) == 3 and abs(ramp[1]['t'] - 0.5) < 0.05, 'click on graph adds a ramp point at t≈0.5')
            # Drag the new point: one history step.
            p = a.eval(A + '.ops.graphPoint("alpha",1)')
            x, y = to_points(a, p)
            a.mouse_move(x=x, y=y); a.step(1); a.mouse(1, 'down'); a.step(1)
            for i in range(1, 6):
                a.mouse_move(x=x + 8 * i, y=y - 6 * i); a.step(1)
            a.mouse(1, 'up'); a.step(3)
            moved = a.eval(A + '.ops.ramp("alpha")')
            check(moved[1]['t'] > ramp[1]['t'] and moved[1]['alpha'] > ramp[1]['alpha'], 'dragging moves the point in t and value')
            check(a.eval(A + '.undo()') and abs(a.eval(A + '.ops.ramp("alpha")')[1]['t'] - ramp[1]['t']) < 1e-6, 'whole drag is undone at once')
            check(a.eval(A + '.ops.removePoint("alpha",1)') and len(a.eval(A + '.ops.ramp("alpha")')) == 2, 'point removal')
            check(not a.eval(A + '.ops.removePoint("alpha",0) && ' + A + '.ops.removePoint("alpha",0)'), 'last ramp point is never removed')

            # Presets and transport.
            check(a.eval(A + '.ops.preset("sparks")') and a.eval(A + '.state.data.name') == 'fire', 'preset replaces parameters but keeps the name')
            a.step(2)
            before = a.eval(A + '.ops.count()')
            a.eval(A + '.ops.action("burst");1')
            check(a.eval(A + '.ops.count()') >= before + 30, 'Burst adds particles to the live node')
            a.eval(A + '.ops.action("emit");1'); a.step(1)
            check(a.eval('!' + A + '.snapshot().emitting'), 'Emission toggle')
            a.eval(A + '.ops.action("emit");1')

            # Dragging in the canvas moves the emitter (not the data).
            c = a.eval(A + '.doc.layoutRect("aw-canvas")')
            x, y = to_points(a, {'x': c['x'] + c['w'] * 0.25, 'y': c['y'] + c['h'] * 0.3})
            a.mouse_move(x=x, y=y); a.step(1); a.mouse(1, 'down'); a.step(2); a.mouse(1, 'up'); a.step(1)
            at = a.eval(A + '.ops.emitter()')
            check(abs(at['x'] - x) < 2 and abs(at['y'] - y) < 2, 'canvas drag moves the emitter preview')
            a.eval(A + '.ops.action("center");1')

            check(path.read_bytes() == original, 'nothing is written before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            saved = json.loads(path.read_text())
            check(saved['name'] == 'fire' and saved != spec, 'saved file holds the preset edit')
            check(not list(root.glob('.r2d-editor-*')), 'validation draft removed')


if __name__ == '__main__':
    sys.exit(main())
