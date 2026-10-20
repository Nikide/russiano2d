#!/usr/bin/env python3
"""Editor and project.json v2: v1 → v2 migration via native migrate-project, entry/scenes/roles from the manifest."""
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
        print('editor_project_v2_test: %d checks' % checks)
        return 0
    finally:
        if previous is None:
            recents.unlink(missing_ok=True)
        else:
            recents.write_bytes(previous)


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-projv2-') as tmp:
        root = Path(tmp)
        (root / 'project.json').write_text('{"title":"V2","width":640,"height":360}')
        (root / 'main.js').write_text("$.scene.add('menu', () => {});\n$.scene.add('boss', () => {});\n")
        (root / 'src').mkdir()
        (root / 'src' / 'game.js').write_text("$.ready(() => {});\n")
        (root / 'hud.rml').write_text('<rml><head></head><body></body></rml>\n')
        with Agent(game='editor', scene=tmp, seed=5) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            m = a.eval(E + '.manifest()')
            check(m['v2'] is False and m['entry'] == 'main.js' and m['scenes'] == [], 'v1 project: defaults, no guessed scenes')
            check(a.eval(E + '.activeTab().path') == 'main.js', 'v1 opens main.js')

            run(a, E + '.migrateProject()')
            disk = json.loads((root / 'project.json').read_text())
            check(disk.get('format') == 2 and disk.get('width') == 640 and disk['scenes']['list'] == ['menu', 'boss'],
                  'migrate writes v2 with scenes from $.scene.add, keeps fields')
            m = a.eval(E + '.manifest()')
            check(m['v2'] is True and m['scenes'] == ['menu', 'boss'], 'Editor reloads the manifest after migration')
            check(not [d for d in a.eval(E + '.state.projectDiags') if d.get('severity') == 'error'],
                  'migrated project validates without errors')

            disk.update({'entry': 'src/game.js', 'roles': {'hud.rml': 'script'}})
            disk['scenes']['start'] = 'boss'
            (root / 'project.json').write_text(json.dumps(disk))
            run(a, E + '.openProject(' + json.dumps(tmp) + ')')
            settle(a, E + '.state.busy===0')
            check(a.eval(E + '.activeTab().path') == 'src/game.js', 'v2 entry opens on project load')
            check(a.eval(E + '.manifest().start') == 'boss', 'scenes.start is read')
            a.eval(E + '.openFile("hud.rml");1')
            check(a.eval(E + '.activeTab().kind') == 'code', 'role "script" overrides the RmlUi studio for hud.rml')
            a.eval(E + '.openWith("hud.rml","rmlui");1')
            settle(a, E + '.activeTab().kind==="studio"')
            check(a.eval(E + '.activeTab().studio.id') == 'rmlui', 'explicit Open as… still wins over the role')


if __name__ == '__main__':
    sys.exit(main())
