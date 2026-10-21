#!/usr/bin/env python3
"""Run/Stop from the Editor leaves the project and active document available."""
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
    ok = agent.eval(expression) if isinstance(expression, str) else bool(expression)
    checks += 1
    print(('  ok   ' if ok else '  FAIL ') + label, flush=True)
    if not ok:
        raise AssertionError(label)


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-run-stop-') as directory:
        project = Path(directory)
        (project / 'project.json').write_text(json.dumps({
            'format': 2, 'title': 'Run Stop fixture', 'entry': 'main.js',
        }))
        (project / 'main.js').write_text('$.ready(() => {});\n')
        with Agent(game='editor', scene=str(project), seed=9) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
            check(agent, E + '.activeTab().path==="main.js"',
                  'Editor opens the project entry before Run')
            agent.eval(E + '.activeTab().model.setCaret({line:0,col:0});' +
                       E + '.activeTab().model.insert("// before first Run\\n");1')
            check(agent, E + '.activeTab().model.dirty',
                  'editing code before Run marks the entry document dirty')
            agent.eval(E + '.run({headless:true});1')
            settle(agent, E + '.state.run!==null && ' + E + '.state.run.running')
            check(agent, agent.eval(E + '.state.run.running && ' + E + '.state.project!==null && !' +
                                    E + '.activeTab().model.dirty') and
                  '// before first Run' in (project / 'main.js').read_text(),
                  'Run starts the game and saves the dirty entry')
            agent.eval(E + '.stop();1')
            settle(agent, E + '.state.run!==null && !' + E + '.state.run.running')
            check(agent, '!'+E+'.state.run.running',
                  'Stop waits for the launched game process to exit')
            check(agent, E + '.state.statusKind==="ok" && ' + E + '.state.outputEntries.some(e=>e.text==="Игра остановлена.")',
                  'an intentional Stop is reported as successful instead of a process error')
            check(agent, E + '.state.project!==null && ' + E + '.activeTab().path==="main.js"',
                  'stopping the game returns to the same project document')
            agent.eval('(()=>{const m=' + E + '.activeTab().model,last=m.lineCount()-1;m.setCaret({line:last,col:m.lines[last].length});m.insert("// after first Stop\\n");return 1;})()')
            check(agent, E + '.activeTab().model.dirty',
                  'editing code after Stop is available and marks the document dirty')
            agent.eval(E + '.run({headless:true});1')
            settle(agent, E + '.state.run!==null && ' + E + '.state.run.running')
            check(agent, agent.eval(E + '.state.run.running && !' + E + '.activeTab().model.dirty') and
                  '// after first Stop' in (project / 'main.js').read_text(),
                  'the next Run saves the follow-up edit')
            agent.eval(E + '.stop();1')
            settle(agent, E + '.state.run!==null && !' + E + '.state.run.running')
            check(agent, E + '.state.project!==null && ' + E + '.activeTab().path==="main.js"',
                  'a second Run/Stop cycle completes without losing the document')
    print(f'editor_run_stop_test: {checks} checks', flush=True)
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
