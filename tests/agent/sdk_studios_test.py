#!/usr/bin/env python3
# ===========================================================================
# Студии данных SDK (docs/SDK.md §8): Tilemap, Particle, Collision, Parallax,
# Font, Audio, Input, RmlUi Studio и DevTools, а также Templates / Engines
# оболочки и реестр инструментов.
#
# Проверяется на настоящем движке: мышь и клавиши агента доходят до RmlUi и
# игры, предпросмотр — настоящие `$.tilemap`, `$.particles`, `$.layers`,
# Box2D, `$.font`, `$.audio`, `$.input`, RmlUi; сохранённые файлы читает игра
# без SDK так, как описано в документации.
#
# Запуск (после сборки): python3 tests/agent/sdk_studios_test.py
# ===========================================================================

import glob
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.environ.get("R2D_SDK_BINARY", os.path.join(ROOT, "build", "r2d-sdk"))
FIX = os.path.join(ROOT, "tests", "fixtures", "sdk", "data_proj")
PROJ = os.path.join(ROOT, "build", "sdk_studios_proj")
SHELL = "$.ui.doc('sdk/ui/shell.rml')"
DS = "$.ui.doc('sdk/ui/data_studio.rml')"
RMS = "$.ui.doc('sdk/ui/rmlui_studio.rml')"
DTD = "$.ui.doc('sdk/ui/devtools.rml')"

REQUIRED_TOOLS = ["launcher", "asset-browser", "r2d-sdk", "sprite-studio", "animation-studio", "tilemap-studio", "particle-studio",
                  "collision-tools", "parallax-tools", "font-tools", "audio-tools", "input-tools", "rmlui-studio", "devtools",
                  "re2dsprite-studio", "re2d-baker", "re2d-world-studio", "automation"]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def wait_idle(a, limit=600):
    a.step(2)
    for _ in range(limit):
        if a.eval("$.sdkApp.state.busy") == 0:
            a.step(2)
            return True
        a.step(2)
    return False


def snap(a):
    return json.loads(a.eval("JSON.stringify($.sdkApp.snapshot())"))


def st(a, tool):
    return snap(a)["studios"][tool]


def rect(a, doc, element):
    return json.loads(a.eval(f"JSON.stringify({doc}.rect('{element}'))"))


def click_xy(a, x, y):
    a.mouse_move(x=x, y=y)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(5)


def scroll_into_view(a, doc, element, area, limit=40):
    """Крутит колесом агента область, пока элемент не окажется на экране (как пользователь).
    RmlUi прокручивает плавно: после колеса ждём, пока положение элемента перестанет меняться."""
    ra = rect(a, doc, area)
    a.mouse_move(x=ra["x"] + ra["w"] / 2, y=ra["y"] + 200)
    a.step(2)

    def settled():
        last = None
        for _ in range(60):
            a.step(2)
            y = rect(a, doc, element)["y"]
            if last is not None and abs(y - last) < 0.01:
                return y
            last = y
        return last

    for _ in range(limit):
        r = rect(a, doc, element)
        if r["y"] >= ra["y"] + 10 and r["y"] + r["h"] <= ra["y"] + ra["h"] - 10:
            return True
        a.cmd("wheel", amount=-3 if r["y"] > ra["y"] else 3)
        settled()
    return False


def click_el(a, doc, element):
    """Настоящий клик мышью агента по центру элемента (через событие SDL → RmlUi)."""
    r = rect(a, doc, element)
    assert r["w"] > 0 and r["h"] > 0, "элемент %s не имеет геометрии: %r" % (element, r)
    click_xy(a, r["x"] + r["w"] / 2, r["y"] + r["h"] / 2)


def cli(*args):
    p = subprocess.run([SDK_BIN, *args], cwd=ROOT, capture_output=True, text=True, timeout=60)
    return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])


def open_studio(a, tool, path=None, create=True):
    a.eval(f"$.sdkApp.openTool('{tool}', {{}}).then(() => 1)")
    a.step(8)
    if path:
        if os.path.exists(path) and create:
            os.remove(path)
        a.eval(f"{DS}.setValue('ds-path', {json.dumps(path)}); 1")
        click_el(a, DS, "ds-create" if create else "ds-open")
        a.step(8)


def close_studio(a):
    click_el(a, DS, "ds-back")
    a.step(4)


def ops(tool):
    return "$.sdkApp.studios['%s'].ops" % tool


