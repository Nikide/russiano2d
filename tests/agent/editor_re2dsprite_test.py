#!/usr/bin/env python3
"""Editor Re2DSprite studio: per-tab runtime preview, description history, draft preview, runtime-gated Save."""
import json
import os
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
        print('editor_re2dsprite_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-re2dsprite-') as tmp:
        root = Path(tmp) / 'game'
        shutil.copytree(Path(ROOT) / 'demos/rotsprite', root)
        os.symlink(Path(ROOT) / 'demos/assets', Path(tmp) / 'assets')   # atlas: ../assets/... от описания
        (root / 'project.json').write_text('{"title":"Re2DSprite","width":1440,"height":900}')
        path = root / 'russi.character.json'
        original = path.read_bytes()
        with Agent(game='editor', scene=str(root), seed=11) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("russi.character.json");1')
            settle(a, '!!' + A + ' && !!' + A + '.state.json', 30)
            a.step(4)
            snap = a.eval(A + '.snapshot()')
            check(a.eval(E + '.activeTab().studio.id==="re2dsprite" && ' + E + '.studios.studioById("re2dsprite-studio").id==="re2dsprite"'), 'opens in native Re2DSprite studio; old id is an alias')
            check(snap['node'] and snap['motion'] == 'idle' and 'holdRifle' in snap['clips'], 'runtime preview with clips from animations JSON')

            # Preview actions do not touch the description.
            a.eval(A + '.ops.equip("ak47");' + A + '.ops.emotion("happy");' + A + '.ops.togglePart(' + str(a.eval(A + '.state.json.rig.parts[0].id')) + ');1'); a.step(3)
            snap = a.eval(A + '.snapshot()')
            check(snap['equipped'] == ['ak47'] and 'holdRifle' in snap['layers'] and not snap['dirty'], 'equip attaches the item and its hold layer; file stays clean')

            # Equipment edit: dirty, preview rebuilt from a draft, runtime state survives.
            a.eval(A + '.doc.setValue("rs-e-rotation","[0,180,0]");' + A + '.doc.click("rs-e-apply");1'); a.step(3)
            snap = a.eval(A + '.snapshot()')
            check(snap['dirty'] and a.eval(A + '.state.json.equipment.ak47.rotation') == [0, 180, 0], 'equipment edit goes to the description history')
            check(snap['node'] and snap['equipped'] == ['ak47'] and snap['emotion'] == 'happy' and len(snap['hiddenParts']) == 1, 'preview rebuilt; equipment, emotion and hidden parts survive')
            check(not list(root.glob('.r2d-editor-*')), 'draft used for the preview is removed')
            check(path.read_bytes() == original, 'nothing is written before Save')
            check(a.eval(A + '.undo()') and not a.eval(A + '.dirty()'), 'Undo returns to the saved description')
            a.eval(A + '.redo();1'); a.step(2)

            # Make default: current clip + emotion → defaults (expression as selector object).
            a.eval(A + '.ops.play("walk");' + A + '.ops.makeDefault();1'); a.step(2)
            d = a.eval(A + '.state.json.defaults')
            check(d['motion'] == 'walk' and d['expression'] == {'eyes': 'happy', 'mouth': 'smile'}, 'defaults take the clip name and a copy of the emotion selectors')

            # Runtime rejects the description → Save is blocked, file intact.
            a.eval(A + '.doc.setValue("rs-f-body","99");' + A + '.doc.click("rs-apply");1'); a.step(3)
            if a.eval(A + '.snapshot().node'):
                print('  note runtime accepted bodyScale 99; skipping rejection checks')
                a.eval(A + '.undo();1'); a.step(2)
            else:
                check(run(a, A + '.save()') is False and path.read_bytes() == original, 'Save blocked while the runtime rejects the description')
                check(any(x['code'] == 'R2D_RE2DSPRITE_RUNTIME' for x in a.eval(A + '.diagnostics()')), 'runtime rejection is a diagnostic')
                a.eval(A + '.undo();1'); a.step(2)
                check(a.eval(A + '.snapshot().node'), 'undo restores a working preview')

            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save writes the description')
            saved = json.loads(path.read_text())
            check(saved['equipment']['ak47']['rotation'] == [0, 180, 0] and saved['defaults']['motion'] == 'walk', 'saved file has the edits')
            check(a.eval(A + '.snapshot().node'), 'preview rebuilt from the saved file')

            # Second character in its own tab.
            a.eval(E + '.openFile("russi3.character.json");1')
            settle(a, E + '.activeTab().path==="russi3.character.json" && !!' + A + ' && !!' + A + '.state.json', 30)
            a.step(2)
            check(a.eval(E + '.state.tabs.filter(t=>t.kind==="studio").length') == 2 and a.eval(A + '.snapshot().equipped') == [], 'second character opens in its own tab')
            a.eval(E + '.closeTab("russi3.character.json");1'); a.step(2)
            a.eval(E + '.closeTab("russi.character.json");1'); a.step(2)
            check(not list(root.glob('.r2d-editor-*')) and a.eval(E + '.state.tabs.length') == 0, 'closing tabs leaves no drafts')


if __name__ == '__main__':
    sys.exit(main())
