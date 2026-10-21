#!/usr/bin/env python3
"""Editor Tilemap studio: real <tilemap> preview, mouse tools, one stroke = one undo, validated Save."""
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
        print('editor_tilemap_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def move(a, x, y):
    p = a.eval(A + '.ops.cellPoint(%d,%d)' % (x, y))
    a.mouse_move(x=p['x'], y=p['y'])
    a.step(1)


def tile(a, x, y, layer=None):
    return a.eval(A + '.ops.tile(%d,%d%s)' % (x, y, '' if layer is None else ',%d' % layer))


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-tilemap-') as tmp:
        root = Path(tmp)
        (root / 'assets').mkdir()
        (root / 'project.json').write_text('{"title":"Tilemap","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        shutil.copyfile(Path(ROOT) / 'demos/sdk_showcase/assets/tiles.png', root / 'assets/tiles.png')
        grid = [[0] * 8 for _ in range(6)]
        data = {'version': 1, 'tile': 64, 'src': 'assets/tiles.png', 'cols': 4, 'solid': [5],
                'layers': [{'name': 'ground', 'depth': 0, 'data': grid},
                           {'name': 'deco', 'depth': 1, 'data': [[0] * 8 for _ in range(6)]}]}
        path = root / 'a.tilemap.json'
        path.write_text(json.dumps(data))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=4) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("a.tilemap.json");1')
            settle(a, '!!' + A + ' && !!' + A + '.state.data')
            a.step(4)
            check(a.eval(E + '.activeTab().studio.native && ' + E + '.activeTab().studio.id==="tilemap"'), 'tilemap opens in native Tilemap studio')
            check(a.eval(E + '.studios.studioById("tilemap-studio").id==="tilemap"'), 'old SDK id resolves to new studio')
            check(a.eval(A + '.snapshot().previewNodes===1'), 'real <tilemap> preview node is created')
            r = a.eval(A + '.doc.layoutRect("aw-canvas")')
            p = a.eval(A + '.ops.cellPoint(7,5)')
            k = a.eval(E.replace('.editorApp', '') + '.window.pixels().w/$.window.size().w')
            check(p['x'] * k < r['x'] + r['w'] and p['y'] * k < r['y'] + r['h'], 'whole map is fitted inside the canvas')

            # Single click paints one tile; one click = one undo step.
            a.eval(A + '.ops.action("tile:3");1')
            move(a, 1, 1); a.mouse(1, 'click'); a.step(2)
            check(tile(a, 1, 1) == 3 and a.eval(A + '.dirty()'), 'same-frame click paints a tile')
            # Drag stroke over three cells → one history command.
            move(a, 2, 2); a.mouse(1, 'down'); a.step(1)
            move(a, 3, 2); move(a, 4, 2)
            a.mouse(1, 'up'); a.step(2)
            check([tile(a, x, 2) for x in (2, 3, 4)] == [3, 3, 3], 'drag stroke paints every crossed cell')
            check(a.eval(A + '.undo()') and [tile(a, x, 2) for x in (2, 3, 4)] == [0, 0, 0] and tile(a, 1, 1) == 3, 'one stroke is undone as a single command')
            a.eval(A + '.redo();1')

            # Rectangle dragged right-to-left fills the whole box.
            a.eval(A + '.ops.action("tool:rect");' + A + '.ops.action("tile:2");1')
            move(a, 6, 5); a.mouse(1, 'down'); a.step(1)
            move(a, 5, 4); a.mouse(1, 'up'); a.step(2)
            check(all(tile(a, x, y) == 2 for x in (5, 6) for y in (4, 5)), 'reverse rectangle fills the box')
            # Pick takes the tile under the cursor; erase clears it.
            a.eval(A + '.ops.action("tool:pick");1'); move(a, 1, 1); a.mouse(1, 'click'); a.step(2)
            check(a.eval(A + '.state.ext.brush') == 3, 'pick takes tile id')
            a.eval(A + '.ops.action("tool:erase");1'); move(a, 1, 1); a.mouse(1, 'click'); a.step(2)
            check(tile(a, 1, 1) == 0, 'eraser clears tile')
            # Layer switch: paints only on the selected layer.
            a.eval(A + '.ops.select(1);' + A + '.ops.action("tool:brush");1'); a.step(2)
            move(a, 0, 0); a.mouse(1, 'click'); a.step(2)
            check(tile(a, 0, 0, 1) == 3 and tile(a, 0, 0, 0) == 0, 'brush paints the selected layer only')
            a.eval(A + '.doc.click("aw-document-apply");1'); a.step(2)
            check(a.eval('!("terrains" in ' + A + '.state.data) && !("autotile" in ' + A + '.state.data)'), 'absent optional document fields stay absent after Apply')

            a.eval(A + '.doc.setValue("tm-terrain-new-name","grass");' + A + '.ops.action("terrain:add");1'); a.step(2)
            check(a.eval(A + '.state.data.terrains.grass.base') == 3, 'terrain is created from the current brush tile')
            a.eval(A + '.doc.setValue("tm-terrain-name","ground");' + A + '.doc.setValue("tm-terrain-mode","bit16");' +
                   A + '.doc.setValue("tm-terrain-base","2");' + A + '.doc.setValue("tm-terrain-solid","[2]");' +
                   A + '.doc.setValue("tm-terrain-transitions","{\\"0\\":4}");' + A + '.doc.setValue("tm-terrain-border","true");' + A + '.ops.action("terrain:apply");1'); a.step(2)
            terrain = a.eval(A + '.state.data.terrains.ground')
            check(terrain['mode'] == 'bit16' and terrain['base'] == 2 and terrain['transitions'] == {'0': 4} and
                  terrain['border'] is True and 'grass' not in a.eval(A + '.state.data.terrains'),
                  'structured terrain editor applies properties and renames in one edit')
            a.eval(A + '.ops.action("terrain:ground");1'); a.step(2)
            check(a.eval(A + '.state.data.autotile.terrain === "ground"'), 'paint mode activates the selected terrain on the runtime preview')
            a.eval(A + '.doc.setValue("tm-autotile-base","3");' + A + '.doc.setValue("tm-autotile-solid","[2]");' +
                   A + '.doc.setValue("tm-autotile-border","true");' + A + '.ops.action("autotile:apply");1'); a.step(2)
            check(a.eval(A + '.state.data.autotile.base === 3 && ' + A + '.state.data.autotile.solid[0] === 2 && ' +
                         A + '.state.data.autotile.border === true'), 'autotile base, solid set and border use the runtime contract')
            a.eval(A + '.doc.setValue("tm-terrain-transitions","{\\"256\\":4}");' + A + '.ops.action("terrain:apply");1'); a.step(2)
            check(a.eval(A + '.state.data.terrains.ground.transitions["0"] === 4 && ' + A + '.diagnostics()[0].code === "EDITOR_ASSET_ACTION"'),
                  'invalid transition mask is rejected before changing the terrain')

            a.eval(A + '.ops.action("anim:add");1'); a.step(2)
            a.eval(A + '.doc.setValue("tm-anim-tile","4");' + A + '.doc.setValue("tm-anim-frames","4, 5, 6");' +
                   A + '.doc.setValue("tm-anim-fps","8");' + A + '.ops.action("anim:apply");1'); a.step(2)
            check(a.eval(A + '.state.data.animations[0].tile === 4 && ' + A + '.state.data.animations[0].frames.length === 3 && ' +
                         A + '.state.data.animations[0].fps === 8'), 'animation editor writes explicit runtime tile frames and speed')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.data.animations[0].frames.length === 1') and
                  a.eval(A + '.redo()') and a.eval(A + '.state.data.animations[0].frames.length === 3'),
                  'animation settings are independently undoable and redoable')
            check(path.read_bytes() == original, 'edits do not touch the file before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            saved = json.loads(path.read_text())
            check(saved['layers'][0]['data'][2][2:5] == [3, 3, 3] and saved['layers'][1]['data'][0][0] == 3, 'saved file has painted tiles')
            check(not list(root.glob('.r2d-editor-*')), 'validation draft removed')
            a.eval(E + '.closeTab("a.tilemap.json");1'); a.step(2)
            check(a.eval('!' + E + '.state.tabs.length || !' + E + '.state.tabs.some(t=>t.path==="a.tilemap.json")'), 'clean tab closes')


if __name__ == '__main__':
    sys.exit(main())
