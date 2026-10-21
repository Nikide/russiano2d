#!/usr/bin/env python3
"""Editor detects external code-file changes before overwriting the disk."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from editor_hammer_test import run, settle

E = '$.editorApp'
D = '$.ui.doc("ui/editor.rml")'
checks = 0


def check(value, label):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + label, flush=True)
    if not value:
        raise AssertionError(label)


def main():
    state = ROOT / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        with tempfile.TemporaryDirectory(prefix='r2d-external-change-') as directory:
            project = Path(directory)
            (project / 'project.json').write_text(json.dumps({
                'format': 2, 'title': 'External change fixture', 'entry': 'main.js',
            }))
            source = '$.ready(() => {});\n'
            main_js = project / 'main.js'
            main_js.write_text(source)
            with Agent(game='editor', scene=str(project), seed=5) as agent:
                settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
                agent.eval(E + '.activeTab().model.insert("// editor version\\n");1')
                external_v1 = '// external version one\n' + source
                main_js.write_text(external_v1)
                saved = run(agent, E + '.save()')
                check(saved is False and agent.eval(E + '.state.fileConflict.diskText!==null'),
                      'Save detects an external edit and opens a version choice')
                check(main_js.read_text() == external_v1 and
                      agent.eval(E + '.activeTab().model.dirty'),
                      'detecting the conflict preserves the disk version and dirty Editor buffer')

                agent.eval(D + '.click("file-conflict-cancel");1'); agent.step(2)
                check(agent.eval(E + '.state.fileConflict===null && ' + E + '.activeTab().model.dirty') and
                      main_js.read_text() == external_v1,
                      'Cancel leaves both versions intact')

                run(agent, E + '.save()')
                agent.eval(D + '.click("file-conflict-reload");1')
                settle(agent, E + '.state.fileConflict===null && !' + E + '.activeTab().model.dirty')
                check(agent.eval(E + '.activeTab().model.text()===' + json.dumps(external_v1)),
                      'Reload replaces the buffer with the external version and clears dirty')

                agent.eval(E + '.activeTab().model.setCaret({line:0,col:0});' +
                           E + '.activeTab().model.insert("// editor version two\\n");1')
                external_v2 = '// external version two\n' + source
                main_js.write_text(external_v2)
                run(agent, E + '.save()')
                check(agent.eval(E + '.state.fileConflict.diskText!==null'),
                      'a subsequent external change is detected independently')
                agent.eval(D + '.click("file-conflict-overwrite");1')
                settle(agent, E + '.state.fileConflict===null && !' + E + '.activeTab().model.dirty')
                local_v2 = '// editor version two\n' + external_v1
                check(main_js.read_text() == local_v2,
                      'explicit overwrite writes the Editor version and marks it saved')

                agent.eval(E + '.activeTab().model.setCaret({line:0,col:0});' +
                           E + '.activeTab().model.insert("// recreate\\n");1')
                main_js.unlink()
                run(agent, E + '.save()')
                check(agent.eval(E + '.state.fileConflict.diskText===null'),
                      'deletion is reported as an external conflict rather than a silent write')
                agent.eval(D + '.click("file-conflict-overwrite");1')
                settle(agent, E + '.state.fileConflict===null && !' + E + '.activeTab().model.dirty')
                check(main_js.read_text() == '// recreate\n' + local_v2,
                      'explicit recreate restores the Editor version after external deletion')
        print(f'editor_external_change_test: {checks} checks', flush=True)
        return 0
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == '__main__':
    raise SystemExit(main())
