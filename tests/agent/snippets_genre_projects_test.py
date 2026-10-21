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


def configure(a, root, package, values):
    inst = next(i for i in project_json(root)['editor']['snippets']['instances'] if i['package'] == package)
    a.eval("$.ui.doc('ui/editor.rml').setValue('sn-owner', %s);1" % json.dumps(inst['owner']))
    run(a, E + ".snippets.changed('sn-owner')")
    if a.eval(E + '.snippets.state.open') != inst['id']:
        run(a, E + '.snippets.click(%s)' % json.dumps('open:' + inst['id']))
    for key, value in values.items():
        text = json.dumps(value, ensure_ascii=False) if isinstance(value, list) else str(value)
        settle(a, E + '.snippets.state.busy===false')
        a.eval("$.ui.doc('ui/editor.rml').setValue(%s,%s);1" % (json.dumps('sn-f-' + key), json.dumps(text, ensure_ascii=False)))
        run(a, E + '.snippets.changed(%s)' % json.dumps('sn-f-' + key))
        settle(a, E + '.snippets.state.busy===false')
    check(next(i for i in project_json(root)['editor']['snippets']['instances'] if i['id'] == inst['id'])['values'].items() >= values.items(), package + ': значения Inspector сохранены')


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
        if name == 'vn':
            run(a, E + ".snippets.click('add:dialogue.action')")
            configure(a, root, 'dialogue.action', {'setFlag': 'route', 'actions': ['Свои=game:finale']})
            configure(a, root, 'story.ending', {'endings': ['good: route', 'bad:']})
        if name == 'jrpg':
            run(a, E + ".snippets.createEntity('foe','foe',{x:350,y:300,body:'none'})")
            run(a, E + ".snippets.click('add:enemy.base')")
            configure(a, root, 'ability.targeting', {'mode': 'nearest'})
            configure(a, root, 'turn.initiative-queue', {'units': '#hero, #foe'})
        if name == 'roguelike':
            configure(a, root, 'run.route-generator', {'seed': 1337, 'length': 3})
        run(a, E + ".snippets.click('preview')")
        run(a, E + ".snippets.click('generate')")
        gen = a.eval(E + '.snippets.state.gen') or {}
        check(gen.get('ok') is True, '%s: генерация — %s' % (name, [d.get('message') for d in gen.get('diagnostics', [])][:3]))
        if SHOTS:
            a.screenshot(str(ROOT / 'docs/snippets/images' / ('%s-editor.png' % name)))
    check(r2d('lint', str(root))['ok'], name + ': lint generated JS')
    check(r2d('build', str(root), '--out', str(Path(tmp) / (name + '-build')))['ok'], name + ': Build')
    v = r2d('validate', str(root))
    check(v['ok'], '%s: validate — %s' % (name, [(d['code'], d['message']) for d in v['diagnostics'] if d['severity'] == 'error'][:3]))
    with Agent(game=str(root), seed=7) as a:
        a.step(10)
        before_x = a.eval("$('#hero').pos().x")
        a.hold(['D', 'Space'])
        a.step(30)
        a.release_all()
        a.step(10)
        check(a.eval("$('#hero').length") == 1, '%s: герой создан сгенерированным JS' % name)
        if name in ('platformer', 'witch', 'top-down'):
            check(a.eval("$('#hero').pos().x") > before_x, name + ': управление двигает героя')
        if name == 'vn':
            a.eval("$.emit('dialogue:play',{id:'guard'});1"); a.step(2)
            a.eval("$.dialog.skip();$.dialog.chooseByText('Свои');1"); a.step(2)
            check(a.eval("$.story.flags.ending") == 'good', 'vn: выбор приводит к хорошей концовке')
            check(bool(a.eval("$.save.get('choiceHistory') || $.save.get('choices')")), 'vn: выбор записан в save')
        if name == 'jrpg':
            a.eval("$('#hero').data('initiative',5);$.emit('turn:next');1")
            check(a.eval("$.store.get('turn').unit") == 'hero', 'jrpg: очередь выдаёт ход герою')
            hp = a.eval("$('#foe').hp()")
            a.tap('Q'); a.step(3)
            check(a.eval("$('#foe').hp()") < hp, 'jrpg: способность наносит урон противнику')
        if name == 'roguelike':
            check(a.eval("$('#hero').data('route').length") == 4, 'roguelike: три комнаты и босс')
            check(a.eval("$.save.get('run').seed") == 1337, 'roguelike: seed и маршрут сохраняются')
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