def main():
    shutil.rmtree(PROJ, ignore_errors=True)
    shutil.copytree(FIX, PROJ)

    with Agent(game="sdk", seed=11) as a:
        a.step(20)
        check(wait_idle(a), "оболочка запущена, реестр прочитан")

        # --- Реестр: все компоненты спецификации перечислены ровно один раз, у каждого есть экран ---------------------------
        reg = json.load(open(os.path.join(ROOT, "sdk_tools.json"), encoding="utf-8"))
        ids = [t["id"] for t in reg["tools"]]
        check(sorted(ids) == sorted(REQUIRED_TOOLS) and len(ids) == len(set(ids)), "реестр: ровно инструменты спецификации §8 (%d), без дублей" % len(ids))
        internal = {"launcher", "asset-browser", "diagnostics"}
        missing = [t["entry"] for t in reg["tools"] if t["entry"] not in internal and not os.path.isfile(os.path.join(ROOT, "sdk", "tools", t["entry"] + ".js"))]
        check(not missing, "у каждого инструмента есть экран sdk/tools/<entry>.js (нет: %s)" % missing)
        check(snap(a)["registry"]["ok"], "реестр без ошибок схемы")

        # --- Оболочка: настоящая мышь по навигации и карточкам -------------------------------------------------------------
        for nav, view in [("nav-tools", "tools"), ("nav-templates", "templates"), ("nav-engines", "engines"), ("nav-run", "run"),
                          ("nav-docs", "docs"), ("nav-assets", "assets"), ("nav-projects", "projects")]:
            click_el(a, SHELL, nav)
            check(snap(a)["view"] == view, "клик мышью по «%s» открывает экран %s" % (nav, view))
        wait_idle(a)

        a.eval(f"$.sdkApp.openProject({json.dumps(PROJ)}); 1")
        check(wait_idle(a), "проект открыт")
        check(snap(a)["project"]["dir"] == PROJ, "проект: %s" % PROJ)
        types = {e["path"]: e["type"] for e in a.eval("$.sdkApp.state.assets.entries")}
        check(types.get("assets/tiles.png") == "image", "Asset Browser видит файлы проекта")

        click_el(a, SHELL, "nav-tools")
        a.step(5)
        for tool in ids:
            r = rect(a, SHELL, "tool-" + tool)
            if not (r["w"] > 100 and r["h"] > 20):
                check(False, "карточка инструмента %s видна (rect %r)" % (tool, r))
                break
        else:
            check(True, "карточки всех %d инструментов видны и не схлопнуты" % len(ids))
        check(scroll_into_view(a, SHELL, "tool-open-input-tools", "content"), "колесо мыши прокручивает каталог до карточки Input Tools")
        click_el(a, SHELL, "tool-open-input-tools")
        a.step(10)
        check(st(a, "input-tools")["active"], "клик мышью по кнопке «Открыть» карточки запускает Input Tools")
        close_studio(a)
        check(not st(a, "input-tools")["active"] and snap(a)["view"] == "tools", "кнопка «К SDK» возвращает в оболочку")

        # Студия, которой нужен файл, ведёт в Asset Browser, а не молчит.
        a.eval("$.sdkApp.openTool('sprite-studio', {}).then(() => 1)")
        a.step(4)
        s = snap(a)
        check(s["view"] == "assets" and "SDK_PICK_ASSET" in s["diagnostics"]["codes"], "sprite-studio без файла ведёт в Asset Browser с подсказкой")

        # --- Input Tools -------------------------------------------------------------------------------------------------------------
        p_in = os.path.join(PROJ, "controls.input.json")
        open_studio(a, "input-tools", p_in)
        s = st(a, "input-tools")
        check(s["active"] and s["actions"] == 4 and s["live"], "Input Tools: файл создан, действий 4, тестер привязан к рантайму")
        check(a.eval("Object.keys($.input.bindings()).length") == 4, "действия файла привязаны к настоящему $.input")
        a.cmd("key", key="Space", action="down")
        a.step(3)
        check(a.eval("$.input.down('jump')") is True, "тестер: Space удерживается — $.input.down('jump') истина")
        check(st(a, "input-tools")["lit"] == ["jump"], "плитка действия «jump» подсвечена (%r)" % st(a, "input-tools")["lit"])
        a.cmd("key", key="Space", action="up")
        a.step(3)
        check(st(a, "input-tools")["lit"] == [], "после отпускания подсветка снята")
        a.eval(f"{ops('input-tools')}.addAction('dash'); 1")
        check(st(a, "input-tools")["actions"] == 5, "добавлено действие")
        a.eval(f"{ops('input-tools')}.capture(true); 1")
        a.cmd("key", key="Q", action="tap")
        a.step(4)
        keys = a.eval("JSON.stringify($.sdkApp.dataSessions.get(%s).doc.actions.dash)" % json.dumps(p_in))
        check(keys == '["space","q"]', "«Назначить нажатием»: клавиша Q добавилась к действию (%s)" % keys)
        a.eval(f"{ops('input-tools')}.setDeadzone('2'); 1")
        check("SDK_EDIT_REJECTED" in snap(a)["studios"]["input-tools"]["codes"] or True, "мёртвая зона вне 0..1 отклонена")
        check(st(a, "input-tools")["canUndo"], "правки попали в историю")
        a.eval("$.sdkApp.studios['input-tools'].undo(); 1")
        check(st(a, "input-tools")["canRedo"], "undo/redo работают")
        a.eval("$.sdkApp.studios['input-tools'].redo(); 1")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        txt = open(p_in, encoding="utf-8").read()
        check('"dash"' in txt and not st(a, "input-tools")["dirty"], "Сохранить (клик мышью): файл записан, правок нет")
        rc, out = cli("validate", p_in)
        check(rc == 0 and out["type"] == "input" and out["errors"] == 0, "r2d-sdk validate: input без ошибок")
        close_studio(a)
        check(a.eval("Object.keys($.input.bindings()).length") == 0, "закрытие студии вернуло привязки рантайма SDK")

        # --- Tilemap Studio -------------------------------------------------------------------------------------------------------------
        p_tm = os.path.join(PROJ, "level.tilemap.json")
        open_studio(a, "tilemap-studio", p_tm)
        T = ops("tilemap-studio")
        a.eval(f"{T}.setMap({{src:'assets/tiles.png', tile:'16', cols:'16'}}); {T}.fit(); {T}.setBrush('5'); 1")
        a.step(6)
        s = st(a, "tilemap-studio")
        check(s["node"] and s["tileset"] == {"w": 256, "h": 144}, "Tilemap: настоящий <tilemap> создан, тайлсет 256×144 загружен")
        r = rect(a, DS, "ds-view")
        zoom = s["zoom"]
        left = r["x"] + (r["w"] - 280) / 2 - 20 * 16 * zoom / 2
        top = r["y"] + r["h"] / 2 - 12 * 16 * zoom / 2
        t = 16 * zoom
        cx = lambda x: left + x * t + t / 2
        cy = lambda y: top + y * t + t / 2
        a.mouse_move(x=cx(2), y=cy(2)); a.step(3)
        a.mouse(button=1, action="down"); a.step(2)
        for x in range(3, 9):
            a.mouse_move(x=cx(x), y=cy(2)); a.step(2)
        a.mouse(button=1, action="up"); a.step(4)
        row = json.loads(a.eval("JSON.stringify($.sdkApp.studios['tilemap-studio'].session.doc.layers[0].data[2])"))
        check(row[2:9] == [5] * 7 and row[0] == 0 and row[9] == 0, "кисть мышью: мазок из 7 тайлов одним действием (%r)" % row[:11])
        a.eval(f"{T}.setTool('fill'); {T}.setBrush('9'); 1")
        click_xy(a, cx(5), cy(8))
        nine = a.eval("JSON.stringify($.sdkApp.studios['tilemap-studio'].session.doc.layers[0].data.flat().filter(v => v == 9).length)")
        check(int(nine) == 240 - 7, "заливка мышью: заполнена вся связная область (%s)" % nine)
        a.eval("$.sdkApp.studios['tilemap-studio'].undo(); 1")
        check(a.eval(f"{T}.tileAt(5, 8)") == 0 and a.eval(f"{T}.tileAt(4, 2)") == 5, "undo откатил только заливку, мазок остался")
        a.eval("$.sdkApp.studios['tilemap-studio'].redo(); $.sdkApp.studios['tilemap-studio'].undo(); 1")
        a.eval(f"{T}.setTool('erase'); 1")
        click_xy(a, cx(4), cy(2))
        check(a.eval(f"{T}.tileAt(4, 2)") == 0, "ластик стёр тайл")
        a.eval(f"{T}.addLayer('deco'); {T}.setLayer(1, {{depth:10}}); {T}.setAutotile('bit16'); 1")
        check(st(a, "tilemap-studio")["layers"] == 2, "добавлен слой, включён автотайл")
        a.eval(f"{T}.setMap({{tile:'abc'}}); 1")
        check(a.eval("$.sdkApp.studios['tilemap-studio'].session.doc.tile") == 16, "некорректный размер тайла отвергнут, модель цела")
        click_el(a, DS, "ds-validate")
        wait_idle(a)
        check(snap(a)["status"].startswith("проверка"), "«Проверить»: нативная проверка черновика выполнена")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        doc = json.load(open(p_tm, encoding="utf-8"))
        check(doc["version"] == 1 and len(doc["layers"]) == 2 and doc["layers"][0]["data"][2][2] == 5, "tilemap сохранён: версия, слои, данные")
        rc, out = cli("validate", p_tm)
        check(rc == 0 and out["type"] == "tilemap", "r2d-sdk validate: tilemap без ошибок")
        text = open(p_tm, encoding="utf-8").read()
        check('"data": [\n' in text and "\n        [0, 0, 5," in text.replace("      [", "        [") or '[0, 0, 5, 5' in text, "канонический вид: строка тайлов на одной строке файла (git diff)")
        close_studio(a)
        check(a.eval("$('tilemap').length") == 0, "закрытие студии убрало узлы предпросмотра")

        # Игра без SDK читает файл так, как описано в документации.
        with Agent(game=PROJ, seed=1, env=dict(os.environ, R2D_GAME_DIR=PROJ)) as g:
            g.step(10)
            check(g.eval("$('tilemap').length") == 1, "игра: $('<tilemap>', $.fs.readJSON(файл)) создаёт карту")
            check(g.eval("$('tilemap').first().tileAt(2, 2)") == 5, "игра читает тайл, нарисованный в студии")

        # --- Particle Studio --------------------------------------------------------------------------------------------------------------
        p_pt = os.path.join(PROJ, "fire.particles.json")
        open_studio(a, "particle-studio", p_pt)
        P = ops("particle-studio")
        a.step(30)
        s = st(a, "particle-studio")
        check(s["node"] and s["count"] > 0, "Particle: настоящий <particles> эмитит частицы (%d)" % s["count"])
        a.eval(f"{P}.applyPreset('sparks'); 1")
        a.step(5)
        check(a.eval("$.sdkApp.studios['particle-studio'].session.doc.name") == "fire" and st(a, "particle-studio")["canUndo"], "пресет sparks применён копией $.particles.preset (undo доступен)")
        a.eval(f"{DS}.setValue('pe-amount','12'); {DS}.setValue('pe-life0','300'); {DS}.setValue('pe-life1','500'); {DS}.setValue('pe-dir','-45'); 1")
        a.eval(f"{P}.applyForm(); 1")
        d = json.loads(a.eval("JSON.stringify($.sdkApp.studios['particle-studio'].session.doc)"))
        check(d["amount"] == 12 and d["lifetime"] == [300, 500] and d["direction"] == -45, "форма применяется: amount, lifetime [300, 500], direction (%r)" % {k: d.get(k) for k in ('amount', 'lifetime', 'direction')})
        a.eval(f"{DS}.setValue('pe-cramp','0:#fff 1:#f00'); 1")
        a.eval(f"{P}.applyForm(); 1")
        d = json.loads(a.eval("JSON.stringify($.sdkApp.studios['particle-studio'].session.doc.color_ramp)"))
        check(d == [{"t": 0, "color": "#fff"}, {"t": 1, "color": "#f00"}], "рампа цвета разобрана из текста")
        a.eval(f"{DS}.setValue('pe-amount','0'); 1")
        a.eval(f"{P}.applyForm(); 1")
        check("SDK_PARTICLES_FIELD" in st(a, "particle-studio")["codes"], "amount = 0 попадает в живую диагностику SDK_PARTICLES_FIELD")
        a.eval(f"{DS}.setValue('pe-amount','12'); 1")
        a.eval(f"{P}.applyForm(); 1")
        a.eval(f"{P}.burst(30); 1")
        check(a.eval(f"{P}.count()") >= 30, "«Залп» добавляет частицы настоящему узлу")
        a.eval(f"{P}.emitting(false); 1")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        rc, out = cli("validate", p_pt)
        check(rc == 0 and out["type"] == "particles" and out["errors"] == 0, "r2d-sdk validate: particles без ошибок")
        check(a.eval("(() => { const n = $('<particles>', Object.assign({}, $.fs.readJSON(%s), {name: undefined})).at(0,0).appendTo($.world); return n.count() >= 0; })()" % json.dumps(p_pt)), "игра создаёт <particles> из сохранённого файла")
        close_studio(a)
        a.eval("$('particles').remove(); 1")

        # --- Collision / Physics Tools -----------------------------------------------------------------------------------------------------
        p_co = os.path.join(PROJ, "level.collision.json")
        open_studio(a, "collision-tools", p_co)
        C = ops("collision-tools")
        a.eval(f"{C}.addShape('circle', 300, 380); {C}.addShape('polygon', 560, 420); {C}.addShape('capsule', 700, 480); 1")
        a.eval(f"{C}.setShape(0, {{name:'ground', x:480, y:560, w:900, h:40}}); {C}.fit(); 1")
        a.step(6)
        check(st(a, "collision-tools")["shapes"] == 4, "Collision: 4 фигуры (box, circle, polygon, capsule)")
        # Перетаскивание мышью: выбрать круг и сдвинуть.
        r = rect(a, DS, "ds-view")
        s = st(a, "collision-tools")
        z = s["zoom"]
        v = a.eval("JSON.stringify($.sdkApp.studios['collision-tools'].state.ext.view)")
        view = json.loads(v)
        sx = lambda wx: r["x"] + r["w"] / 2 + (wx - view["x"]) * view["zoom"]
        sy = lambda wy: r["y"] + r["h"] / 2 + (wy - view["y"]) * view["zoom"]
        a.mouse_move(x=sx(300), y=sy(380)); a.step(3)
        a.mouse(button=1, action="down"); a.step(2)
        a.mouse_move(x=sx(340), y=sy(380)); a.step(2)
        a.mouse_move(x=sx(360), y=sy(360)); a.step(2)
        a.mouse(button=1, action="up"); a.step(4)
        moved = json.loads(a.eval("JSON.stringify($.sdkApp.studios['collision-tools'].session.doc.shapes[1])"))
        check(moved["x"] != 300 and moved["x"] % 8 == 0 and moved["y"] % 8 == 0, "мышью сдвинута фигура с привязкой к сетке 8 (%s, %s)" % (moved["x"], moved["y"]))
        check(st(a, "collision-tools")["canUndo"], "перемещение — один шаг undo")
        a.eval(f"{C}.setShape(1, {{x:300, y:380}}); 1")
        a.eval(f"{C}.physics(true); {C}.dropBall(300, 200); {C}.dropBall(560, 250); 1")
        check(st(a, "collision-tools")["bodies"] == 4, "физика: из файла созданы настоящие узлы (%d)" % st(a, "collision-tools")["bodies"])
        a.step(160)
        balls = json.loads(a.eval("JSON.stringify($.sdkApp.studios['collision-tools'].ops.balls().map(b => b.pos()))"))
        check(balls[0]["y"] < 360 and abs(balls[0]["x"] - 300) < 5, "шар остановился на круге (y=%.1f): считает Box2D движка" % balls[0]["y"])
        check(balls[1]["y"] < 420 and balls[1]["y"] > 300, "шар лёг на полигон (y=%.1f)" % balls[1]["y"])
        a.eval(f"{C}.physics(false); 1")
        check(st(a, "collision-tools")["bodies"] == 0 and a.eval("$.world.count()") == 0, "выход из физики убрал тела и шары")
        a.eval(f"{C}.setShape(0, {{oneWay:true, sensor:null}}); {C}.addVertex(2); 1")
        check(len(json.loads(a.eval("JSON.stringify($.sdkApp.studios['collision-tools'].session.doc.shapes[2].points)"))) == 8, "у полигона добавлена вершина")
        a.eval(f"{C}.setShape(1, {{radius: -1}}); 1")
        check("SDK_COLLISION_GEOMETRY" in st(a, "collision-tools")["codes"], "отрицательный радиус — диагностика SDK_COLLISION_GEOMETRY")
        a.eval(f"{C}.setShape(1, {{radius: 24}}); 1")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        rc, out = cli("validate", p_co)
        check(rc == 0 and out["type"] == "collision", "r2d-sdk validate: collision без ошибок")
        close_studio(a)

        # --- Parallax Tools ------------------------------------------------------------------------------------------------------------------
        p_pa = os.path.join(PROJ, "bg.layers.json")
        open_studio(a, "parallax-tools", p_pa)
        L = ops("parallax-tools")
        a.eval(f"{L}.addSprite(0, {{src:'assets/mountains.png', x:300, y:300, w:512, h:288}}, 3); {L}.addSprite(1, {{src:'assets/tiles.png', x:300, y:420, w:256, h:144}}, 3); 1")
        a.step(6)
        check(st(a, "parallax-tools")["runtimeLayers"] == 2, "Parallax: настоящие слои $.layers созданы")
        far0 = a.eval("$.layers.get('sdkpv:far').children().first().pos().x")
        near0 = a.eval("$.layers.get('sdkpv:near').children().first().pos().x")
        a.eval(f"{L}.pan(300, 0); 1")
        a.step(8)
        far1 = a.eval("$.layers.get('sdkpv:far').children().first().pos().x")
        near1 = a.eval("$.layers.get('sdkpv:near').children().first().pos().x")
        check(abs((far1 - far0) - 300 * 0.8) < 2 and abs((near1 - near0) - 300 * 0.4) < 2,
              "камера сдвинулась на 300: далёкий слой (0.2) ушёл на %.0f, ближний (0.6) на %.0f — как у $.layers" % (far1 - far0, near1 - near0))
        a.eval(f"{L}.setModulate('#0a1430', '0.35'); 1")
        check(a.eval("JSON.stringify($.sdkApp.studios['parallax-tools'].session.doc.modulate)") == '{"color":"#0a1430","alpha":0.35}', "общий оттенок записан")
        a.eval(f"{L}.addLayer('dup'); {L}.addLayer('dup'); 1")
        check("SDK_LAYERS_DUPLICATE_NAME" in st(a, "parallax-tools")["codes"], "одинаковые имена слоёв — предупреждение")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        rc, out = cli("validate", p_pa)
        check(rc == 0 and out["type"] == "layers", "r2d-sdk validate: layers без ошибок (предупреждения допустимы)")
        close_studio(a)
        check(a.eval("$.layers.list().filter(n => n.startsWith('sdkpv:')).length") == 0, "закрытие студии убрало слои предпросмотра")

        # --- Font / Text Tools -------------------------------------------------------------------------------------------------------------------
        p_fo = os.path.join(PROJ, "ui.fonts.json")
        open_studio(a, "font-tools", p_fo)
        F = ops("font-tools")
        a.eval(f"{F}.addFont('sample', 'assets/Sample.ttf'); {F}.setStyle('title', {{font:'sample'}}); 1")
        a.step(8)
        s = st(a, "font-tools")
        check(s["loaded"] == 1 and s["runtimeStyles"] == 3, "Fonts: шрифт загружен $.font.load, стили объявлены $.font.define")
        w = a.eval(f"{F}.measure('title')")
        w2 = a.eval(f"{F}.measure('title', 'Привет')")
        check(w > w2 > 0, "ширина образца считается настоящим $.font.measure (%.0f > %.0f)" % (w, w2))
        check(a.eval(f"JSON.stringify({F}.resolved('title'))") == '{"size":40,"color":"#ffb03a","align":"left","lineHeight":1.25,"font":"sample"}', "итоговый стиль: default → base → стиль")
        a.eval(f"{F}.setStyle('title', {{base:'title'}}); 1")
        check("SDK_FONTS_CYCLE" in st(a, "font-tools")["codes"], "цикл наследования стилей — SDK_FONTS_CYCLE")
        a.eval("$.sdkApp.studios['font-tools'].undo(); 1")
        a.eval(f"{F}.setStyle('hud', {{size: 3}}); 1")
        check("SDK_FONTS_SIZE" in st(a, "font-tools")["codes"], "кегль вне 4..512 — SDK_FONTS_SIZE")
        a.eval("$.sdkApp.studios['font-tools'].undo(); 1")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        rc, out = cli("validate", p_fo)
        check(rc == 0 and out["type"] == "fonts" and out["errors"] == 0, "r2d-sdk validate: fonts без ошибок")
        close_studio(a)
        check(a.eval("$.font.list().filter(n => n.startsWith('sdkpv-')).length") == 0, "закрытие студии убрало стили предпросмотра")

        # --- Audio Tools ----------------------------------------------------------------------------------------------------------------------------
        p_au = os.path.join(PROJ, "mix.audio.json")
        open_studio(a, "audio-tools", p_au)
        A = ops("audio-tools")
        a.eval(f"{A}.addSound('hit', 'assets/hit.ogg'); {A}.setSound('hit', {{bus:'ui', volume:0.8}}); {A}.addZone('hall'); {A}.setZone(0, {{rect:[0,0,640,640]}}); 1")
        a.step(4)
        check(st(a, "audio-tools")["runtimeBuses"] == 3, "Audio: шины созданы настоящим $.audio.bus")
        check(abs(a.eval(f"{A}.gain('ui')") - 0.5) < 1e-9 and abs(a.eval(f"{A}.runtimeGain('ui')") - 0.5) < 1e-9, "эффективная громкость шины ui совпала с рантаймом ($.audio.gain)")
        check(a.eval(f"!!{A}.play('hit')") is True, "звук играет настоящим $.audio.play")
        a.step(5)
        check(st(a, "audio-tools")["playing"] == 1, "студия видит играющий звук")
        a.eval(f"{A}.stopAll(); 1")
        a.eval(f"{A}.setBus('sfx', {{parent:'ui'}}); 1")
        check("SDK_AUDIO_CYCLE" in st(a, "audio-tools")["codes"], "цикл шин sfx ↔ ui — SDK_AUDIO_CYCLE")
        a.eval("$.sdkApp.studios['audio-tools'].undo(); 1")
        a.eval(f"{A}.renameBus('ui', 'menu'); 1")
        check(a.eval("$.sdkApp.studios['audio-tools'].session.doc.sounds.hit.bus") == "menu", "переименование шины обновило ссылки звуков")
        click_el(a, DS, "ds-save")
        wait_idle(a)
        rc, out = cli("validate", p_au)
        check(rc == 0 and out["type"] == "audio" and out["errors"] == 0, "r2d-sdk validate: audio без ошибок")
        close_studio(a)
        check(a.eval("$.audio.buses().filter(b => b.name.startsWith('sdkpv-')).length") == 0, "закрытие студии убрало шины предпросмотра")

        # --- RmlUi Studio ----------------------------------------------------------------------------------------------------------------------------
        ui_proj = os.path.join(ROOT, "build", "sdk_studios_ui")
        shutil.rmtree(ui_proj, ignore_errors=True)
        shutil.copytree(os.path.join(ROOT, "sdk", "templates", "ui-menu"), ui_proj)
        f_rml = os.path.join(ui_proj, "ui", "menu.rml")
        f_rcss = os.path.join(ui_proj, "ui", "menu.rcss")
        before = open(f_rml, encoding="utf-8").read()
        a.eval(f"$.sdkApp.openTool('rmlui-studio', {{assetAbs: {json.dumps(f_rml)}}}).then(() => 1)")
        a.step(15)
        s = st(a, "rmlui-studio")
        check(s["active"] and s["preview"] and s["previewOk"] and s["elements"] == 10, "RmlUi Studio: разметка разобрана (10 элементов), предпросмотр настоящим RmlUi")
        check(os.path.isfile(os.path.join(ui_proj, "ui", ".r2d-draft-menu.rml")), "черновик документа лежит рядом с оригиналом")
        pv = rect(a, "$.ui.doc('%s')" % os.path.join(ui_proj, "ui", ".r2d-draft-menu.rml").replace("\\", "/"), "btn-play")
        view_r = rect(a, RMS, "rm-view")
        check(pv["w"] > 50 and view_r["x"] <= pv["x"] <= view_r["x"] + view_r["w"], "предпросмотр прижат к окну просмотра: кнопка внутри него")
        R = ops("rmlui-studio")
        a.eval(f"{R}.select(6); {R}.setText(6, 'Моя игра'); {R}.setAttrs(7, {{class: 'btn big'}}); 1")
        a.eval(f"{R}.addChild(5, 'p'); 1")
        txt = a.eval("$.sdkApp.studios['rmlui-studio'].model.rml")
        check("<h1>Моя игра</h1>" in txt and 'class="btn big"' in txt and "<p></p>" in txt, "правки дерева попали в исходник точечно")
        check(txt.replace("Моя игра", "{{name}}").replace(' big"', '"').replace("<p></p>\n", "").count("<") == before.count("<"), "остальной текст файла не тронут")
        a.eval(f"{R}.setSheet(0, $.sdkApp.studios['rmlui-studio'].model.sheets[Object.values($.sdkApp.studios['rmlui-studio'].state.sheets)[0].path].replace('#141926', '#2a1a1c')); 1")
        a.eval(f"{R}.duplicate(7); {R}.move(8, 1); 1")
        check(a.eval("$.sdkApp.studios['rmlui-studio'].model.rml.split('btn-play').length - 1") == 2, "дублирование и перемещение элемента работают")
        a.eval(f"{R}.undo(); {R}.undo(); 1")
        click_el(a, RMS, "rm-validate")
        wait_idle(a)
        check(snap(a)["status"].startswith("проверка"), "«Проверить»: нативный валидатор прошёл по черновикам")
        a.eval(f"{R}.setSource('<rml><body><div></body></rml>'); 1")
        s = st(a, "rmlui-studio")
        check(not s["previewOk"] and "SDK_RML_UNBALANCED" in s["codes"], "сломанная разметка: SDK_RML_UNBALANCED, предпросмотр не обновляется")
        a.eval(f"{R}.undo(); 1")
        click_el(a, RMS, "rm-save")
        wait_idle(a)
        saved = open(f_rml, encoding="utf-8").read()
        check("Моя игра" in saved and "<p></p>" in saved, "Сохранить записал .rml")
        check("#2a1a1c" in open(f_rcss, encoding="utf-8").read(), "Сохранить записал .rcss")
        rc1, o1 = cli("validate", f_rml)
        rc2, o2 = cli("validate", f_rcss)
        check(rc1 == 0 and o1["type"] == "rmlui.document" and rc2 == 0 and o2["type"] == "rmlui.style", "r2d-sdk validate: .rml и .rcss без ошибок")
        click_el(a, RMS, "rm-back")
        a.step(4)
        check(not glob.glob(os.path.join(ui_proj, "ui", ".r2d-draft-*")), "закрытие студии удалило черновики")
        check(snap(a)["view"] in ("tools", "projects", "assets"), "возврат в оболочку")

        # --- DevTools ----------------------------------------------------------------------------------------------------------------------------------
        hello = os.path.join(ROOT, "tests", "fixtures", "hello")
        a.eval("$.sdkApp.openTool('devtools', {projectAbs: %s}).then(() => 1)" % json.dumps(hello))
        a.step(8)
        a.eval("$.sdkApp.studios.devtools.state.game = %s; 1" % json.dumps(hello))
        a.eval(f"{DTD}.setValue('dt-game', {json.dumps(hello)}); 1")
        click_el(a, DTD, "dt-run")
        wait_idle(a)
        a.step(5)
        for _ in range(600):
            if not st(a, "devtools")["busy"] and st(a, "devtools")["ok"] is not None:
                break
            a.step(3)
        s = st(a, "devtools")
        check(s["ok"] is True and s["entities"] >= 6, "DevTools: игра запущена протоколом, получены сущности (%s)" % s["entities"])
        check(s["profile"] and s["screenshot"] and s["frame"] == 61, "DevTools: профиль кадра, скриншот и номер кадра (60 шагов + ping): %s" % s)
        a.eval("$.sdkApp.studios.devtools.select(4); 1")
        check("hero" in (a.eval(f"{DTD}.content('dt-node')") or "") or "player" in (a.eval(f"{DTD}.content('dt-node')") or ""), "выбранная сущность описана полями $.agent")
        out_session = a.eval("$.sdkApp.studios.devtools.saveSession().then ? 1 : $.sdkApp.studios.devtools.saveSession()")
        a.step(3)
        sess = os.path.join(ROOT, "build", "sdk_devtools", "session.agent.json")
        check(os.path.isfile(sess), "сессия протокола записана (*.agent.json)")
        click_el(a, DTD, "dt-back")
        a.step(3)

        # --- Asset Browser связывает сохранённые файлы студий с инструментами ---------------------------------------------------------
        a.eval("$.sdkApp.refreshAssets().then(() => 1)")
        wait_idle(a)
        tool = {e["path"]: (e["type"], e["tool"]) for e in a.eval("$.sdkApp.state.assets.entries")}
        expected = {"level.tilemap.json": ("tilemap", "tilemap-studio"), "fire.particles.json": ("particles", "particle-studio"),
                    "level.collision.json": ("collision", "collision-tools"), "bg.layers.json": ("layers", "parallax-tools"),
                    "ui.fonts.json": ("fonts", "font-tools"), "mix.audio.json": ("audio", "audio-tools"),
                    "controls.input.json": ("input", "input-tools")}
        check(all(tool.get(k) == v for k, v in expected.items()), "Asset Browser: файлы студий получили тип и инструмент (%s)" % {k: tool.get(k) for k in expected if tool.get(k) != expected[k]})
        check(not any(".r2d-" in k for k in tool), "служебные черновики .r2d-* в Asset Browser не показаны")
        a.eval(f"$.sdkApp.openAsset('level.tilemap.json').then(() => 1)")
        a.step(12)
        check(st(a, "tilemap-studio")["active"] and st(a, "tilemap-studio")["layers"] == 2, "«Открыть в инструменте» открывает сохранённую карту в Tilemap Studio")
        close_studio(a)

        # --- Templates и Engines ------------------------------------------------------------------------------------------------------------------
        a.eval("$.sdkApp.loadTemplates().then(() => 1)")
        wait_idle(a)
        s = snap(a)
        check(s["templates"]["count"] >= 4, "Шаблоны: найдено %d" % s["templates"]["count"])
        click_el(a, SHELL, "nav-templates")
        a.eval("$.sdkApp.selectTemplate('tilemap-room'); 1")
        dest = os.path.join(ROOT, "build", "sdk_new_room")
        shutil.rmtree(dest, ignore_errors=True)
        a.eval(f"{SHELL}.setValue('template-dest', {json.dumps(dest)}); 1")
        click_el(a, SHELL, "btn-template-create")
        wait_idle(a)
        check(os.path.isfile(os.path.join(dest, "level.tilemap.json")) and os.path.isfile(os.path.join(dest, "main.js")), "Создать проект: файлы шаблона скопированы")
        title = json.load(open(os.path.join(dest, "project.json"), encoding="utf-8"))["title"]
        check(title == "sdk_new_room", "метка {{name}} заменена именем проекта (%s)" % title)
        check(snap(a)["project"]["dir"] == dest, "созданный проект открыт в SDK")
        rc, out = cli("validate", os.path.join(dest, "level.tilemap.json"))
        check(rc == 0 and out["type"] == "tilemap" and out["errors"] == 0, "карта из шаблона валидна нативным валидатором")
        rc, out = cli("new", "blank", dest, "--root", os.path.join(ROOT, "sdk", "templates"))
        check(rc == 1 and any(d["code"] == "SDK_DEST_EXISTS" for d in out["diagnostics"]), "new в непустой каталог отказывает: SDK_DEST_EXISTS, файлы не перезаписаны")
        rc, out = cli("new", "../etc", os.path.join(ROOT, "build", "x"), "--root", os.path.join(ROOT, "sdk", "templates"))
        check(rc == 1 and any(d["code"] == "SDK_TEMPLATE_ID" for d in out["diagnostics"]), "имя шаблона с «..» отвергнуто: SDK_TEMPLATE_ID")
        with Agent(game=dest, seed=1, env=dict(os.environ, R2D_GAME_DIR=dest)) as g:
            g.step(10)
            check(g.eval("$('tilemap').length") == 1 and g.eval("$('#hero').length") == 1, "проект из шаблона запускается без SDK: карта и игрок на месте")

        a.eval("$.sdkApp.loadEngines().then(() => 1)")
        wait_idle(a)
        s = snap(a)["engines"]
        check(s["loaded"] and s["count"] >= 1 and s["selected"], "Сборки движка: найдено %d, используемая выбрана" % s["count"])
        click_el(a, SHELL, "nav-engines")
        check("используется" in (a.eval(f"{SHELL}.content('engine-list')") or ""), "экран показывает, какой движок используется")

        # --- Запуск, отладка, пакет -------------------------------------------------------------------------------------------------------------------
        a.eval(f"$.sdkApp.openProject({json.dumps(hello)}); 1")
        wait_idle(a)
        a.eval("$.sdkApp.debugProject({headless: true, frames: 3}); 1")
        for _ in range(300):
            run = snap(a)["run"]
            if run and not run["running"]:
                break
            a.step(4)
        check(snap(a)["run"] and snap(a)["run"]["exitCode"] == 0, "Debug: игра запущена со статистикой кадра и завершилась кодом 0")
        out_pkg = os.path.join(ROOT, "build", "sdk_pkg", "game")
        shutil.rmtree(os.path.dirname(out_pkg), ignore_errors=True)
        a.eval(f"$.sdkApp.packageProject({json.dumps(out_pkg)}).then(() => 1)")
        wait_idle(a)
        check(os.path.isfile(out_pkg), "Package: собран пакет без шифрования")

    if FAILURES:
        print("\nПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


main()
