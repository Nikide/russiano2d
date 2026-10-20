#!/usr/bin/env python3
"""Editor Save / Save All: code tabs and studio tabs, dirty close needs confirmation."""
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
        print('editor_save_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def tab(path):
    return E + '.state.tabs.find(t=>t.path===' + json.dumps(path) + ')'


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-editor-save-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"Save","width":1280,"height":720}')
        (root / 'main.js').write_text('$.ready(() => {});\n')
        a_json = {'version': 1, 'actions': {'jump': ['space']}}
        (root / 'a.input.json').write_text(json.dumps(a_json))
        (root / 'b.input.json').write_text(json.dumps(a_json))
        with Agent(game='editor', scene=tmp, seed=3) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')

            # Code: clean Save does not rewrite the file; dirty Save writes it.
            a.eval(E + '.openFile("main.js");1'); a.step(2)
            before = (root / 'main.js').stat().st_mtime_ns
            check(run(a, E + '.save()') is True and (root / 'main.js').stat().st_mtime_ns == before, 'clean code Save is a no-op success')
            a.eval(E + '.activeTab().model.insert("// x\\n");1')
            check(run(a, E + '.save()') is True and (root / 'main.js').read_text().startswith('// x'), 'dirty code Save writes the file')

            # Two native studio tabs, both dirty: Save All saves every tab.
            for name in ('a.input.json', 'b.input.json'):
                a.eval(E + '.openFile("' + name + '");1')
                settle(a, E + '.activeTab().path==="' + name + '" && !!' + tab(name) + '.inst && !!' + tab(name) + '.inst.state.data')
                a.eval(tab(name) + '.inst.ops.addKey("jump","f");1'); a.step(2)
            check(a.eval(E + '.studios.dirty(' + tab('a.input.json') + ') && ' + E + '.studios.dirty(' + tab('b.input.json') + ')'), 'both studio tabs are dirty')
            check(run(a, E + '.saveAll()') is True, 'Save All reports success')
            for name in ('a.input.json', 'b.input.json'):
                check(json.loads((root / name).read_text())['actions']['jump'] == ['space', 'f'], 'Save All wrote ' + name)
            check(not a.eval(E + '.studios.dirty(' + tab('a.input.json') + ')'), 'tabs clean after Save All')

            # Closing a dirty tab needs a second request; the first one keeps it.
            a.eval(tab('b.input.json') + '.inst.ops.addKey("jump","g");1'); a.step(2)
            a.eval(E + '.closeTab("b.input.json");1'); a.step(1)
            check(a.eval('!!' + tab('b.input.json')), 'first close of a dirty tab is refused')
            a.eval(E + '.closeTab("b.input.json");1'); a.step(1)
            check(a.eval('!' + tab('b.input.json')) and json.loads((root / 'b.input.json').read_text())['actions']['jump'] == ['space', 'f'], 'second close discards unsaved edits without writing')


if __name__ == '__main__':
    sys.exit(main())
