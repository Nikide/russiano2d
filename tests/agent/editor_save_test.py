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
D = '$.ui.doc("ui/editor.rml")'
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

            # A later conflict must identify the failed path, keep other saves,
            # and activate the document whose resolution dialog needs attention.
            a.eval(tab('a.input.json') + '.inst.ops.addKey("jump","g");1')
            a.eval(tab('b.input.json') + '.inst.ops.addKey("jump","g");1'); a.step(2)
            b_external = {'version': 1, 'actions': {'jump': ['space', 'external']}}
            (root / 'b.input.json').write_text(json.dumps(b_external))
            check(run(a, E + '.saveAll()') is False and
                  json.loads((root / 'a.input.json').read_text())['actions']['jump'] == ['space', 'f', 'g'] and
                  json.loads((root / 'b.input.json').read_text()) == b_external,
                  'Save All keeps successful writes and does not overwrite a conflicted document')
            check(a.eval(E + '.activeTab().path==="b.input.json" && ' +
                         E + '.state.outputEntries.some(e=>e.source==="editor" && e.text.includes("b.input.json")) && ' +
                         E + '.state.status.includes("b.input.json")'),
                  'Save All names the failed document in status and Output and opens its conflict choices')
            check(run(a, tab('b.input.json') + '.inst.ops.resolveConflict("overwrite")') is True and
                  json.loads((root / 'b.input.json').read_text())['actions']['jump'] == ['space', 'f', 'g'],
                  'Save All failure remains resolvable from the activated studio tab')

            # Run waits for Save All, including dirty resource studio documents.
            a.eval(tab('a.input.json') + '.inst.ops.addKey("jump","i");1'); a.step(2)
            launched = run(a, E + '.run({headless:true,frames:2})')
            check(launched and json.loads((root / 'a.input.json').read_text())['actions']['jump'] == ['space', 'f', 'g', 'i'], 'Run saves dirty resource tabs before launching')
            settle(a, E + '.state.run && !' + E + '.state.run.running')

            # A dirty close offers explicit Save, Discard, and Cancel actions.
            a.eval(tab('b.input.json') + '.inst.ops.addKey("jump","h");1'); a.step(2)
            a.eval(E + '.closeTab("b.input.json");1'); a.step(1)
            check(a.eval(E + '.state.closeRequest==="b.input.json" && ' +
                         D + '.content("close-confirm").includes("Закрыть без сохранения")'),
                  'dirty close opens an explicit three-action confirmation')
            a.eval(D + '.click("close-confirm-cancel");1'); a.step(2)
            check(a.eval('!!' + tab('b.input.json') + ' && ' + tab('b.input.json') + '.inst.dirty() && ' + E + '.state.closeRequest===null') and
                  json.loads((root / 'b.input.json').read_text())['actions']['jump'] == ['space', 'f', 'g'],
                  'Cancel keeps the dirty tab and original file')
            a.eval(E + '.closeTab("b.input.json");1'); a.step(1)
            a.eval(D + '.click("close-confirm-discard");1'); a.step(2)
            check(not a.eval('!!' + tab('b.input.json')) and
                  json.loads((root / 'b.input.json').read_text())['actions']['jump'] == ['space', 'f', 'g'],
                  'Discard closes the tab without writing its edits')

            a.eval(tab('a.input.json') + '.inst.ops.addKey("jump","j");1'); a.step(2)
            a.eval(E + '.closeTab("a.input.json");1'); a.step(1)
            a.tap('Return'); a.step(2)
            settle(a, '!' + tab('a.input.json'))
            check(json.loads((root / 'a.input.json').read_text())['actions']['jump'] == ['space', 'f', 'g', 'i', 'j'],
                  'Save button writes the dirty studio document before closing it')

            denied = root / 'denied.js'
            denied.write_text('$.ready(() => {});\n')
            denied.chmod(0o444)
            a.eval(E + '.openFile("denied.js");1'); a.step(2)
            a.eval(E + '.activeTab().model.insert("// unsaved\\n");1')
            a.eval(E + '.closeTab("denied.js");1'); a.step(1)
            a.eval(D + '.click("close-confirm-save");1'); a.step(2)
            check(a.eval('!!' + tab('denied.js') + ' && ' + tab('denied.js') + '.model.dirty && ' + E + '.state.closeRequest!==null') and
                  denied.read_text() == '$.ready(() => {});\n',
                  'failed Save keeps the dirty tab, original file, and confirmation open')
            a.tap('Escape'); a.step(2)
            check(a.eval(E + '.state.closeRequest===null && ' + tab('denied.js') + '.model.dirty'),
                  'Escape cancels close without clearing the dirty document')
            denied.chmod(0o644)


if __name__ == '__main__':
    sys.exit(main())
