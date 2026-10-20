#!/usr/bin/env python3
"""Editor start screen: recent list (missing folders, remove by click), template pick, destination preview, create."""
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
        (alive / 'main.js').write_text('$.ready(() => {});')
        gone = str(root / 'gone')
        state.write_text(json.dumps({'version': 1, 'recent': [{'abs': gone, 'title': 'Пропавший'}, {'abs': str(alive), 'title': 'old'}]}))
        with Agent(game='editor', seed=3) as a:
            settle(a, E + '.state.templates.length>0')
            html = a.eval(D + '.html ? "" : ""')
            rec = a.eval(E + '.state.recent.map(r=>r.abs)')
            check(rec == [gone, str(alive)], 'recent list loaded from state')
            check(a.eval('!!' + D + '.layoutRect("pm-rm-1")'), 'each recent row has a remove button')

            # Missing folder goes last and can be removed by a real click on ×.
            click(a, 'pm-rm-1')
            check(a.eval(E + '.state.recent.map(r=>r.abs)') == [str(alive)], 'click on × removes the missing project only')
            check(json.loads(state.read_text())['recent'][0]['abs'] == str(alive), 'removal is saved')

            # Template pick + destination preview.
            check(a.eval(E + '.state.pmNew.template') == 'blank', 'blank template is preselected')
            a.eval(D + '.setValue("pm-new-dir",' + json.dumps(tmp) + ');' + D + '.setValue("pm-new-name","Новая Игра 2");1')
            a.step(2)
            run(a, E + '.showPM()')
            a.eval(E + '.state.pmNew.template="platformer";1')
            run(a, E + '.createProject()')
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            dest = root / 'новая-игра-2'
            check(dest.is_dir() and (dest / 'project.json').exists(), 'project created in <dir>/<slug of name>')
            check(json.loads((dest / 'project.json').read_text()).get('title') == 'Новая Игра 2', 'title comes from the name field')
            check(a.eval(E + '.state.project.abs') == str(dest), 'new project opens right away')

            # Existing folder blocks creation (as after «Проект: открыть другой»).
            a.eval(E + '.state.project=null;1')
            run(a, E + '.showPM()')
            a.eval(D + '.setValue("pm-new-dir",' + json.dumps(tmp) + ');' + D + '.setValue("pm-new-name","Новая Игра 2");1')
            run(a, E + '.createProject()')
            check(a.eval(E + '.state.project') is None, 'no project opened when the folder exists')


if __name__ == '__main__':
    sys.exit(main())
