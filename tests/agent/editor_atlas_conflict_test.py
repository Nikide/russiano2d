#!/usr/bin/env python3
"""Atlas Studio validates drafts before publish and resolves external edits."""
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run
from sdk_sprite_mesh_test import png

E = '$.editorApp'
A = E + '.activeTab().inst'
checks = 0


def check(value, text):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + text, flush=True)
    if not value:
        raise AssertionError(text)


def main():
    recents = Path(ROOT) / 'state.local.json'
    previous = recents.read_bytes() if recents.exists() else None
    try:
        test()
        print('editor_atlas_conflict_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-editor-atlas-conflict-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Atlas conflict","width":1280,"height":720}')
        (root / 'main.js').write_text('$.ready(()=>{});')
        png(str(root / 'sheet.png'), [(255, 255, 255, 255)])
        atlas = root / 'hero.atlas.json'
        original = {'meta': {'image': 'sheet.png', 'size': {'w': 1, 'h': 1}},
                   'frames': {'idle': {'frame': {'x': 0, 'y': 0, 'w': 1, 'h': 1}, 'duration': 100}}}
        atlas.write_text(json.dumps(original, indent=2) + '\n')
        with Agent(game='editor', scene=tmp, seed=5) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            run(a, E + '.openWith("hero.atlas.json","atlas")')
            settle(a, A + '.snapshot().file.endsWith("hero.atlas.json")')
            check(not a.eval(A + '.dirty()'), 'opening atlas starts clean with an exact save baseline')
            baseline = atlas.read_bytes()
            a.eval(A + '.ops.edit("invalid bounds",d=>{d.frames[0].x=-2});1')
            check(run(a, A + '.save()') is False and atlas.read_bytes() == baseline and a.eval(A + '.dirty()'),
                  'native validation rejects an invalid draft before publishing and keeps it dirty')
            a.eval(A + '.undo();1')
            a.eval(A + '.ops.edit("rename",d=>{d.frames[0].name="editor"});1')
            external = {'meta': {'image': 'sheet.png', 'size': {'w': 1, 'h': 1}, 'custom': {'external': True}},
                        'frames': {'idle': {'frame': {'x': 0, 'y': 0, 'w': 1, 'h': 1}, 'duration': 100}}}
            atlas.write_text(json.dumps(external, indent=2) + '\n')
            check(run(a, A + '.save()') is False and json.loads(atlas.read_text()) == external,
                  'Save stops on an external change without touching either version')
            check(a.eval(A + '.doc.content("at-conflict").includes("Перезагрузить") && ' + A + '.doc.content("at-conflict").includes("Перезаписать") && ' + A + '.doc.content("at-conflict").includes("Отмена")'),
                  'conflict dialog offers Reload, Overwrite, and Cancel')
            check(a.eval(A + '.dirty()'), 'external conflict preserves unsaved Atlas history')
            check(run(a, A + '.ops.resolveConflict("cancel")') and a.eval(A + '.dirty()'), 'Cancel closes the dialog and keeps Editor edits')
            check(run(a, A + '.save()') is False and run(a, A + '.ops.resolveConflict("reload")') and
                  not a.eval(A + '.dirty()') and a.eval(A + '.ops.model().frames[0].name==="idle"'),
                  'Reload adopts the current external atlas and clears dirty state')

            a.eval(A + '.ops.edit("rename",d=>{d.frames[0].name="editor2"});1')
            external2 = {'meta': {'image': 'sheet.png', 'size': {'w': 1, 'h': 1}, 'custom': {'external': 2}},
                         'frames': {'idle': {'frame': {'x': 0, 'y': 0, 'w': 1, 'h': 1}, 'duration': 100}}}
            atlas.write_text(json.dumps(external2, indent=2) + '\n')
            check(run(a, A + '.save()') is False, 'later external version is detected')
            external3 = dict(external2); external3['meta'] = dict(external2['meta'], custom={'external': 3})
            atlas.write_text(json.dumps(external3, indent=2) + '\n')
            check(run(a, A + '.ops.resolveConflict("overwrite")') is False and json.loads(atlas.read_text()) == external3,
                  'Overwrite refuses a second disk change after the dialog opened')
            check(run(a, A + '.ops.resolveConflict("overwrite")') and not a.eval(A + '.dirty()') and
                  json.loads(atlas.read_text())['frames']['editor2']['frame']['w'] == 1,
                  'explicit Overwrite rechecks disk and publishes the validated Editor atlas')
            a.eval(A + '.doc.setValue("at-g-cols","1");' + A + '.doc.setValue("at-g-rows","1");1')
            check(run(a, A + '.ops.slice()') and a.eval(A + '.snapshot().dirty && ' + A + '.ops.model().frames.length===1'),
                  'native grid slicing records its result as one undoable dirty edit')


if __name__ == '__main__':
    sys.exit(main())
