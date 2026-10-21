#!/usr/bin/env python3
"""Generic JSON text tabs use native validation on unsaved buffer drafts."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from editor_hammer_test import settle

E = '$.editorApp'
checks = 0


def check(agent, expression, label):
    global checks
    ok = agent.eval(expression)
    checks += 1
    print(('  ok   ' if ok else '  FAIL ') + label, flush=True)
    if not ok:
        raise AssertionError(label)


def check_value(value, label):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + label, flush=True)
    if not value:
        raise AssertionError(label)


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-json-syntax-') as directory:
        project = Path(directory)
        (project / 'project.json').write_text(json.dumps({
            'format': 2, 'title': 'JSON syntax fixture', 'entry': 'main.js',
        }))
        (project / 'main.js').write_text('$.ready(() => {});\n')
        source = '{"enabled": true}\n'
        (project / 'config.json').write_text(source)
        protected_draft = project / '.r2d-editor-json-1.json'
        protected_text = '{"userFile": "keep"}\n'
        protected_draft.write_text(protected_text)
        with Agent(game='editor', scene=str(project), seed=16) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
            agent.eval(E + '.openFile("config.json");1')
            settle(agent, E + '.state.busy===0 && ' + E + '.state.diags.has("config.json")')
            check(agent, '!(' + E + '.state.diags.get("config.json")||[]).some(d=>d.code==="SDK_JSON_PARSE")',
                  'valid JSON opens with no syntax diagnostic')
            check_value(protected_draft.read_text() == protected_text,
                        'validation skips an existing file with its first candidate name')

            agent.eval('(()=>{const m=' + E + '.activeTab().model;m.selectAll();m.insert("{\\\"enabled\\\": }\\n");' + E + '.code.state.onChange();return true;})()')
            agent.step(30)
            settle(agent, E + '.state.busy===0')
            check(agent, '(' + E + '.state.diags.get("config.json")||[]).some(d=>d.code==="SDK_JSON_PARSE" && d.severity==="error")',
                  'native validate reports invalid unsaved JSON in Problems')
            check_value((project / 'config.json').read_text() == source,
                        'live validation leaves the original JSON file unchanged')

            agent.eval('(()=>{const m=' + E + '.activeTab().model;m.selectAll();m.insert("{\\\"enabled\\\": false}\\n");' + E + '.code.state.onChange();return true;})()')
            agent.step(30)
            settle(agent, E + '.state.busy===0')
            check(agent, '!((' + E + '.state.diags.get("config.json")||[]).some(d=>d.code==="SDK_JSON_PARSE"))',
                  'correcting the buffer clears its syntax diagnostic before Save')
            check_value((project / 'config.json').read_text() == source,
                        'valid live draft still has not written the source file')
            agent.eval(E + '.save();1')
            settle(agent, E + '.state.busy===0')
            check_value(json.loads((project / 'config.json').read_text()) == {'enabled': False},
                        'Save publishes the corrected JSON buffer')
    print(f'editor_json_syntax_test: {checks} checks', flush=True)
    return 0


def main():
    state = ROOT / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        return _run()
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == '__main__':
    raise SystemExit(main())
