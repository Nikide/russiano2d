#!/usr/bin/env python3
"""Shared JSON asset documents offer safe choices for external write conflicts."""
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run

E = '$.editorApp'
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
        print('editor_asset_conflict_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-editor-asset-conflict-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Conflict","width":1280,"height":720}')
        asset = root / 'game.input.json'
        original = {'version': 1, 'actions': {'jump': ['space']}}
        asset.write_text(json.dumps(original))
        with Agent(game='editor', scene=tmp, seed=3) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.openFile("game.input.json");1')
            settle(a, E + '.activeTab().path==="game.input.json" && !!' + E + '.activeTab().inst.ops.resolveConflict')
            tab = E + '.activeTab()'
            a.eval(tab + '.inst.ops.addKey("jump","f");1'); a.step(2)

            external = {'version': 1, 'actions': {'jump': ['space', 'x']}}
            asset.write_text(json.dumps(external))
            check(run(a, E + '.save()') is False and a.eval(tab + '.inst.state.file.state.conflict.disk!==null'),
                  'Save pauses on external modification without writing either version')
            check('Перезагрузить' in a.eval(tab + '.inst.doc.content("aw-conflict")') and
                  'Перезаписать' in a.eval(tab + '.inst.doc.content("aw-conflict")') and
                  'Отмена' in a.eval(tab + '.inst.doc.content("aw-conflict")'),
                  'conflict dialog offers Reload, Overwrite, and Cancel')
            check(a.eval(tab + '.inst.dirty()') and json.loads(asset.read_text()) == external,
                  'conflict keeps Editor edits dirty and external file intact')

            a.eval(tab + '.inst.doc.click("aw-conflict-cancel");1'); a.step(2)
            check(a.eval(tab + '.inst.dirty()') and a.eval(tab + '.inst.state.file.state.conflict===null'),
                  'Cancel button closes the dialog and preserves unsaved Editor edits')
            check(run(a, E + '.save()') is False and a.eval(tab + '.inst.state.file.state.conflict!==null'),
                  'next Save asks again after Cancel')
            check(run(a, tab + '.inst.ops.resolveConflict("reload")') is True and
                  not a.eval(tab + '.inst.dirty()') and json.loads(asset.read_text()) == external,
                  'Reload adopts the current disk version and clears dirty state')

            a.eval(tab + '.inst.ops.addKey("jump","g");1'); a.step(2)
            external2 = {'version': 1, 'actions': {'jump': ['space', 'y']}}
            asset.write_text(json.dumps(external2))
            check(run(a, E + '.save()') is False, 'later external change is detected')
            external3 = {'version': 1, 'actions': {'jump': ['space', 'z']}}
            asset.write_text(json.dumps(external3))
            check(run(a, tab + '.inst.ops.resolveConflict("overwrite")') is False and
                  json.loads(asset.read_text()) == external3 and a.eval(tab + '.inst.dirty()'),
                  'Overwrite refuses a second disk change that happened after the dialog opened')
            check(run(a, tab + '.inst.ops.resolveConflict("overwrite")') is True and
                  json.loads(asset.read_text())['actions']['jump'] == ['space', 'x', 'g'] and
                  not a.eval(tab + '.inst.dirty()'),
                  'explicit Overwrite writes the Editor version after rechecking disk')

            a.eval(tab + '.inst.ops.addKey("jump","h");1'); a.step(2)
            asset.unlink()
            check(run(a, E + '.save()') is False and
                  'файл удалён' in a.eval(tab + '.inst.doc.content("aw-conflict")'),
                  'deleted source is shown as a distinct conflict')
            check(run(a, tab + '.inst.ops.resolveConflict("reload")') is False and
                  a.eval(tab + '.inst.dirty()') and not asset.exists(),
                  'Reload cannot silently discard edits when the source was deleted')
            check(run(a, tab + '.inst.ops.resolveConflict("overwrite")') is True and
                  asset.exists() and 'h' in json.loads(asset.read_text())['actions']['jump'],
                  'explicit Overwrite can recreate a deleted asset')


if __name__ == '__main__':
    sys.exit(main())
