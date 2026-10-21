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


def shot(a, name):
    if '--shots' in sys.argv:
        if name in ('preview', 'conflict'):
            side = a.eval("$.ui.doc('ui/editor.rml').rect('side-body')")
            a.mouse_move(x=side['x'] + side['w']/2, y=side['y'] + side['h']/2)
            a.wheel(-10); a.step(5)
        a.screenshot(str(ROOT / 'docs/snippets/images' / ('acceptance-' + name + '.png')))
        if name in ('preview', 'conflict'):
            a.wheel(10); a.step(5)


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
            check(a.eval(E + '.snippets.state.catalog.length') == 500, 'каталог пришёл из r2d snippet catalog')
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
            shot(a, 'inspector')
            run(a, E + ".snippets.click('preview')")
            preview = a.eval(E + ".snippets.state.gen.files.find(f => f.path === 'generated/snippets/index.js')")
            check(preview and '"speed": 260' in preview.get('text', ''), 'preview показывает новый JS до записи')
            check(not (root / 'generated/snippets/index.js').exists(), 'preview не пишет файлы')
            run(a, E + ".snippets.click('diff:generated/snippets/index.js')")
            check('До' in a.eval("$.ui.doc('ui/editor.rml').content('side-body')"), 'панель показывает исходник до/после')
            a.step(5)
            check(a.eval("$.ui.doc('ui/editor.rml').layoutRect('sn-diff-after').h") > 50, 'preview исходника имеет читаемую высоту')
            shot(a, 'preview')
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
            path = root / 'snippets/game.spin/snippet.json'
            custom = json.loads(path.read_text())
            custom['fields'] += [
                {'id': 'advanced', 'type': 'bool', 'label': 'Дополнительно', 'default': False},
                {'id': 'offset', 'type': 'vec2', 'label': 'Смещение', 'default': [1, 2], 'group': 'Дополнительно', 'visibleIf': {'field': 'advanced', 'equals': True}},
            ]
            path.write_text(json.dumps(custom))
            run(a, E + '.snippets.load(true)')
            run(a, E + ".snippets.click('add:game.spin')")
            check(a.eval("$.ui.doc('ui/editor.rml').value('sn-f-offset')") is None, 'visibleIf скрывает зависимое поле')
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-f-advanced', 'да');1"); a.step(4)
            run(a, E + ".snippets.changed('sn-f-advanced')")
            settle(a, E + '.snippets.state.busy===false')
            check(a.eval("$.ui.doc('ui/editor.rml').value('sn-f-offset')") == '1', 'visibleIf показывает поле после изменения условия')
            a.step(6)
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-f-offset', 'oops');1")
            run(a, E + ".snippets.changed('sn-f-offset')")
            settle(a, E + '.snippets.state.busy===false')
            check(any(d['code'] == 'SNIP025' for d in a.eval(E + '.snippets.state.diags')), 'ошибочный vec2 показан через native SNIP025')
            check('offset' not in next(i for i in disk(root)['editor']['snippets']['instances'] if i['package'] == 'game.spin')['values'], 'ошибочный vec2 не превратился в ноль')

            run(a, E + ".snippets.click('generate')")
            check('$("<coin>", { id: "coin" })' in (root / 'generated/snippets/index.js').read_text(), 'generated создаёт объект #coin через $')
            # Kit authoring uses the same panel command as behavior authoring.
            run(a, E + ".snippets.createPackage('game.coin-kit', 'Монета', 'kit', 'game.spin')")
            manifest = json.loads((root / 'snippets/game.coin-kit/snippet.json').read_text())
            check(manifest['kind'] == 'kit' and manifest['dependencies'] == [{'id': 'game.spin'}], 'набор создан через панель с составом')
            check(a.eval(E + '.activeTab().path') == 'snippets/game.coin-kit/snippet.json', 'для набора открыт manifest')
            check(a.eval(E + ".snippets.state.catalog.some(p => p.id === 'game.coin-kit' && p.valid)"), 'новый kit проверен backend')
            shot(a, 'authoring')
            # Update preview and migration apply are also available in the panel.
            path = root / 'snippets/game.spin/snippet.json'
            custom = json.loads(path.read_text())
            custom['version'] = '1.0.1'
            path.write_text(json.dumps(custom))
            run(a, E + ".snippets.click('updates')")
            check(any(c['from'] == '1.0.0' and c['to'] == '1.0.1' for c in a.eval(E + '.snippets.state.updates.changes')), 'dry-run обновления виден в панели')
            check(next(i for i in disk(root)['editor']['snippets']['instances'] if i['package'] == 'game.spin')['version'] == '1.0.0', 'dry-run не меняет pinned version')
            run(a, E + ".snippets.click('update')")
            check(next(i for i in disk(root)['editor']['snippets']['instances'] if i['package'] == 'game.spin')['version'] == '1.0.1', 'обновление применено из панели')
            # Фильтр категорий.
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-cat', 'Камера');1")
            run(a, E + ".snippets.changed('sn-cat')")
            cats = a.eval(E + ".snippets.state.catalog.filter(p => p.valid && (!" + E + ".snippets.state.category || p.category === " + E + ".snippets.state.category)).map(p => p.category)")
            check(cats and set(cats) == {"Камера"}, 'фильтр категорий: только «Камера» (%d)' % len(cats or []))
            # Отмена и повтор правки значения.
            before = disk(root)['editor']['snippets']['instances'][0]['values'].get('speed')
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-owner', 'object:hero');1")
            run(a, E + ".snippets.changed('sn-owner')")
            a.eval(E + ".snippets.click('open:snippet:hero:movement.top-down');1"); a.step(6)
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-f-speed', '333');1")
            run(a, E + ".snippets.changed('sn-f-speed')")
            check(disk(root)['editor']['snippets']['instances'][0]['values'].get('speed') == 333, 'speed=333 записан')
            run(a, E + ".snippets.undo()")
            check(disk(root)['editor']['snippets']['instances'][0]['values'].get('speed') == before, 'отмена вернула %s' % before)
            run(a, E + ".snippets.redo()")
            check(disk(root)['editor']['snippets']['instances'][0]['values'].get('speed') == 333, 'повтор вернул 333')
            # Владение и откат — кнопками панели.
            run(a, E + ".snippets.click('own:code')")
            check(disk(root)['editor']['snippets']['generation'].get('ownership') == 'code', 'область передана в ручное владение')
            check(a.eval(E + ".snippets.state.gen.files.every(f => f.owner === 'code')") is True, 'у каждого файла показан владелец «ручной»')
            before = (root / 'generated/snippets/index.js').read_text()
            run(a, E + ".snippets.click('own:generator')")
            check('ownership' not in disk(root)['editor']['snippets']['generation'], 'область возвращена генератору')
            check((root / 'generated/snippets/index.js').read_text() == before, 'смена владельца не трогает файлы')
            # External generated edit: visible conflict, explicit recovery keeps both versions.
            output = root / 'generated/snippets/index.js'
            output.write_text(output.read_text() + '\n// external-user-edit\n')
            run(a, E + ".snippets.click('preview')")
            check(any(f['status'] == 'conflict' for f in a.eval(E + '.snippets.state.gen.files')), 'внешняя правка показана как conflict')
            shot(a, 'conflict')
            run(a, E + ".snippets.click('generate')")
            check('// external-user-edit' in output.read_text(), 'конфликт не перезаписан молча')
            run(a, E + ".snippets.click('overwrite')")
            check('// external-user-edit' in Path(str(output) + '.r2d-user').read_text(), 'recovery сохранил внешнюю версию')
            n = len(disk(root)['editor']['snippets']['instances'])
            run(a, E + ".snippets.click('remove:snippet:coin:game.spin')")
            check(len(disk(root)['editor']['snippets']['instances']) == n - 1, 'экземпляр удалён')
            run(a, E + ".snippets.click('rollback')")
            check(len(disk(root)['editor']['snippets']['instances']) == n, 'откат вернул удалённый экземпляр')
            check(a.eval(E + ".state.project.json.editor.snippets.instances.length") == n, 'Editor перечитал откаченный project.json')
        with Agent(game='editor', scene=str(root), seed=6) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            a.eval(E + '.showSnippets();1')
            settle(a, E + '.snippets.state.loaded && ' + E + '.state.busy===0')
            a.eval("$.ui.doc('ui/editor.rml').setValue('sn-owner', 'object:hero');1")
            run(a, E + ".snippets.changed('sn-owner')")
            check(a.eval(E + ".snippets.state.section || 1") and a.eval(E + ".state.project.json.editor.snippets.instances.map(i => i.id).join()") == "snippet:hero:movement.top-down,snippet:coin:game.spin", 'композиция на месте после переоткрытия')
            a.eval(E + ".snippets.click('open:snippet:hero:movement.top-down');1")
            a.step(6)
            check(a.eval("$.ui.doc('ui/editor.rml').value('sn-f-speed')") == '333', 'после переоткрытия форма показывает 333')


def main():
    os.environ.setdefault('R2D_BINARY', str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))
    test()
    print('editor_snippets_test: %d checks' % checks)


if __name__ == '__main__':
    main()
