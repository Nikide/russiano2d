#!/usr/bin/env python3
"""The Editor runs native agent sessions and retains structured reports."""
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
checks = 0


def check(agent, expression, label):
    global checks
    ok = agent.eval(expression) if isinstance(expression, str) else bool(expression)
    checks += 1
    print(('  ok   ' if ok else '  FAIL ') + label, flush=True)
    if not ok:
        raise AssertionError(label)


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-agent-session-') as directory:
        project = Path(directory)
        (project / 'project.json').write_text(json.dumps({
            'format': 2, 'title': 'Agent session fixture', 'entry': 'main.js',
        }))
        (project / 'main.js').write_text('$.ready(() => {});\n')
        (project / 'smoke.agent.json').write_text(json.dumps({
            'version': 1, 'game': '.', 'timeoutMs': 10000, 'seed': 7,
            'requests': [{'cmd': 'ping'}, {'cmd': 'quit'}],
        }))
        (project / 'failure.agent.json').write_text(json.dumps({
            'version': 1, 'game': '.', 'timeoutMs': 10000, 'seed': 7,
            'requests': [{'cmd': 'agent-command-that-does-not-exist'}],
        }))

        with Agent(game='editor', scene=str(project), seed=3) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
            agent.eval(E + ".openFile('smoke.agent.json');1")
            settle(agent, E + ".activeTab() && " + E + ".activeTab().path==='smoke.agent.json'")
            agent.eval(E + ".openPalette('commands');1")
            agent.eval('$.ui.doc("ui/editor.rml").setValue("palette-input",">Тесты: выполнить активную .agent.json сессию");1')
            agent.step(3)
            check(agent, E + '.state.palette.list.some(x=>x.item.cmd && x.item.cmd.id==="agent-session")',
                  'Command Palette offers the active agent session action')
            agent.tap('Return')
            settle(agent, E + '.state.agentReport && ' + E + '.state.agentReport.report && ' +
                   E + '.state.agentReport.report.completed===2')
            passed = agent.eval(E + '.state.agentReport.report')
            check(agent, passed and passed.get('ok') is True and passed.get('completed') == 2,
                  'Editor executes a passing session through native r2d agent')
            check(agent, E + '.state.agentReport.report.ready.event==="ready" && ' +
                  E + '.state.agentReport.report.responses.length===2',
                  'Editor retains ready handshake and structured request responses')
            check(agent, E + '.state.bottom==="output" && ' +
                  E + '.state.outputEntries.some(e=>e.text.includes("Agent session завершена"))',
                  'passing session produces a visible Output result')

            agent.eval(E + ".openFile('failure.agent.json');1")
            settle(agent, E + ".activeTab() && " + E + ".activeTab().path==='failure.agent.json'")
            failed = run(agent, E + '.runAgentSession()')
            check(agent, failed and failed.get('ok') is False and failed.get('failed') == 1,
                  'a rejected runtime request is reported as a failed test')
            check(agent, E + '.state.statusKind==="err" && ' +
                  E + '.state.outputEntries.some(e=>e.text.includes("неуспешных запросов 1"))',
                  'failure count is visible without inventing an unknown cause')

    print(f'editor_agent_session_test: {checks} checks', flush=True)
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
