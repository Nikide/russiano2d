#!/usr/bin/env python3
"""Панель «Агент» Editor: цикл модель→инструмент→модель на моканой сети, подтверждение записи."""
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


def check(agent, expression, label):
    global checks
    ok = agent.eval(expression)
    checks += 1
    print(('  ok   ' if ok else '  FAIL ') + label, flush=True)
    if not ok:
        raise AssertionError(label + '\n' + agent.stderr_tail())


def reply(*content):
    return {'status': 200, 'body': json.dumps({'content': list(content), 'stop_reason': 'end_turn'}), 'headers': ''}


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-agentpanel-') as directory:
        project = Path(directory) / 'project'
        project.mkdir()
        (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Agent fixture', 'entry': 'main.js'}))
        (project / 'main.js').write_text('$.ready(() => {});\n')
        scripted = [
            reply({'type': 'tool_use', 'id': 't1', 'name': 'read_file', 'input': {'path': 'main.js'}}),
            reply({'type': 'tool_use', 'id': 't2', 'name': 'write_file', 'input': {'path': 'notes.txt', 'content': 'hi'}}),
            reply({'type': 'text', 'text': 'Готово.'}),
        ]
        with Agent(game='editor', scene=str(project), seed=12) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
            agent.eval('globalThis.__q=' + json.dumps(scripted) + ';globalThis.__seen=[];'
                       '$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
            agent.eval(D + '.click("bt-agent");1'); agent.step(2)
            check(agent, E + '.state.bottom==="agent" && ' + D + '.rect("ag").h>0', 'вкладка «Агент» открывает панель')
            agent.eval(D + '.setValue("ag-key","test-key");' + D + '.setValue("ag-input","прочитай main.js и запиши notes.txt");' +
                       D + '.click("ag-send");1')
            settle(agent, E + '.agent.state.pending!==null')
            check(agent, 'globalThis.__seen.length===2', 'после чтения файла модель вызвана повторно')
            check(agent, D + '.content("ag-log").includes("Разрешить") && !$.fs.exists(' + json.dumps(str(project / 'notes.txt')) + ')',
                  'запись ждёт подтверждения и ещё не выполнена')
            agent.eval(D + '.click("ag-yes");1')
            settle(agent, '!' + E + '.agent.state.busy')
            check(agent, '$.fs.readText(' + json.dumps(str(project / 'notes.txt')) + ')==="hi"', 'после подтверждения файл записан')
            check(agent, D + '.content("ag-log").includes("Готово.")', 'итоговый ответ показан в панели')
            check(agent, '(()=>{const h=globalThis.__seen[0].headers;const i=h.indexOf("x-api-key");return i>=0&&h[i+1]==="test-key"&&!String(globalThis.__seen[0].body).includes("test-key");})()', 'ключ уходит только в заголовок запроса')
            check(agent, '!JSON.stringify($.fs.readText(' + json.dumps(str(project / 'project.json')) + ')).includes("test-key")', 'ключ не записан в project.json')
    print(f'editor_agent_panel_test: {checks} checks', flush=True)
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
