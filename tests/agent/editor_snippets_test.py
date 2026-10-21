#!/usr/bin/env python3
"""Editor: панель «Кирпичики» (docs/SNIPPETS.md) в настоящем Editor.

Открыть проект → панель → каталог из backend → подключить пакет к #hero →
поменять поле через форму Inspector (неверное значение не пишется, SNIP026) →
сгенерировать → generated/snippets на диске, project.json перечитан →
переоткрыть проект: композиция и значения те же.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent  # noqa: E402
from editor_hammer_test import settle, run  # noqa: E402

E = '$.editorApp'
checks = 0


def check(value, message):
    global checks
    checks += 1
    print(('  ok   ' if value else '  FAIL ') + message)
    if not value:
        raise AssertionError(message)


def disk(root):
    return json.loads((root / 'project.json').read_text())


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-snip-ed-') as tmp:
        root = Path(tmp) / 'game'
        shutil.copytree(ROOT / 'tests/fixtures/snippets_basic', root,
                        ignore=shutil.ignore_patterns('generated', 'project.json.bak'))
        pj = disk(root)
        pj.get('editor', {}).pop('snippets', None)
        (root / 'project.json').write_text(json.dumps(pj, ensure_ascii=False, indent=2))
        (root / 'main.js').write_text(''.join(l for l in open(root / 'main.js') if 'r2d:snippets' not in l))
        with Agent(game='editor', scene=str(root), seed=5) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.showSnippets();1')
            settle(a, E + '.snippets.state.loaded && ' + E + '.state.busy===0')
            check(a.eval(E + '.state.side') == 'snippets', 'боковая панель — Кирпичики')
            check(a.eval(E + '.snippets.state.catalog.length') >= 9, 'каталог пришёл из r2d snippet catalog')
            check(a.eval(E + '.snippets.state.owner') == 'object:floor', 'объект по умолчанию — первый объект графа')
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-owner', 'object:hero');1")
            run(a, E + ".snippets.changed('sn-owner')")
            check(a.eval(E + '.snippets.state.owner') == 'object:hero', 'выбран #hero в списке объектов')
            text = a.eval("$.ui.doc('ui/editor.rml').text ? 1 : 1")
            run(a, E + ".snippets.click('add:movement.top-down')")
            sec = disk(root)['editor']['snippets']
            check([i['id'] for i in sec['instances']] == ['snippet:hero:movement.top-down'], 'подключено через панель: ' + str([i['id'] for i in sec['instances']]))
            check(a.eval(E + '.snippets.state.open') == 'snippet:hero:movement.top-down', 'форма экземпляра открыта: %s / %s' % (a.eval(E + '.snippets.state.open'), a.eval(E + '.state.status')))
            # Inspector: неверное значение → SNIP026, файл не меняется.
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-f-speed', '5000');1")
            run(a, E + ".snippets.changed('sn-f-speed')")
            check('speed' not in disk(root)['editor']['snippets']['instances'][0]['values'], 'speed=5000 не записан')
            check(any(d['code'] == 'SNIP026' for d in a.eval(E + '.snippets.state.diags')), 'SNIP026 показан у поля: %s / %s' % (a.eval(E + '.snippets.state.diags'), a.eval(E + '.state.status')))
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-f-speed', '260');1")
            run(a, E + ".snippets.changed('sn-f-speed')")
            check(disk(root)['editor']['snippets']['instances'][0]['values'].get('speed') == 260, 'speed=260 записан из формы')
            check(a.eval(E + ".state.project.json.editor.snippets.instances[0].values.speed") == 260, 'Editor перечитал project.json')
            run(a, E + ".snippets.click('generate')")
            check((root / 'generated/snippets/index.js').exists(), 'generated/snippets/index.js создан')
            check('"speed": 260' in (root / 'generated/snippets/index.js').read_text(), 'значение попало в generated JS')
            check(a.eval(E + '.snippets.state.gen.ok') is True, 'генерация без ошибок')
            check(a.eval(E + ".state.entries.some(e => e.path === 'generated/snippets/index.js')") is True, 'дерево файлов обновлено')
            # Новый объект и свой пакет — командами панели.
            run(a, E + ".snippets.createEntity('coin', 'coin')")
            ents = disk(root)['editor']['graph']['entities']
            check(any(e['key'] == 'object:coin' and e['origin'] == 'graph' for e in ents), 'объект #coin создан в графе (origin: graph)')
            check(a.eval(E + '.snippets.state.owner') == 'object:coin', 'панель переключилась на новый объект')
            run(a, E + ".snippets.createPackage('game.spin', 'Вращение')")
            check((root / 'snippets/game.spin/snippet.json').exists(), 'каркас пакета проекта создан')
            check(a.eval(E + ".snippets.state.catalog.some(p => p.id === 'game.spin' && p.scope === 'project' && p.valid)") is True, 'пакет проекта в каталоге и валиден')
            check(a.eval(E + '.activeTab().path') == 'snippets/game.spin/src/behavior.js', 'открыт исходник нового пакета')
            run(a, E + ".snippets.click('add:game.spin')")
            run(a, E + ".snippets.click('generate')")
            check('$("<coin>", { id: "coin" })' in (root / 'generated/snippets/index.js').read_text(), 'generated создаёт объект #coin через $')
        with Agent(game='editor', scene=str(root), seed=6) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.showSnippets();1')
            settle(a, E + '.snippets.state.loaded && ' + E + '.state.busy===0')
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-owner', 'object:hero');1")
            run(a, E + ".snippets.changed('sn-owner')")
            check(a.eval(E + ".snippets.state.section || 1") and a.eval(E + ".state.project.json.editor.snippets.instances.map(i => i.id).join()") == "snippet:hero:movement.top-down,snippet:coin:game.spin", 'композиция на месте после переоткрытия')
            a.eval(E + ".snippets.click('open:snippet:hero:movement.top-down');1")
            a.step(6)
            check(a.eval("$.ui.doc('ui/editor.rml').value('sn-f-speed')") == '260', 'после переоткрытия форма показывает 260')


def main():
    os.environ.setdefault('R2D_BINARY', str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))
    test()
    print('editor_snippets_test: %d checks' % checks)


if __name__ == '__main__':
    main()
