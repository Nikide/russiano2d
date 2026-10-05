#!/usr/bin/env python3
# ===========================================================================
# Тест высокоуровневого API $.
#
# Гоняет фикстуру tests/fixtures/hello и проверяет всё, на чём стоит игровой
# код: создание узлов, селекторы, цепочки, события, физику, твины, сцены,
# интерфейс, сохранения, файлы, звук и снимок для агента.
#
# Запуск:
#   python3 tests/agent/highlevel_api_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Создание и поиск -------------------------------------------------
        check(a.eval("typeof $") == "function", "$ доступен глобально")
        check(a.eval("$('#hero').length") == 1, "узел найден по id")
        check(a.eval("$('.goblin').length") == 3, "узлы найдены по классу")
        check(a.eval("$('player').length") == 1, "узел найден по тегу")
        check(a.eval("$.world.count()") == 4, "в мире 4 игровых узла (без стен и интерфейса)")

        # --- Цепочки свойств ---------------------------------------------------
        check(a.eval("$('#hero').hp()") == 100, "здоровье читается")
        a.eval("$('#hero').damage(30)")
        check(a.eval("$('#hero').hp()") == 70, "урон применяется")
        a.eval("$('#hero').heal(5)")
        check(a.eval("$('#hero').hp()") == 75, "лечение применяется")

        # --- Массовые операции и селекторы ------------------------------------
        a.eval("$('.goblin').damage(10)")
        check(a.eval("$('.goblin').first().hp()") == 20, "массовый урон применился ко всем")
        check(a.eval("$('.goblin:alive').length") == 3, "селектор :alive находит живых")
        a.eval("$('.goblin').first().kill()")
        a.step(1)
        check(a.eval("$('.goblin:dead').length") == 1, "селектор :dead находит убитого")
        a.eval("$('.goblin:dead').remove()")
        check(a.eval("$('.goblin').length") == 2, "remove() убирает узел из мира")

        # --- Физика ------------------------------------------------------------
        a.eval("$('#hero').velocity(0, 0)")
        a.step(20)
        y0 = a.eval("$('#hero').pos().y")
        a.step(30)
        check(a.eval("$('#hero').pos().y") >= y0 - 1, "гравитация тянет тело вниз (Y растёт вниз)")
        check(a.eval("typeof $('#hero').onFloor()") == "boolean", "onFloor() отвечает булевым")

        x0 = a.eval("$('#hero').pos().x")
        a.keys(["D"])
        a.step(60)
        a.keys([])
        x1 = a.eval("$('#hero').pos().x")
        check(x1 > x0 + 10, f"встроенное управление двигает игрока ({x0:.0f} → {x1:.0f})")

        # --- Лучи и запросы ----------------------------------------------------
        a.eval("$('<wall>', { id: 'probe-wall' }).at(400, 300).size(40, 200).appendTo($.world)")
        a.step(1)
        hit = a.eval("$.world.raycast({ x: 0, y: 300 }, { x: 600, y: 300 })")
        check(hit is not None and hit.get("hit") is True, "raycast находит стену")
        check(a.eval("$.world.query(400, 300, 0).length") >= 1, "query находит узел в точке")
        check(a.eval("$.world.raycastAll({x:0,y:300},{x:600,y:300}).length") >= 1,
              "raycastAll возвращает список попаданий")

        # --- События -----------------------------------------------------------
        a.eval("$.store.set('hits', 0); $.on('hit', () => $.store.set('hits', $.store.get('hits') + 1))")
        a.eval("$('#hero').damage(5)")
        a.step(1)
        check(a.eval("$.store.get('hits')") >= 1, "глобальное событие hit доходит до $.on")

        a.eval("$.store.set('custom', 0); $('#hero').on('custom:ping', () => $.store.set('custom', 1))")
        a.eval("$('#hero').emit('custom:ping')")
        check(a.eval("$.store.get('custom')") == 1, "своё событие узла работает")

        # --- Твины и время -----------------------------------------------------
        a.eval("$('<rect>', { id: 'mover' }).at(0, 0).size(10, 10).appendTo($.world)")
        a.eval("$.store.set('tween', 0); $('#mover').moveTo(200, 0, 200).then(() => $.store.set('tween', 1))")
        a.step(3)
        mid = a.eval("$('#mover').pos().x")
        check(0 < mid < 200, f"твин двигает плавно (x={mid:.1f})")
        a.step(30)
        check(a.eval("$('#mover').pos().x") == 200, "твин доезжает до цели")
        check(a.eval("$.store.get('tween')") == 1, "Promise твина разрешается")

        a.eval("$.store.set('waited', 0); $.time.wait(50).then(() => $.store.set('waited', 1))")
        a.step(1)
        check(a.eval("$.store.get('waited')") == 0, "wait(50) не срабатывает через кадр")
        a.step(10)
        check(a.eval("$.store.get('waited')") == 1, "wait(50) срабатывает позже")

        # --- Сцены -------------------------------------------------------------
        a.eval("$.scene.load('second', { transition: 'none' })")
        a.step(1)
        check(a.eval("$.scene.current()") == "second", "переход на сцену выполняется")
        check(a.eval("$('#marker').length") == 1, "сцена построила своё содержимое")
        check(a.eval("$('.goblin').length") == 0, "при смене сцены мир очистился")
        a.eval("$.scene.push('menu')")
        a.step(1)
        check(a.eval("$.scene.stack().length") == 1, "push кладёт сцену в стек")
        a.eval("$.scene.pop()")
        a.step(1)

        # --- Интерфейс ---------------------------------------------------------
        a.eval("$.store.set('clicked', 0)")
        a.eval("$('<ui.button>', { id: 'b1' }).at(200, 200).size(120, 40).text('Кнопка')"
               ".appendTo($.ui).on('click', () => $.store.set('clicked', 1))")
        a.step(1)
        a.mouse_move(x=200, y=200)
        a.mouse(button=1, action="click")
        a.step(2)
        check(a.eval("$.store.get('clicked')") == 1, "клик по кнопке доходит до обработчика")
        a.eval("$.ui.bar('#b1', 0.5, 1)")
        check(a.eval("$('#b1').value()") == 0.5, "полоса интерфейса принимает значение")

        # --- Сохранения и файлы ------------------------------------------------
        save = os.path.join("build", "test_highlevel_save.json")
        a.eval(f"$.store.set('score', 4242); $.store.save('{save}')")
        check(os.path.exists(os.path.join(ROOT, save)), "сохранение записано на диск")
        a.eval(f"$.store.clear(); $.store.load('{save}')")
        check(a.eval("$.store.get('score')") == 4242, "сохранение прочитано обратно")

        a.eval("$.fs.write('build/test_highlevel.txt', 'привет')")
        check(a.eval("$.fs.readText('build/test_highlevel.txt')") == "привет", "$.fs читает файл")
        check(a.eval("$.fs.exists('build/test_highlevel.txt')") is True, "$.fs.exists работает")
        check("test_highlevel.txt" in (a.eval("$.fs.list('build')") or []), "$.fs.list показывает файл")

        # --- Звук, отладка, графика -------------------------------------------
        a.eval("$.sound.volume(0.5)")
        check(abs(a.eval("$.sound.volume()") - 0.5) < 0.01, "громкость задаётся и читается")
        check(a.eval("typeof $.debug.draw.line") == "function", "$.debug.draw доступен")
        check(a.eval("$.gfx.measureText('привет', 20)[0]") > 0, "текст измеряется")

        # --- Снимок для агента -------------------------------------------------
        state = a.state()
        check("camera" in state and "world" in state, "снимок содержит камеру и мир")
        check(isinstance(state.get("entities"), list), "снимок содержит список узлов")

        # --- Ошибки не роняют кадр --------------------------------------------
        a.eval("$.update(() => { throw new Error('проверка') })")
        a.step(3)
        check(a.eval("engine.frame") > 0, "ошибка в $.update не останавливает движок")
        check("ошибка" in a.stderr_text(), "ошибка игрового кода попала в журнал")
        check(a.ping().get("pong") is True, "движок жив после ошибки в игре")

        # --- Окно: имя, размер, режим, курсор, события -------------------------
        check(a.eval("typeof $.window") == "object", "$.window доступно")
        check(isinstance(a.eval("$.window.title()"), str), "имя окна читается")

        a.eval("$.window.title('Проверка имени')")
        check(a.eval("$.window.title()") == "Проверка имени", "имя окна задаётся из игры")

        size = a.eval("$.window.size()")
        check(size["w"] > 0 and size["h"] > 0,
              "размер окна читается (%dx%d)" % (size["w"], size["h"]))

        a.eval("$.window.resize(900, 540)")
        a.step(1)
        check(a.eval("$.window.size()") == {"w": 900, "h": 540}, "размер окна меняется")

        a.eval("$.window.cursor('crosshair')")
        check(a.eval("$.window.cursor()") == "crosshair", "курсор задаётся")

        a.eval("$.window.vsync(true)")
        check(a.eval("$.window.vsync()") is True, "вертикальная синхронизация задаётся")

        # Событие приходит обработчику с точностью до кадра: движок опрашивает
        # состояние окна, а не рассылает SDL-события в скрипты.
        a.eval("globalThis.__resized = 0; $.window.on('resize', () => { globalThis.__resized++; })")
        a.eval("$.window.resize(1000, 600)")
        a.step(3)
        check(a.eval("globalThis.__resized") >= 1, "событие resize доходит до игры")

        # Окно видно агенту: имя и режим лежат в снимке состояния.
        window = (a.state().get("window") or {})
        check(window.get("title") == "Проверка имени", "окно есть в снимке агента (state.window)")


    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
