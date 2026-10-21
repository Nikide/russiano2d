#!/usr/bin/env python3
"""Editor Project Manager exposes only Blank and keeps its create/run/build flow working."""
import json
from pathlib import Path
import subprocess
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


def click(a, element):
    r = a.eval('(()=>{const k=$.window.pixels().w/$.window.size().w,r=' + D + '.layoutRect(' + json.dumps(element) + ');return r&&{x:(r.x+r.w/2)/k,y:(r.y+r.h/2)/k};})()')
    assert r, element
    a.mouse_move(x=r['x'], y=r['y']); a.step(1); a.mouse(1, 'click'); a.step(2)


def test(state):
    with tempfile.TemporaryDirectory(prefix='r2d-pm-') as tmp:
        root = Path(tmp)
        alive = root / 'alive'
        alive.mkdir()
        (alive / 'project.json').write_text('{"format":2,"title":"Живой"}')
        (alive / 'main.js').write_text('$.ready(() => {});\n// ProjectSearchNeedle appears here.\n')
        (alive / 'large.txt').write_text('ProjectSearchNeedle ' + 'x' * (1024 * 1024))
        (alive / 'build').mkdir()
        (alive / 'build/ignored.js').write_text('ProjectSearchNeedle')
        gone = str(root / 'gone')
        state.write_text(json.dumps({'version': 1, 'recent': [{'abs': gone, 'title': 'Пропавший'}, {'abs': str(alive), 'title': 'old'}]}))
        with Agent(game='editor', seed=3) as a:
            settle(a, E + '.state.templates.length>0')
            check(a.eval(E + '.state.templates.map(t=>t.id).join(",")==="blank"'), 'Project Manager lists only Blank')
            check(a.eval(E + '.state.pmNew.dir===$.fs.documentsPath().replace(/[\\\\/]+$/,"")'), 'new project defaults to Documents')
            rec = a.eval(E + '.state.recent.map(r=>r.abs)')
            check(rec == [gone, str(alive)], 'recent list loaded from state')
            check(a.eval('!!' + D + '.layoutRect("pm-rm-1")'), 'each recent row has a remove button')
            click(a, 'pm-rm-1')
            check(a.eval(E + '.state.recent.map(r=>r.abs)') == [str(alive)], 'click on × removes the missing project only')
            check(json.loads(state.read_text())['recent'][0]['abs'] == str(alive), 'removal is saved')

            def folder_answer(value):
                if isinstance(value, dict):
                    js = 'Promise.reject(Object.assign(new Error(' + json.dumps(value['error']) + '),{code:"R2D_FS_DIALOG_FAILED"}))'
                else:
                    js = 'Promise.resolve(' + json.dumps(value) + ')'
                a.eval('$.fs.pickFolder=(o)=>{globalThis.lastPick=o;return ' + js + ';};1')

            check(a.eval(E + '.state.pmNew.template') == 'blank', 'Blank is preselected')
            check(a.eval('!!' + D + '.layoutRect("pm-template-blank")') and not a.eval('!!' + D + '.layoutRect("pm-template-platformer")'), 'Blank is the only template card')
            folder_answer(tmp)
            click(a, 'pm-new-browse')
            settle(a, E + '.state.pmNew.dir===' + json.dumps(tmp))
            check(a.eval('globalThis.lastPick.title') == 'Где создать проект', 'folder button opens the OS picker')
            folder_answer(None)
            click(a, 'pm-new-browse'); a.step(3)
            check(a.eval(E + '.state.pmNew.dir') == tmp, 'cancel keeps the chosen folder')
            a.eval(D + '.setValue("pm-new-name","Blank Start");1')
            run(a, E + '.createProject()')
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            dest = next(p for p in root.iterdir() if (p / 'project.json').is_file() and p.name != 'alive')
            manifest = json.loads((dest / 'project.json').read_text())
            check(manifest.get('schema_version') == 2 and manifest['project']['name'] == 'Blank Start'
                  and manifest['runtime']['window']['title'] == 'Blank Start' and (dest / 'main.js').is_file(),
                  'Blank project is created with its title and entry script')
            check(manifest['editor']['graph']['status'] == 'current' and a.eval(E + '.graphInfo().has') is True,
                  'new project starts with schema 2 and an indexed graph')
            check(not (dest / 'demos').exists(), 'Blank contains no bundled genre demo')
            check(a.eval(E + '.state.project.abs') == str(dest), 'new project opens right away')
            run(a, E + '.validateProject()')
            check(not a.eval(E + '.state.projectDiags.some(d=>d.severity==="error")'), 'Blank validates inside Editor')
            launched = run(a, E + '.run({headless:true,frames:4})')
            check(launched and a.eval(E + '.state.run!==null'), 'Run starts Blank through Editor')
            settle(a, E + '.state.run && !' + E + '.state.run.running')
            check(a.eval(E + '.state.run.exit===0'), 'Blank runtime exits cleanly')
            package_root = root / 'package-output'
            run(a, E + '.buildPackage(' + json.dumps(str(package_root)) + ')')
            settle(a, E + '.state.busy===0')
            package_path = next(package_root.iterdir())
            check(package_path.is_file() and package_path.stat().st_size > 0, 'Build creates a runnable package')
            packaged = subprocess.run([str(package_path), '--headless', '--frames', '4'], cwd=ROOT, capture_output=True, text=True)
            check(packaged.returncode == 0, 'built Blank package starts and exits cleanly')

            a.eval(E + '.state.project=null;1')
            run(a, E + '.showPM()'); a.step(3)
            a.eval(D + '.setValue("pm-new-name","Blank Start");1')
            run(a, E + '.createProject()')
            check(a.eval(E + '.state.project') is None, 'existing destination blocks project creation')

            (root / 'empty').mkdir()
            run(a, E + '.showPM()'); a.step(3)
            folder_answer(str(root / 'empty'))
            click(a, 'pm-open'); a.step(4)
            check(a.eval(E + '.state.project') is None, 'folder without project.json is not opened')
            check('нет project.json' in a.eval(E + '.state.pmError'), 'missing project manifest is reported')
            folder_answer({'error': 'нет дисплея'})
            click(a, 'pm-open'); a.step(4)
            check(a.eval(E + '.state.project') is None and 'нет дисплея' in a.eval(E + '.state.pmError'), 'OS dialog failure is shown')
            folder_answer(None)
            click(a, 'pm-open'); a.step(4)
            check(a.eval(E + '.state.project') is None, 'cancel opens nothing')
            folder_answer(str(alive))
            click(a, 'pm-open')
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            check(a.eval(E + '.state.project.abs') == str(alive), 'open project dialog opens the selected folder')
            run(a, E + '.showProjectSearch()')
            a.eval(D + '.setValue("search-input","ProjectSearchNeedle");1'); a.step(20)
            matches = a.eval(E + '.state.searchResults')
            check(len(matches) == 1 and matches[0]['path'] == 'main.js' and matches[0]['line'] == 2, 'project search reports matching file and line')
            a.eval(D + '.click("search-result-0");1')
            check(a.eval(E + '.activeTab().path') == 'main.js' and a.eval(E + '.activeTab().model.caret.line') == 1, 'search result navigates to its source line')


def main():
    state = Path(ROOT) / 'state.local.json'
    previous = state.read_bytes() if state.exists() else None
    try:
        test(state)
        print('editor_project_manager_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == '__main__':
    sys.exit(main())
