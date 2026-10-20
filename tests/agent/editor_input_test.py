#!/usr/bin/env python3
"""Editor Input studio: live tester via real $.input bindings, capture by key press, conflicts, restore bindings, validated Save."""
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
        print('editor_input_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-input-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Input","width":1440,"height":900}')
        (root / 'main.js').write_text('$.ready(() => {});')
        data = {'version': 1, 'deadzone': 0.25, 'actions': {'jump': ['space', 'w'], 'left': ['a', 'left'], 'fire': ['j']}}
        path = root / 'controls.input.json'
        path.write_text(json.dumps(data))
        (root / 'other.input.json').write_text(json.dumps({'version': 1, 'actions': {'menu': ['escape']}}))
        original = path.read_bytes()
        with Agent(game='editor', scene=tmp, seed=10) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval('$.input.bind("__probe", ["k"]);1')
            before = a.eval('JSON.stringify($.input.bindings())')
            dz = a.eval('$.input.deadzone()')
            a.eval(E + '.openFile("controls.input.json");1')
            settle(a, '!!' + A + ' && !!' + A + '.state.data')
            a.step(3)
            check(a.eval(E + '.activeTab().studio.id==="input" && ' + E + '.studios.studioById("input-tools").id==="input"'), 'opens in native Input studio; old id is an alias')
            check(sorted(a.eval('Object.keys($.input.bindings())')) == ['fire', 'jump', 'left'] and abs(a.eval('$.input.deadzone()') - 0.25) < 1e-9, 'file bindings and deadzone are live in $.input')

            # Tester lights the action through the runtime.
            a.key('space', 'down'); a.step(3)
            check(a.eval(A + '.ops.lit()') == ['jump'], 'holding space lights "jump"')
            a.key('space', 'up'); a.step(3)
            check(a.eval(A + '.ops.lit()') == [], 'release clears the light')

            # Capture: next key press is added to the selected action (one undo).
            a.eval(A + '.ops.select(2);' + A + '.ops.capture(true);1'); a.step(1)
            a.key('k', 'tap'); a.step(3)
            check(a.eval(A + '.state.data.actions.fire') == ['j', 'k'] and not a.eval(A + '.snapshot().capturing'), 'captured key is added and capture ends')
            check(a.eval(A + '.undo()') and a.eval(A + '.state.data.actions.fire') == ['j'], 'capture is one undo step')

            # Conflict detection: same key on two actions.
            a.eval(A + '.ops.addKey("fire","w");1'); a.step(1)
            check(a.eval(A + '.ops.conflicts()') == {'w': ['jump', 'fire']}, 'shared key reported as conflict')
            check(any(d['code'] == 'SDK_INPUT_CONFLICT' for d in a.eval(A + '.diagnostics()')), 'kind validation reports the conflict too')
            a.eval(A + '.undo();1')

            # Rename via inspector; last key cannot be removed.
            a.eval(A + '.ops.select(0);1'); a.step(1)
            a.eval(A + '.doc.setValue("f-__name","hop");' + A + '.doc.click("aw-apply");1'); a.step(2)
            check(list(a.eval(A + '.state.data.actions').keys()) == ['hop', 'left', 'fire'], 'rename keeps action order')
            check(not a.eval(A + '.ops.select(2);' + A + '.ops.removeKey("fire",0)'), 'last key of an action is protected')

            # Two input files open side by side (no shared legacy document).
            a.eval(E + '.openFile("other.input.json");1')
            settle(a, E + '.activeTab().path==="other.input.json" && !!' + A + ' && !!' + A + '.state.data')
            a.step(2)
            check(a.eval(E + '.state.tabs.filter(t=>t.kind==="studio").length') == 2, 'two Input tabs coexist')
            check(sorted(a.eval('Object.keys($.input.bindings())')) == ['menu'], 'active tab owns the live bindings')
            a.eval(E + '.closeTab("other.input.json");1'); a.step(2)
            settle(a, E + '.activeTab().path==="controls.input.json"')

            check(path.read_bytes() == original, 'nothing is written before Save')
            check(run(a, A + '.save()') is True and not a.eval(A + '.dirty()'), 'Save validates and writes')
            check('hop' in json.loads(path.read_text())['actions'], 'saved file has the rename')
            a.eval(E + '.closeTab("controls.input.json");1'); a.step(2)
            check(a.eval('JSON.stringify($.input.bindings())') == before and abs(a.eval('$.input.deadzone()') - dz) < 1e-9, 'closing restores previous bindings and deadzone')


if __name__ == '__main__':
    sys.exit(main())
