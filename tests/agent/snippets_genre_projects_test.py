#!/usr/bin/env python3
# ===========================================================================
# Жанровые проекты целиком через Editor (ТЗ §19: Platformer, Witch, top-down,
# VN, JRPG, roguelike, co-op). Для каждого: проект из шаблона (r2d new — тот же
# backend, что кнопка Project Manager) → Editor → «Кирпичики»: объекты кнопкой
# «Новый объект», набор жанра из каталога → «Сгенерировать» → игра в настоящем
# runtime без ошибок. Скриншоты Editor и игры — docs/snippets/images/.
# Запуск: python3 tests/agent/snippets_genre_projects_test.py [--shots]
# ===========================================================================
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent  # noqa: E402
from editor_hammer_test import settle, run  # noqa: E402

R2D = os.path.abspath(os.environ.get('R2D_BINARY') or str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))
os.environ['R2D_BINARY'] = R2D
E = '$.editorApp'
SHOTS = '--shots' in sys.argv
FAILURES = []

GROUND = ('ground', 'ground', {'x': 640, 'y': 700, 'w': 1280, 'h': 40, 'body': 'static'})
GENRES = [
    ('platformer', 'kit.project-platformer', [GROUND, ('hero', 'hero', {'x': 200, 'y': 600})]),
    ('witch', 'kit.project-witch', [GROUND, ('hero', 'witch', {'x': 200, 'y': 600})]),
    ('top-down', 'kit.project-top-down-action', [('hero', 'hero', {'x': 400, 'y': 300})]),
    ('vn', 'kit.project-vn-romance', [('hero', 'stage', {'x': 640, 'y': 360, 'body': 'none'})]),
    ('jrpg', 'kit.project-jrpg', [('hero', 'hero', {'x': 300, 'y': 300})]),
    ('roguelike', 'kit.roguelike-run', [('hero', 'hero', {'x': 300, 'y': 300})]),
    ('co-op', 'kit.project-coop-adventure', [('hero', 'hero', {'x': 300, 'y': 300})]),
]


def check(c, msg):
    print(('  ok   ' if c else '  FAIL ') + msg, flush=True)
    if not c:
        FAILURES.append(msg)


def r2d(*args):
    out = subprocess.run([R2D, *args], cwd=str(ROOT), capture_output=True, text=True).stdout
    return json.loads([l for l in out.splitlines() if l.startswith('{')][-1])


def project_json(root):
    return json.loads((root / 'project.json').read_text())


def genre(tmp, name, kit, entities):
    root = Path(tmp) / name
    res = r2d('new', 'blank', str(root), '--name', name)
    check(res['ok'], '%s: проект из шаблона' % name)
    (root / 'main.js').write_text('// %s — поведение собрано в Editor («Кирпичики»).\n$.ready(() => {});\n' % name)
    with Agent(game='editor', scene=str(root), seed=7) as a:
        settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
        a.eval(E + '.showSnippets();1')
        settle(a, E + '.snippets.state.loaded && ' + E + '.state.busy===0')
        for eid, tag, opts in entities:
            run(a, E + '.snippets.createEntity(%s, %s, %s)' % (json.dumps(eid), json.dumps(tag), json.dumps(opts)))
        ents = [e['key'] for e in project_json(root)['editor']['graph']['entities']]
        check(all('object:' + e[0] in ents for e in entities), '%s: объекты созданы в Editor %s' % (name, ents))
        a.eval("$.ui.doc('ui/editor.rml').setValue('sn-owner', 'object:hero');1")
        run(a, E + ".snippets.changed('sn-owner')")
        run(a, E + ".snippets.click('add:%s')" % kit)
        sec = project_json(root)['editor']['snippets']
        check(any(s['package'] == kit for s in sec.get('sets', [])), '%s: набор %s подключён (%d экземпляров)' % (name, kit, len(sec['instances'])))
        run(a, E + ".snippets.click('generate')")
        gen = a.eval(E + '.snippets.state.gen') or {}
        check(gen.get('ok') is True, '%s: генерация — %s' % (name, [d.get('message') for d in gen.get('diagnostics', [])][:3]))
        if SHOTS:
            a.screenshot(str(ROOT / 'docs/snippets/images' / ('%s-editor.png' % name)))
    v = r2d('validate', str(root))
    check(v['ok'], '%s: validate — %s' % (name, [(d['code'], d['message']) for d in v['diagnostics'] if d['severity'] == 'error'][:3]))
    with Agent(game=str(root), seed=7) as a:
        a.step(10)
        a.hold(['D', 'Space'])
        a.step(30)
        a.release_all()
        a.step(10)
        check(a.eval("$('#hero').length") == 1, '%s: герой создан сгенерированным JS' % name)
        errs = a.eval('$.debug.errors()') or []
        check(not errs, '%s: игра без ошибок %s' % (name, [(e.get('message'), (e.get('source') or {}).get('file')) for e in errs[:3]]))
        if SHOTS:
            a.screenshot(str(ROOT / 'docs/snippets/images' / ('%s-game.png' % name)))


def main():
    tmp = tempfile.mkdtemp(prefix='r2d-genres-')
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    for name, kit, ents in GENRES:
        if only and name not in only:
            continue
        genre(tmp, name, kit, ents)
    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print('FAILED: %d' % len(FAILURES))
        sys.exit(1)
    print('snippets_genre_projects_test: ok')


if __name__ == '__main__':
    main()
