#!/usr/bin/env python3
"""Editor Save / Save All: code tabs, legacy SDK studio tabs, no silent loss on group replacement."""
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

            # Legacy SDK data studio (Input): Save via Editor goes through the studio.
            a.eval(E + '.openFile("a.input.json");1')
            settle(a, '!!' + tab('a.input.json') + '.api && !!' + tab('a.input.json') + '.api.session')
            a.eval(tab('a.input.json') + '.api.run("add", m=>{m.actions.fire=["f"];});1'); a.step(2)
            check(a.eval(E + '.studios.dirty(' + tab('a.input.json') + ')'), 'legacy edit marks tab dirty')

            # Opening another file of the same studio group must not drop A silently.
            a.eval(E + '.openFile("b.input.json");1'); a.step(3)
            check(a.eval('!!' + tab('a.input.json') + ' && !' + tab('b.input.json')), 'dirty A is kept, B is refused')
            check(a.eval(E + '.state.active==="a.input.json"'), 'dirty A is brought to front')

            # Save All saves legacy + reports success.
            check(run(a, E + '.saveAll()') is True, 'Save All reports success')
            saved = json.loads((root / 'a.input.json').read_text())
            check(saved['actions'].get('fire') == ['f'], 'Save All wrote the legacy studio file')
            check(not a.eval(E + '.studios.dirty(' + tab('a.input.json') + ')'), 'legacy tab clean after Save All')

            # Now B may replace A (clean).
            a.eval(E + '.openFile("b.input.json");1')
            settle(a, '!!' + tab('b.input.json') + ' && !' + tab('a.input.json'))
            check(True, 'clean A is replaced by B in the shared group document')


if __name__ == '__main__':
    sys.exit(main())
