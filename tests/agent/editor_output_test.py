#!/usr/bin/env python3
"""Output panel keeps timestamped, source-filtered operation history."""
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
    ok = agent.eval(expression) if isinstance(expression, str) else bool(expression)
    checks += 1
    print(('  ok   ' if ok else '  FAIL ') + label, flush=True)
    if not ok:
        raise AssertionError(label)


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-output-') as directory:
        root = Path(directory)
        project = root / 'project'
        project.mkdir()
        (project / 'project.json').write_text(json.dumps({
            'format': 2, 'title': 'Output fixture', 'entry': 'main.js',
        }))
        main_js = project / 'main.js'
        main_js.write_text('$.ready(() => {});\n')
        package_dir = root / 'packages'
        with Agent(game='editor', scene=str(project), seed=11) as agent:
            settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
            run(agent, E + '.validateProject()')
            check(agent, E + '.state.outputEntries.some(e=>e.source==="editor" && e.text.includes("r2d validate"))',
                  'project validation is recorded with its Editor source')
            check(agent, E + '.state.outputEntries.every(e=>/^\\d{4}-\\d\\d-\\d\\dT/.test(e.time))',
                  'every Output record has an ISO timestamp')

            run(agent, E + '.buildPackage(' + json.dumps(str(package_dir)) + ')')
            settle(agent, E + '.state.busy===0')
            check(agent, E + '.state.outputEntries.some(e=>e.source==="build" && e.text.includes("r2d build"))',
                  'successful package build is recorded with its Build source')
            check(agent, E + '.state.outputEntries.some(e=>e.source==="build" && e.text.includes("Скрипты:") && ' +
                  'e.text.includes("main.js") && e.text.includes("Итого:"))',
                  'Build Output shows the packaged scripts and size totals')

            run(agent, E + '.run({headless:true,frames:5})')
            settle(agent, E + '.state.run!==null && !' + E + '.state.run.running')
            check(agent, E + '.state.outputEntries.some(e=>e.source==="run" && e.text.includes("r2d --game"))',
                  'game output and exit status are recorded with their Run source')

            agent.eval(D + '.click("bt-output");1'); agent.step(2)
            agent.eval(D + '.click("output-filter-build");1'); agent.step(2)
            check(agent, E + '.state.outputFilter==="build" && ' +
                  D + '.content("bottom-body").includes("<span class=\\"out-source\\">Сборка</span>") && !' +
                  D + '.content("bottom-body").includes("<span class=\\"out-source\\">Запуск</span>")',
                  'Build filter displays only Build records')

            agent.eval(D + '.click("output-filter-run");1'); agent.step(2)
            check(agent, E + '.state.outputFilter==="run" && ' +
                  D + '.content("bottom-body").includes("<span class=\\"out-source\\">Запуск</span>") && !' +
                  D + '.content("bottom-body").includes("<span class=\\"out-source\\">Сборка</span>")',
                  'Run filter displays only Run records')

            tab = agent.eval(E + '.activeTab()')
            agent.eval(E + '.activeTab().model.setCaret({line:1,col:0});' +
                       E + '.activeTab().model.insert("$.scene.notARealMethod();\\n");1')
            run(agent, E + '.save()')
            run(agent, E + '.buildPackage(' + json.dumps(str(root / 'failed-package')) + ')')
            settle(agent, E + '.state.busy===0')
            check(agent, E + '.state.projectDiags.some(d=>d.severity==="error") && ' +
                  E + '.state.outputEntries.some(e=>e.source==="build" && e.text.includes("Сборка остановлена"))',
                  'failed build records its validation stop without hiding Problems')
            agent.eval(D + '.click("bt-output");1'); agent.step(2)
            agent.eval(D + '.click("output-filter-all");1'); agent.step(2)
            check(agent, E + '.state.outputEntries.some(e=>e.source==="run" && e.text.includes("Процесс завершился")) && ' +
                  E + '.state.outputEntries.some(e=>e.source==="build" && e.text.includes("Пакет создан")) && ' +
                  E + '.state.outputFilter==="all"',
                  'failed follow-up build preserves useful Run and successful Build output')
    print(f'editor_output_test: {checks} checks', flush=True)
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
