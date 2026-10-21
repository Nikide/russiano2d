#!/usr/bin/env python3
"""Editor и project.json schema_version 2: Project Settings, граф проекта (editor.graph),
индекс после Save, миграция плоского манифеста (docs/PROJECT_JSON.md)."""
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from agent_client import Agent, ROOT
from editor_hammer_test import settle, run

E = '$.editorApp'
checks = 0

MAIN = """$.scene.add('game', () => {
    const hero = $('<player>', { id: 'hero' }).at(100, 200).appendTo($.world);
    $('<sprite>', { id: 'hero_body' }).sprite('art/hero.png').appendTo(hero);
});
"""


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


def disk(root):
    return json.loads((root / 'project.json').read_text())


def test():
    with tempfile.TemporaryDirectory(prefix='r2d-projv2-') as tmp:
        root = Path(tmp)
        (root / 'art').mkdir()
        (root / 'art' / 'hero.png').write_bytes(b'png')
        (root / 'main.js').write_text(MAIN)
        (root / 'project.json').write_text(json.dumps({
            'schema_version': 2, 'project': {'name': 'Graph', 'version': '0.1.0'},
            'runtime': {'entry': 'main.js', 'start_scene': 'game', 'window': {'title': 'Graph', 'width': 640, 'height': 360}},
            'custom': {'keep': [1, 2]}}))
        with Agent(game='editor', scene=tmp, seed=5) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            m = a.eval(E + '.manifest()')
            check(m['v2'] is True and m['entry'] == 'main.js' and m['start'] == 'game' and m['scenes'] == [],
                  'schema 2: настройки читаются, сцен без графа нет')
            check(a.eval(E + '.activeTab().path') == 'main.js', 'открывается runtime.entry')
            settle(a, E + '.graphInfo().stale===true && ' + E + '.state.busy===0')
            check(a.eval(E + '.graphInfo().has') is False and a.eval(E + '.graphInfo().stale') is True,
                  'граф не построен, проект помечен устаревшим (--check) и не переписан')
            check('editor' not in disk(root), 'открытие проекта не пишет project.json')

            run(a, E + '.reindex()')
            info = a.eval(E + '.graphInfo()')
            check(info['has'] and info['status'] == 'current' and info['scenes'] == ['game'] and info['objects'] == 2,
                  'reindex строит граф: сцена game, 2 объекта (%s)' % info)
            d = disk(root)
            check(d['custom'] == {'keep': [1, 2]} and d['editor']['graph']['status'] == 'current', 'неизвестные поля сохранены')
            check(a.eval(E + '.manifest().scenes') == ['game'], 'сцены Inspector берутся из графа')

            # Save кода пересобирает граф
            a.eval(E + ".activeTab().model.setCaret({line:99,col:0});" + E + ".activeTab().model.insert(" + json.dumps("$('<npc>', { id: 'guide' }).appendTo($.world);\n") + ");1")
            check(a.eval(E + '.activeTab().model.dirty') is True, 'правка кода делает вкладку несохранённой')
            run(a, E + '.save()')
            settle(a, E + '.state.busy===0 && ' + E + '.state.indexing===false')
            check(a.eval(E + '.graphInfo().objects') == 3, 'Save JS обновляет граф (3 объекта)')
            check(any(e.get('public_id') == 'guide' for e in disk(root)['editor']['graph']['entities']), 'новый объект записан в project.json')

            # Панель графа
            panel = a.eval(E + '.graph.view().nodes.map(n=>n.kind).sort().join(",")')
            check(panel == 'resource,scene,script,world,world', 'панель: обзор (%s)' % panel)
            check(a.eval(E + ".graph.openNode('world:game')") is True, 'двойной клик на World открывает область')
            check(a.eval(E + '.graph.state.view.kind') == 'area' and a.eval(E + '.graph.view().crumbs.length') == 3, 'крошки: Проект / Сцена / World')
            a.eval(E + ".graph.pick('object:hero');1")
            check(a.eval(E + '.state.graphSelected') == 'object:hero', 'выбор объекта')
            check(a.eval(E + ".graph.openNode('object:hero')") is True, 'составная сущность открывается как область')
            check(a.eval(E + '.graph.back()') is True and a.eval(E + '.graph.state.view.area') == 'world:game', 'назад по истории')
            check(len(a.eval(E + ".graph.search('hero')")) >= 2, 'поиск находит объекты')
            check(a.eval(E + ".graph.navigate('object:guide')") is True and a.eval(E + '.state.graphSelected') == 'object:guide', 'переход к найденному')
            a.step(6)
            shot = Path(ROOT) / 'build' / 'editor-project-graph.png'
            shot.parent.mkdir(exist_ok=True)
            a.screenshot(str(shot))

            # Project Settings
            run(a, E + ".openFile('project.json')")
            settle(a, E + '.activeTab().api!==undefined && !!' + E + '.activeTab().api')
            check(a.eval(E + '.activeTab().studio.id') == 'project', 'project.json открывается в Project Settings')
            before = json.dumps(disk(root)['editor'], sort_keys=True)
            a.eval(E + ".activeTab().inst.setField('width','800');1")
            check(a.eval(E + '.activeTab().inst.dirty()') is True, 'правка поля делает документ несохранённым')
            run(a, E + '.save()')
            d = disk(root)
            check(d['runtime']['window']['width'] == 800 and d['runtime']['window']['height'] == 360, 'ширина окна записана')
            check(json.dumps(d['editor'], sort_keys=True) == before and d['custom'] == {'keep': [1, 2]}, 'граф и неизвестные поля не тронуты')
            check(a.eval(E + '.activeTab().inst.dirty()') is False, 'после Save форма чистая')
            a.eval(E + ".activeTab().inst.setField('width','1280');1")
            run(a, E + '.save()')
            check(disk(root)['runtime']['window']['width'] == 1280, 'значение по умолчанию записывается, если его выбрали явно')
            a.eval(E + ".activeTab().inst.setField('width','0');1")
            check(run(a, E + '.save()') is False and disk(root)['runtime']['window']['width'] == 1280, 'неверное значение не пишется')
            a.eval(E + ".activeTab().inst.setField('width','1280');1")

            # Конфликт: файл изменён вне Editor
            d = disk(root)
            d['project']['version'] = '9.9.9'
            (root / 'project.json').write_text(json.dumps(d))
            a.eval(E + ".activeTab().inst.setField('wtitle','Другое');1")
            check(run(a, E + '.save()') is False, 'внешнее изменение блокирует Save формы')
            check(disk(root)['runtime']['window'].get('title') == 'Graph' and disk(root)['project']['version'] == '9.9.9',
                  'файл остался как на диске')
            a.eval(E + ".activeTab().inst.reread();1")
            check(a.eval(E + '.activeTab().inst.dirty()') is False, 'перечитать — форма берёт новую версию')

            # Вкладка JSON — тот же файл текстом
            run(a, E + ".openWith('" + str(root / 'project.json') + "','code')")
            check(a.eval(E + '.activeTab().kind') == 'code', 'вкладка JSON открывает текст')

        # Плоский манифест: миграция
        flat = root / 'flat'
        flat.mkdir()
        (flat / 'main.js').write_text(MAIN)
        (flat / 'project.json').write_text('{"title":"Flat","width":640,"height":360,"toolHost":false}')
        with Agent(game='editor', scene=str(flat), seed=5) as a:
            settle(a, E + '.state.project!==null && ' + E + '.state.busy===0')
            check(a.eval(E + '.manifest().v2') is False, 'плоский манифест читается как есть')
            run(a, E + ".openFile('project.json')")
            settle(a, E + '.activeTab().api!==undefined && !!' + E + '.activeTab().api')
            check(a.eval(E + '.activeTab().inst.snapshot().v2') is False, 'Project Settings показывает баннер миграции')
            run(a, E + '.migrateProject()')
            settle(a, E + '.state.busy===0 && ' + E + '.state.indexing===false')
            d = disk(flat)
            check(d.get('schema_version') == 2 and d['runtime']['window']['width'] == 640 and d['project']['name'] == 'Flat'
                  and d.get('toolHost') is False and d['editor']['graph']['status'] == 'current',
                  'миграция: schema_version 2, настройки перенесены, граф построен')
            check(a.eval(E + '.manifest().v2') is True and a.eval(E + '.graphInfo().objects') == 2, 'Editor перечитал манифест и граф')
            check(not [x for x in a.eval(E + '.state.projectDiags') if x.get('severity') == 'error'], 'после миграции validate без ошибок')


if __name__ == '__main__':
    sys.exit(main())
