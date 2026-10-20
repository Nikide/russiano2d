#!/usr/bin/env python3
"""Editor studios ask for files through OS windows ($.fs.pickFile/saveFile, mocked here):
paths come back project-relative, files outside the project are refused with a diagnostic, cancel changes nothing."""
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
    state = Path(ROOT) / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        test()
        print('editor_file_dialogs_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


def answer(a, fn, value):
    """Next answer of $.fs.<fn>: a path, None (cancel)."""
    a.eval('$.fs.' + fn + '=(o)=>{globalThis.lastPick=o;return Promise.resolve(' + json.dumps(value) + ');};1')


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-dialogs-') as tmp, tempfile.TemporaryDirectory(prefix='r2d-outside-') as outside:
        root = Path(tmp)
        for d in ['assets', 'story', 'sfx']:
            (root / d).mkdir()
        (root / 'project.json').write_text('{"title":"Dialogs"}')
        (root / 'main.js').write_text('$.ready(() => {});')
        shutil.copyfile(Path(ROOT) / 'demos/sdk_showcase/assets/tiles.png', root / 'assets/tiles.png')
        shutil.copyfile(Path(ROOT) / 'demos/sdk_showcase/assets/tiles.png', root / 'assets/other.png')
        shutil.copyfile(Path(ROOT) / 'demos/sdk_showcase/assets/tiles.png', Path(outside) / 'far.png')
        (root / 'sfx/hit.wav').write_bytes(b'RIFF')
        grid = [[0] * 4 for _ in range(3)]
        (root / 'a.tilemap.json').write_text(json.dumps({'version': 1, 'tile': 64, 'src': 'assets/tiles.png', 'cols': 4, 'solid': [],
                                                         'layers': [{'name': 'g', 'depth': 0, 'data': grid}]}))
        (root / 'b.audio.json').write_text(json.dumps({'version': 1, 'buses': {}, 'sounds': {}}))
        (root / 'story/a.scene').write_text('# A\n:start\n~ Hi.\nend\n')
        with Agent(game='editor', scene=tmp, seed=6) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')

            # Tilemap: «…» at the tileset field.
            a.eval(E + '.openFile("a.tilemap.json");1')
            settle(a, '!!' + A + ' && !!' + A + '.state.data')
            answer(a, 'pickFile', str(root / 'assets/other.png'))
            run(a, A + '.ops.browse("browse:d:src")')
            check(a.eval(A + '.state.data.src') == 'assets/other.png', 'tileset «…» stores a project-relative path and applies it')
            check('png' in a.eval('globalThis.lastPick.filters[0].ext') and a.eval('globalThis.lastPick.path').endswith('assets/tiles.png'),
                  'window opens at the current file with an image filter')
            answer(a, 'pickFile', str(Path(outside) / 'far.png'))
            run(a, A + '.ops.browse("browse:d:src")')
            check(a.eval(A + '.state.data.src') == 'assets/other.png', 'file outside the project is not taken')
            check(any(d['code'] == 'EDITOR_ASSET_FILE' for d in a.eval(A + '.state.file.diagnostics()')), 'outside file → EDITOR_ASSET_FILE')
            answer(a, 'pickFile', None)
            run(a, A + '.ops.browse("browse:d:src")')
            check(a.eval(A + '.state.data.src') == 'assets/other.png', 'cancel changes nothing')

            # Audio: «+ Звук из файла…».
            a.eval(E + '.openFile("b.audio.json");1')
            settle(a, E + '.activeTab().path==="b.audio.json" && !!' + A + ' && !!' + A + '.state.data')
            answer(a, 'pickFile', str(root / 'sfx/hit.wav'))
            a.eval(A + '.ops.action("snd:pick");1')
            settle(a, 'Object.keys(' + A + '.state.data.sounds||{}).length===1')
            check(list(a.eval(A + '.state.data.sounds').values())[0]['path'] == 'sfx/hit.wav', 'audio: sound added from the chosen file')

            # Narrative: asset «…» and «Новая сцена…».
            a.eval(E + '.openFile("story/a.scene");1')
            settle(a, E + '.activeTab().path==="story/a.scene" && !!' + A)
            answer(a, 'pickFile', str(root / 'assets/other.png'))
            check(run(a, A + '.ops.browseAsset("asset")') is True, 'narrative: asset picked through the window')
            answer(a, 'saveFile', str(root / 'story/intro'))
            run(a, A + '.ops.browseNewScene()')
            check((root / 'story/intro.scene').exists(), 'narrative: new scene saved where chosen, .scene added')

            # Palette: «Файл: открыть с диска…».
            answer(a, 'pickFile', str(root / 'main.js'))
            run(a, E + '.openFileDialog()')
            check(a.eval(E + '.activeTab().path') == 'main.js', 'palette: open file from disk')


if __name__ == '__main__':
    sys.exit(main())
