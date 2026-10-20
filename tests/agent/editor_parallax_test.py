#!/usr/bin/env python3
"""Editor Parallax studio: real $.layers preview, parallax-correct picking, drag = one undo, image library, validated Save."""
import json
from pathlib import Path
import shutil
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
        print('editor_parallax_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-parallax-') as tmp:
        root = Path(tmp)
        (root / 'assets').mkdir()
        (root / 'project.json').write_text('{"title":"Parallax","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        shutil.copyfile(Path(ROOT) / 'demos/sdk_showcase/assets/tiles.png', root / 'assets/tiles.png')
        data = {'version': 1, 'layers': [
            {'name': 'far', 'order': -30, 'parallax': 0.2, 'sprites': [{'src': 'assets/tiles.png', 'x': 0, 'y': 0, 'w': 64, 'h': 64}]},
            {'name': 'near', 'order': -10, 'parallax': 0.8, 'sprites': [{'src': 'assets/tiles.png', 'x': 100, 'y': 40, 'w': 48, 'h': 48}]}]}
        path = root / 'bg.layers.json'
        path.write_text(json.dumps(data))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=7) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("bg.layers.json");1')
            settle(a, '!!' + A + ' && ' + A + '.ops.images()!==null')
            a.step(4)
            check(a.eval(E + '.activeTab().studio.id==="parallax" && ' + E + '.studios.studioById("parallax-tools").id==="parallax"'), 'opens in native Parallax studio; old id is an alias')
            check(a.eval(A + '.ops.runtimeLayers()') == 2, 'two real $.layers layers are created')
            check(a.eval(A + '.ops.images()') == ['assets/tiles.png'], 'image library lists project PNGs via r2d assets')

            # Panning moves each layer by camera × parallax (runtime offset).
            r_far0, r_near0 = a.eval(A + '.ops.screenRect(0,0)'), a.eval(A + '.ops.screenRect(1,0)')
            a.eval(A + '.ops.pan(100,0);1'); a.step(2)
            r_far1, r_near1 = a.eval(A + '.ops.screenRect(0,0)'), a.eval(A + '.ops.screenRect(1,0)')
            check(abs((r_far0['x'] - r_far1['x']) - 20) < 0.6 and abs((r_near0['x'] - r_near1['x']) - 80) < 0.6,
                  'pan shifts far by 20px and near by 80px (parallax 0.2 / 0.8)')

            # Pick and drag the near sprite in the preview: one undo step.
            r = a.eval(A + '.ops.screenRect(1,0)')
            a.mouse_move(x=r['cx'], y=r['cy']); a.step(1); a.mouse(1, 'down'); a.step(1)
            for i in range(1, 5):
                a.mouse_move(x=r['cx'] + 10 * i, y=r['cy'] + 5 * i); a.step(1)
            a.mouse(1, 'up'); a.step(2)
            s = a.eval(A + '.state.data.layers[1].sprites[0]')
            check(a.eval(A + '.state.selected') == 1 and a.eval(A + '.snapshot().sprite') == 0, 'click picks the sprite and its layer')
            check(s['x'] == 140 and s['y'] == 60, 'drag moves the sprite by the mouse delta')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.data.layers[1].sprites[0].x') == 100, 'one drag = one undo')

            # Dragging the background pans the camera, not the data.
            c = a.eval(A + '.doc.layoutRect("aw-canvas")')
            pan0 = a.eval(A + '.snapshot().pan.x')
            a.mouse_move(x=c['x'] + c['w'] - 30, y=c['y'] + c['h'] - 30); a.step(1); a.mouse(1, 'down'); a.step(1)
            a.mouse_move(x=c['x'] + c['w'] - 90, y=c['y'] + c['h'] - 30); a.step(1); a.mouse(1, 'up'); a.step(1)
            check(a.eval(A + '.snapshot().pan.x') == pan0 + 60 and not a.eval(A + '.dirty()'), 'background drag pans the camera only')

            # Library image → sprite in the selected layer; row of copies.
            a.eval(A + '.ops.action("image:assets/tiles.png");1'); a.step(2)
            check(len(a.eval(A + '.state.data.layers[1].sprites')) == 2, 'library click adds a sprite to the selected layer')
            a.eval(A + '.ops.selectSprite(0);1'); a.step(1)
            a.eval(A + '.doc.setValue("px-count","2");' + A + '.ops.action("sprite:row");1'); a.step(2)
            sp = a.eval(A + '.state.data.layers[1].sprites')
            check(len(sp) == 4 and sp[2]['x'] == 148 and sp[3]['x'] == 196, 'row of copies is laid out edge to edge')

            # Layer order and global tint.
            a.eval(A + '.ops.select(1);' + A + '.ops.action("layer:up");1'); a.step(2)
            check(a.eval(A + '.state.data.layers[0].name') == 'near' and a.eval(A + '.state.selected') == 0, 'layer moved up keeps selection')
            a.eval(A + '.doc.setValue("px-mcolor","#102040");' + A + '.doc.setValue("px-malpha","0.3");' + A + '.ops.action("modulate");1'); a.step(1)
            check(a.eval(A + '.state.data.modulate') == {'color': '#102040', 'alpha': 0.3}, 'global tint written as {color, alpha}')

            check(path.read_bytes() == original, 'nothing is written before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            saved = json.loads(path.read_text())
            check(saved['layers'][0]['name'] == 'near' and len(saved['layers'][0]['sprites']) == 4, 'saved file has the edits')
            a.eval(E + '.closeTab("bg.layers.json");1'); a.step(2)
            check(a.eval('$.layers.order().filter(l=>l.name.startsWith("__editor_px")).length') == 0, 'closing the tab removes preview layers')


if __name__ == '__main__':
    sys.exit(main())
