#!/usr/bin/env python3
"""Панель «Агент» Editor: цикл модель→инструмент→модель на моканой сети, подтверждение записи."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent as _Agent
from editor_hammer_test import run, settle



def Agent(*args, **kwargs):
    # панель запоминает настройки в agent.local.json: каждый сценарий начинает с чистого листа
    Path('agent.local.json').unlink(missing_ok=True)
    return _Agent(*args, **kwargs)


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


def tool_call(i, name, args):
    return reply({'type': 'tool_use', 'id': 'h%d' % i, 'name': name, 'input': args})


def _hammer(directory):
    import shutil
    project = Path(directory) / 'hproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Hammer agent', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    shutil.copyfile(ROOT / 'tests/fixtures/sdk/world/editor_base.re2dmap', project / 'a.re2dmap')
    steps = [
        tool_call(1, 'open_tab', {'path': 'a.re2dmap'}),
        tool_call(2, 'studio_state', {}),
        tool_call(3, 'studio_op', {'op': 'brush.create', 'args': {'rect': [96, 96, 32, 32], 'bottom': 0, 'top': 64, 'id': 'agent.box'}}),
        tool_call(4, 'studio_op', {'op': 'validate', 'args': []}),
        tool_call(5, 'studio_save', {}),
        reply({'type': 'text', 'text': 'Карта собрана.'}),
    ]
    with Agent(game='editor', scene=str(project), seed=13) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';globalThis.__seen=[];'
                   '$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' +
                   D + '.setValue("ag-input","собери бокс на карте");' + D + '.click("ag-send");1')
        # студийные операции требуют подтверждения: отвечаем «Разрешить» на каждый запрос
        for _ in range(3):
            settle(agent, E + '.agent.state.pending!==null || !' + E + '.agent.state.busy', seconds=40)
            if agent.eval(E + '.agent.state.pending!==null'):
                agent.eval(D + '.click("ag-yes");1')
        settle(agent, '!' + E + '.agent.state.busy', seconds=40)
        check(agent, D + '.content("ag-log").includes("Карта собрана.")', 'Hammer: агент прошёл open_tab → studio_op → studio_save')
        check(agent, E + '.activeTab().api.id==="hammer"', 'Hammer: карта открыта в студии')
        saved = (project / 'a.re2dmap').read_text(encoding='utf-8')
        checks_ok = '"agent.box"' in saved
        check(agent, 'true' if checks_ok else 'false', 'Hammer: brush.create сохранён в .re2dmap на диске')


def _game(directory):
    dest = Path(directory) / 'newgame'
    start = Path(directory) / 'start'
    start.mkdir()
    (start / 'project.json').write_text(json.dumps({'format': 2, 'title': 'start', 'entry': 'main.js'}))
    (start / 'main.js').write_text('$.ready(() => {});\n')
    steps = [
        tool_call(1, 'editor_op', {'op': 'new_project', 'args': {'template': 'blank', 'dir': str(dest), 'name': 'Агентская игра'}}),
        tool_call(2, 'write_file', {'path': 'main.js', 'content': '$.scene.add("level", ($) => { $("<sprite>", { id: "hero", x: 100, y: 100 }).appendTo($.world); });\n$.ready(() => { $.log("агент: старт"); });\n'}),
        tool_call(21, 'snippet_find', {'query': 'platformer'}),
        tool_call(22, 'snippet_apply', {'owner': 'object:hero', 'package': 'movement.platformer', 'values': {'speed': 300}}),
        tool_call(3, 'editor_op', {'op': 'create_tilemap', 'args': {}}),
        tool_call(4, 'open_tab', {'path': 'level.tilemap.json'}),
        tool_call(5, 'studio_ops', {}),
        tool_call(6, 'studio_op', {'op': 'paint', 'args': {'x': 0, 'y': 0, 'id': 1}}),
        tool_call(7, 'studio_save', {}),
        tool_call(8, 'r2d_cli', {'args': ['templates']}),
        tool_call(9, 'run_check', {'frames': 10}),
        reply({'type': 'text', 'text': 'Игра создана.'}),
    ]
    with Agent(game='editor', scene=str(start), seed=14) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';$.http._setBackend((r)=>globalThis.__q.shift());1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' +
                   D + '.setValue("ag-input","сделай игру");' + D + '.click("ag-send");1')
        for _ in range(400):
            agent.step(3)
            if agent.eval(E + '.agent.state.pending!==null'):
                agent.eval(D + '.click("ag-yes");1')
            elif not agent.eval(E + '.agent.state.busy'):
                break
        log = agent.eval('JSON.stringify(' + E + '.agent.state.log)')
        check(agent, D + '.content("ag-log").includes("Игра создана.")', 'игра: сценарий агента дошёл до конца')
        check(agent, E + '.state.project.abs===' + json.dumps(str(dest)), 'игра: new_project создал и открыл проект')
        check(agent, '$.fs.readText(' + json.dumps(str(dest / 'main.js')) + ').includes("агент: старт")', 'игра: write_file записал скрипт')
        tm = json.loads((dest / 'level.tilemap.json').read_text(encoding='utf-8'))
        check(agent, 'true' if tm['layers'][0]['data'][0][0] == 1 else 'false', 'игра: studio_op paint + studio_save записали тайл в tilemap')
        proj = json.loads((dest / 'project.json').read_text(encoding='utf-8'))
        inst = [i for i in proj.get('editor', {}).get('snippets', {}).get('instances', []) if i['package'] == 'movement.platformer']
        check(agent, 'true' if inst and inst[0]['values'].get('speed') == 300 and inst[0]['owner'] == 'object:hero' else 'false',
              'игра: snippet_apply записал экземпляр кирпичика со значениями')
        check(agent, 'true' if (dest / 'generated/snippets/index.js').is_file() else 'false', 'игра: код кирпичика сгенерирован')
        agent.eval(D + '.click("ag-undo");1'); agent.step(10)
        tm2 = json.loads((dest / 'level.tilemap.json').read_text(encoding='utf-8'))
        check(agent, 'true' if tm2['layers'][0]['data'][0][0] != 1 else 'false', 'игра: первый откат возвращает файл tilemap до studio_save')
        agent.eval(D + '.click("ag-undo");1'); agent.step(10)   # правка paint в памяти студии
        agent.eval(D + '.click("ag-undo");1'); agent.step(10)
        proj2 = json.loads((dest / 'project.json').read_text(encoding='utf-8'))
        inst2 = [i for i in proj2.get('editor', {}).get('snippets', {}).get('instances', []) if i['package'] == 'movement.platformer']
        check(agent, 'true' if not inst2 else 'false', 'игра: откат snippet_apply убирает кирпичик из project.json')
        check(agent, 'false' if (dest / 'generated/snippets/index.js').is_file() else 'true', 'игра: откат snippet_apply удаляет созданный генератором код')
        check(agent, 'false' if '"err"' in log else 'true', 'игра: ни один шаг сценария не вернул ошибку (' + log[-300:] + ')')


def _interact(directory):
    project = Path(directory) / 'iproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Interact', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    steps = [
        tool_call(1, 'plan', {'items': [{'text': 'Спросить жанр', 'status': 'doing'}, {'text': 'Записать заметку', 'status': 'pending'}]}),
        tool_call(2, 'ask_user', {'question': 'Какой жанр?', 'options': ['Платформер', 'Шутер']}),
        tool_call(3, 'search_project', {'query': 'ready'}),
        tool_call(4, 'write_file', {'path': 'notes.txt', 'content': 'жанр выбран'}),
        tool_call(5, 'plan', {'items': [{'text': 'Спросить жанр', 'status': 'done'}, {'text': 'Записать заметку', 'status': 'done'}]}),
        reply({'type': 'text', 'text': 'Готово, записал.'}),
    ]
    with Agent(game='editor', scene=str(project), seed=15) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';globalThis.__seen=[];$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' + D + '.setValue("ag-input","сделай игру");' + D + '.click("ag-send");1')
        settle(agent, E + '.agent.state.asking!==null', seconds=30)
        check(agent, D + '.content("ag-plan").includes("Спросить жанр")', 'чеклист плана показан в панели')
        check(agent, D + '.content("ag-ask").includes("Какой жанр?") && ' + D + '.content("ag-ask").includes("Шутер")', 'вопрос агента показан кнопками вариантов')
        agent.eval(D + '.click("ag-opt-0");1')
        settle(agent, E + '.agent.state.pending!==null', seconds=30)
        agent.eval(D + '.click("ag-yes");1')
        settle(agent, '!' + E + '.agent.state.busy', seconds=30)
        check(agent, 'String(globalThis.__seen[2].body).includes("ответ пользователя: Платформер")', 'ответ пользователя вернулся агенту')
        check(agent, 'String(globalThis.__seen[3].body).includes("main.js:1:")', 'search_project нашёл строку в файле')
        check(agent, '$.fs.exists(' + json.dumps(str(project / 'notes.txt')) + ')', 'файл создан агентом')
        agent.eval(D + '.click("ag-undo");1'); agent.step(6)
        check(agent, '!$.fs.exists(' + json.dumps(str(project / 'notes.txt')) + ')', 'кнопка отката удаляет созданный агентом файл')
        check(agent, D + '.content("ag-log").includes("Откат")', 'откат отмечен в журнале')


def _pixel(directory):
    project = Path(directory) / 'pxproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Pixel', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    steps = [
        tool_call(1, 'pixel_art', {'path': 'assets/coin.png', 'palette': {'k': '#1a1020', 'y': '#ffd040'}, 'scale': 8,
                                   'rows': ['..kkkk..', '.kyyyyk.', 'kyyyyyyk', 'kyyyyyyk', 'kyyyyyyk', 'kyyyyyyk', '.kyyyyk.', '..kkkk..']}),
        reply({'type': 'text', 'text': 'Монета нарисована.'}),
    ]
    with Agent(game='editor', scene=str(project), seed=17) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';globalThis.__seen=[];$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' + D + '.setValue("ag-input","нарисуй монету");' + D + '.click("ag-send");1')
        settle(agent, E + '.agent.state.pending!==null', seconds=30)
        check(agent, D + '.content("ag-ask").includes("coin.png")', 'pixel_art: карточка подтверждения называет файл')
        agent.eval(D + '.click("ag-yes");1')
        settle(agent, '!' + E + '.agent.state.busy', seconds=30)
        check(agent, 'String(globalThis.__seen[1].body).includes("8×8")', 'pixel_art: агент получил размер и ASCII-срез')
        check(agent, '$.fs.exists(' + json.dumps(str(project / 'assets/coin.png')) + ')', 'pixel_art: PNG записан в проект')
        check(agent, D + '.content("ag-log").includes("Монета нарисована.")', 'pixel_art: итоговый ответ показан')
        check(agent, D + '.rect("ag-log").h>50 && JSON.stringify(' + E + '.agent.state.log).includes("[preview:")', 'pixel_art: результат содержит превью, журнал отрисован')
        agent.eval(D + '.click("ag-undo");1'); agent.step(6)
        check(agent, '!$.fs.exists(' + json.dumps(str(project / 'assets/coin.png')) + ')', 'pixel_art: кнопка отката удаляет спрайт')


def _sound(directory):
    project = Path(directory) / 'sxproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Sound', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    steps = [
        tool_call(1, 'skill_load', {'name': 'generate-sound'}),
        tool_call(2, 'generate_sound', {'path': 'assets/sfx/jump.wav', 'text': 'короткий высокий прыжок', 'seed': 4}),
        reply({'type': 'text', 'text': 'Звук прыжка готов.'}),
    ]
    with Agent(game='editor', scene=str(project), seed=18) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';globalThis.__seen=[];$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' + D + '.setValue("ag-input","сделай звук прыжка");' + D + '.click("ag-send");1')
        settle(agent, E + '.agent.state.pending!==null', seconds=30)
        check(agent, D + '.content("ag-ask").includes("jump.wav")', 'generate_sound: карточка подтверждения называет файл')
        agent.eval(D + '.click("ag-yes");1')
        settle(agent, '!' + E + '.agent.state.busy', seconds=30)
        check(agent, 'String(globalThis.__seen[1].body).includes("generate_sound")', 'generate_sound: навык загружен до вызова инструмента')
        check(agent, 'String(globalThis.__seen[2].body).includes("звук assets/sfx/jump.wav (jump") && String(globalThis.__seen[2].body).includes("огибающая (слева")', 'generate_sound: агент получил огибающую и тип звука')
        wav = project / 'assets/sfx/jump.wav'
        check(agent, 'true' if wav.is_file() and wav.read_bytes()[:4] == b'RIFF' and wav.stat().st_size > 1000 else 'false', 'generate_sound: WAV записан в проект')
        check(agent, D + '.content("ag-log").includes("Звук прыжка готов.")', 'generate_sound: итоговый ответ показан')
        agent.eval(D + '.click("ag-undo");1'); agent.step(6)
        check(agent, 'true' if not wav.exists() else 'false', 'generate_sound: кнопка отката удаляет звук')


def _session(directory):
    project = Path(directory) / 'sproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Session fixture', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    first = [reply({'type': 'text', 'text': 'Первый ответ про платформер.'})]
    with Agent(game='editor', scene=str(project), seed=21) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(first) + ';$.http._setBackend((r)=>globalThis.__q.shift());1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' + D + '.setValue("ag-input","сделай платформер");' + D + '.click("ag-send");1')
        settle(agent, '!' + E + '.agent.state.busy && ' + D + '.content("ag-log").includes("Первый ответ")', seconds=20)
        check(agent, 'true' if (project / '.r2d-agent.json').is_file() else 'false', 'беседа: файл .r2d-agent.json записан в проект после хода')
        check(agent, '!$.fs.readText(' + json.dumps(str(project / '.r2d-agent.json')) + ').includes("\\"k\\"")', 'беседа: ключ не попал в файл беседы')
    second = [reply({'type': 'text', 'text': 'Продолжаю.'})]
    with Agent(game='editor', scene=str(project), seed=22) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval(D + '.click("bt-agent");1'); agent.step(6)
        check(agent, D + '.content("ag-log").includes("Первый ответ") && ' + D + '.content("ag-log").includes("восстановлена")', 'беседа: после перезапуска лента на месте')
        agent.eval('globalThis.__q=' + json.dumps(second) + ';globalThis.__seen=[];$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
        agent.eval(E + '.models.set("anthropic",{key:"k"});' + D + '.setValue("ag-input","что дальше?");' + D + '.click("ag-send");1')
        settle(agent, '!' + E + '.agent.state.busy && ' + D + '.content("ag-log").includes("Продолжаю.")', seconds=20)
        check(agent, 'String(globalThis.__seen[0].body).includes("сделай платформер")', 'беседа: модель получила прежнюю историю')
        agent.eval(D + '.click("ag-clear");1'); agent.step(4)
        check(agent, 'true' if not (project / '.r2d-agent.json').exists() else 'false', 'беседа: «новый чат» удаляет сохранённую беседу')


def _approve(directory):
    project = Path(directory) / 'aproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Approve fixture', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    steps = [tool_call(1, 'write_file', {'path': 'auto.txt', 'content': 'hi'}), reply({'type': 'text', 'text': 'Записал без вопросов.'})]
    with Agent(game='editor', scene=str(project), seed=31) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';$.http._setBackend((r)=>globalThis.__q.shift());1')
        agent.eval(E + '.models.set("anthropic",{key:"k"});' + D + '.click("bt-agent");' + D + '.click("ag-mode");1'); agent.step(3)
        check(agent, D + '.content("ag-mode").includes("Разрешать всё")&&' + E + '.models.state.autoApprove', 'кнопка режима переключается на «Разрешать всё»')
        agent.eval(D + '.setValue("ag-input","запиши файл");' + D + '.click("ag-send");1')
        settle(agent, '!' + E + '.agent.state.busy && ' + D + '.content("ag-log").includes("Записал без вопросов.")', seconds=20)
        check(agent, 'true' if (project / 'auto.txt').read_text() == 'hi' else 'false', 'в режиме «Разрешать всё» запись выполнена без подтверждения')
        agent.eval(D + '.click("ag-mode");1'); agent.step(3)
        check(agent, D + '.content("ag-mode").includes("Спрашивать")&&!' + E + '.models.state.autoApprove', 'кнопка возвращает режим «Спрашивать»')


def _assets(directory):
    import struct, zlib
    project = Path(directory) / 'asproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Assets fixture', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    def png(w, h):
        raw = b''.join(b'\x00' + b'\xff\x00\x00\xff' * w for _ in range(h))
        chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    dropped = Path(directory) / 'incoming'
    dropped.mkdir()
    (dropped / 'hero_sheet.png').write_bytes(png(64, 16))
    (dropped / 'jump.wav').write_bytes(b'RIFF$\x00\x00\x00WAVEfmt ')
    steps = [tool_call(1, 'asset_inventory', {}), reply({'type': 'text', 'text': 'Вижу ассеты.'})]
    with Agent(game='editor', scene=str(project), seed=41) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';globalThis.__seen=[];$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
        agent.eval(E + '.models.set("anthropic",{key:"k"});' + D + '.click("bt-agent");1'); agent.step(3)
        # окно получило два брошенных файла (SDL DROP_FILE доходит до $.input.dropped)
        agent.eval('globalThis.__drops=[' + json.dumps(str(dropped / 'hero_sheet.png')) + ',' + json.dumps(str(dropped / 'jump.wav')) + '];$.input.dropped=()=>{const d=globalThis.__drops;globalThis.__drops=[];return d;};1'); agent.step(4)
        check(agent, 'true' if (project / 'assets/hero_sheet.png').read_bytes()[:4] == b'\x89PNG' else 'false', 'drop: картинка скопирована в assets/')
        check(agent, 'true' if (project / 'assets/audio/jump.wav').is_file() else 'false', 'drop: звук скопирован в assets/audio/')
        check(agent, D + '.content("ag-log").includes("Добавлено в проект")', 'drop: в чате заметка о добавленных файлах')
        agent.eval(D + '.setValue("ag-input","сделай игру из этих ассетов");' + D + '.click("ag-send");1')
        settle(agent, '!' + E + '.agent.state.busy && ' + D + '.content("ag-log").includes("Вижу ассеты.")', seconds=30)
        check(agent, 'String(globalThis.__seen[0].body).includes("assets/hero_sheet.png")', 'drop: агент знает, какие файлы добавлены')
        check(agent, 'String(globalThis.__seen[1].body).includes("hero_sheet.png · 64") && String(globalThis.__seen[1].body).includes("4 кадров")', 'asset_inventory: размер и лист кадров')


def _limit(directory):
    project = Path(directory) / 'lproject'
    project.mkdir()
    (project / 'project.json').write_text(json.dumps({'format': 2, 'title': 'Limit', 'entry': 'main.js'}))
    (project / 'main.js').write_text('$.ready(() => {});\n')
    steps = [tool_call(1, 'list_files', {}), tool_call(2, 'list_files', {}), reply({'type': 'text', 'text': 'Дошёл до конца.'})]
    with Agent(game='editor', scene=str(project), seed=16) as agent:
        settle(agent, E + '.state.project!==null && ' + E + '.state.busy===0')
        agent.eval('globalThis.__q=' + json.dumps(steps) + ';$.http._setBackend((r)=>globalThis.__q.shift());1')
        agent.eval(D + '.click("bt-agent");' + E + '.models.set("anthropic",{key:"k"});' + E + '.models.setBehavior({maxSteps:2});' + D + '.setValue("ag-input","долгая задача");' + D + '.click("ag-send");1')
        settle(agent, 'JSON.stringify(' + E + '.agent.state.log).includes("limit")', seconds=40)
        settle(agent, '!' + E + '.agent.state.busy', seconds=20)
        check(agent, D + '.content("ag-log").includes("Продолжить")', 'при лимите шагов в журнале кнопка «Продолжить»')
        idx = agent.eval(E + '.agent.state.log.findIndex(e=>e.kind==="limit")')
        agent.eval(D + '.click("ag-continue-' + str(idx) + '");1')
        settle(agent, '!' + E + '.agent.state.busy && ' + D + '.content("ag-log").includes("Дошёл до конца")', seconds=40)
        check(agent, D + '.content("ag-log").includes("Дошёл до конца")', 'после продолжения агент завершает задачу')


def _run():
    with tempfile.TemporaryDirectory(prefix='r2d-agentpanel-') as directory:
        Path('agent.local.json').unlink(missing_ok=True)
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
            check(agent, E + '.agent.state.open && ' + D + '.rect("ag").h>150', 'вкладка «Агент» в нижней панели открывает чат')
            # шестерёнка в шапке агента открывает вкладку «Модели»
            agent.eval(D + '.click("ag-gear");1'); agent.step(8)
            check(agent, E + '.activeTab()&&' + E + '.activeTab().path==="agent:models"', 'шестерёнка открывает вкладку «Модели»')
            check(agent, E + '.activeTab().api.snapshot().providers.length>=7', 'во вкладке «Модели» видны все провайдеры')
            agent.eval('$.http._setBackend((r)=>({status:200,body:JSON.stringify({content:[{type:"text",text:"ок"}]}),headers:""}));1')
            agent.eval(E + '.activeTab().api.doc.setValue("md-key","test-key");1')
            agent.eval(E + '.activeTab().api.act("test:anthropic");1')
            agent.step(30)
            check(agent, E + '.models.configured("anthropic")&&' + E + '.models.profile("anthropic").key==="test-key"', 'ключ из формы подключает провайдера (зелёная точка)')
            # свой провайдер: форма → хранилище → agent.local.json
            agent.eval(E + '.activeTab().api.act("add:x");1'); agent.step(4)
            agent.eval(D.replace('$.ui.doc("ui/editor.rml")', E + '.activeTab().api.doc') + '.setValue("md-n-label","Мой шлюз");' + E + '.activeTab().api.doc.setValue("md-n-id","gw-test");' + E + '.activeTab().api.doc.setValue("md-n-base","https://gw.example/v1");' + E + '.activeTab().api.doc.setValue("md-n-model","m-1");1')
            agent.eval(E + '.activeTab().api.act("create:x");1'); agent.step(4)
            check(agent, E + '.models.list().some((r)=>r.id==="gw-test"&&r.custom)&&$.fs.readJSON("agent.local.json",null).custom[0].id==="gw-test"', 'свой провайдер добавляется во вкладке и сохраняется')
            agent.eval(E + '.closeTab("agent:models");1'); agent.step(3)
            agent.eval('globalThis.__q=' + json.dumps(scripted) + ';globalThis.__seen=[];'
                       '$.http._setBackend((r)=>{globalThis.__seen.push(r);return globalThis.__q.shift();});1')
            agent.eval(D + '.setValue("ag-input","прочитай main.js и запиши notes.txt");' + D + '.click("ag-send");1')
            # маскот: пока агент занят, кадр и иконка на вкладке меняются
            settle(agent, E + '.agent.state.busy', seconds=10)
            check(agent, E + '.agent.state.mascot.state.mode!=="idle" && ' + D + '.attr("bt-agent-mc","class")!=="mc-idle-0"', 'маскот играет рабочую анимацию, иконка на вкладке меняется')
            settle(agent, E + '.agent.state.pending!==null')
            check(agent, E + '.agent.state.mascot.state.mode==="waiting" && ' + D + '.content("mc-bubble").includes("подтверждение")', 'в ожидании подтверждения маскот спрашивает')
            check(agent, 'globalThis.__seen.length===2', 'после чтения файла модель вызвана повторно')
            check(agent, D + '.content("ag-ask").includes("Разрешить") && !$.fs.exists(' + json.dumps(str(project / 'notes.txt')) + ')',
                  'запись ждёт подтверждения и ещё не выполнена')
            agent.eval(D + '.click("ag-yes");1')
            settle(agent, '!' + E + '.agent.state.busy')
            check(agent, '$.fs.readText(' + json.dumps(str(project / 'notes.txt')) + ')==="hi"', 'после подтверждения файл записан')
            check(agent, D + '.content("ag-log").includes("Готово.")', 'итоговый ответ показан в панели')
            check(agent, '(()=>{const h=globalThis.__seen[0].headers;const i=h.indexOf("x-api-key");return i>=0&&h[i+1]==="test-key"&&!String(globalThis.__seen[0].body).includes("test-key");})()', 'ключ уходит только в заголовок запроса')
            check(agent, '!JSON.stringify($.fs.readText(' + json.dumps(str(project / 'project.json')) + ')).includes("test-key")', 'ключ не записан в project.json')
            # настройки живут между запусками (без ключа)
            agent.eval(E + '.models.set("gigachat",{model:"GigaChat-2-Max",key:"secret-xyz"});' + E + '.models.activate("gigachat");' + E + '.models.setBehavior({maxSteps:31,mascotOn:false});1'); agent.step(3)
            check(agent, '(()=>{const p=$.fs.readJSON("agent.local.json",null);return !!p&&p.active==="gigachat"&&p.maxSteps===31&&p.mascotOn===false&&p.profiles.gigachat.model==="GigaChat-2-Max";})()', 'настройки агента сохранены в agent.local.json')
            check(agent, '!$.fs.readText("agent.local.json").includes("secret-xyz")', 'ключ не попал в файл настроек')
            agent.eval('$.fs.remove("agent.local.json");1')
        _hammer(directory)
        _game(directory)
        _interact(directory)
        _limit(directory)
        _pixel(directory)
        _sound(directory)
        _session(directory)
        _approve(directory)
        _assets(directory)
    print(f'editor_agent_panel_test: {checks} checks', flush=True)
    return 0


def warm_index():
    # Индекс эмбеддингов привязан к хешу текстов документации: после правки доков первый запрос
    # строит его заново (~минута) — прогреваем заранее, чтобы не упираться в таймауты сценариев.
    import os, subprocess
    binary = os.environ.get('R2D_BINARY') or str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d')
    subprocess.run([binary, 'docs', 'context', 'прогрев', '--limit', '1', '--quiet'], capture_output=True, timeout=600, cwd=ROOT)


def main():
    # Тесты пишут agent.local.json в корень запуска — настройки живого Editor не трогаем: сохраняем и возвращаем.
    prefs = Path('agent.local.json')
    saved = prefs.read_bytes() if prefs.exists() else None
    try:
        return _main()
    finally:
        if saved is None: prefs.unlink(missing_ok=True)
        else: prefs.write_bytes(saved)


def _main():
    warm_index()
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
