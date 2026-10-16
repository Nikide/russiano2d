#!/usr/bin/env python3
# ===========================================================================
# Кампания платформера: меню, три уровня, HUD, пауза, победа и прогресс.
#
# Проверяет именно игру `game/` (ту, что собирается в продакшн-бинарник), а не
# движок: сцены кампании, наличие игрока/монет/врагов, ходьбу, прыжок,
# спрыгивание с односторонней платформы, шипы, движущиеся платформы,
# чекпойнты, паузу, победу по сбору монет и сохранение прогресса.
#
# Запуск:
#   python3 tests/agent/game_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/game_test.py
# ===========================================================================

import atexit
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

#: Свой файл прогресса для ЭТОГО прогона.
#:
#: `$.store` пишет save.json относительно рабочего каталога движка, то есть в
#: корень репозитория. Пока тест шёл, другой прогон (у команды их бывает
#: несколько параллельно) успевал записать туда СВОЙ прогресс кампании, и тест
#: «меню → первый уровень» открывал уже второй уровень. Поэтому каждый прогон
#: получает личный файл: изоляция не мешает проверке и убирает ложные падения.
STORE = os.path.join(ROOT, "build", "test_game_save_%d.json" % os.getpid())

#: Уровни кампании и их отличительные признаки: сколько монет минимум,
#: ожидаемые классы узлов. Данные, а не ветвления в тесте.
LEVELS = {
    "meadow": {"coins": 5, "has": ("brick", "coin", "walker")},
    "platformer": {"coins": 5, "has": ("brick", "coin", "walker")},
    "caverns": {"coins": 5, "has": ("brick", "coin", "walker", "platform", "mover")},
    "spires": {"coins": 5, "has": ("brick", "coin", "walker", "spike", "mover", "checkpoint")},
}

FAILURES = []


@atexit.register
def _cleanup():
    """Убрать личный файл прогресса: он не часть репозитория."""
    try:
        if os.path.exists(STORE):
            os.remove(STORE)
    except OSError:
        pass


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    return [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]


def reset_progress(a=None):
    """Дать прогону чистый и ЛИЧНЫЙ прогресс.

    Проверяется путь «с нуля» (меню → первый уровень), поэтому состояния быть
    не должно; а личный файл нужен, чтобы параллельный прогон не подменил
    прогресс через общий save.json.
    """
    for path in (STORE, os.path.join(ROOT, "save.json")):
        if os.path.exists(path):
            os.remove(path)
    if a is not None:
        # Файл переключаем ДО первого кадра: меню читает прогресс при входе.
        a.eval("$.store.file(%s); $.store.clear(); void 0" % repr(os.path.relpath(STORE, ROOT)))
    _cleanup()


def main():
    shot = os.path.join("build", "test_game_shot.png")
    reset_progress()

    # --- Меню и первый уровень ---------------------------------------------
    with Agent(game="game", seed=7) as a:
        # Переключаем хранилище на личный файл ДО первого кадра: меню читает
        # прогресс при входе и иначе увидел бы чужой save.json.
        reset_progress(a)
        a.step(5)
        names = a.eval("$.scene.names().join(',')")
        check(a.eval("$.scene.current()") == "menu", "игра начинается с меню")
        for expected in ("menu", "meadow", "caverns", "spires"):
            check(expected in names, "сцена %s зарегистрирована (%s)" % (expected, names))
        check("platformer" in names,
              "старое имя первого уровня осталось для внешних инструментов")

        # Enter из меню открывает уровень (переход затемнения ~0.2 с).
        a.key("Return", "tap")
        a.step(25)
        opened = a.eval("$.scene.current()")
        check(opened in ("meadow", "platformer"), "Enter из меню открывает первый уровень: %s" % opened)

        a.step(20)
        check(a.eval("$('#hero').length") == 1, "на уровне есть игрок")
        check(a.eval("$('.coin').length") >= 5, "на уровне есть монеты")
        check(a.eval("$('.brick').length") > 0, "на уровне есть земля")
        check(a.eval("$('.walker').length") > 0, "на уровне есть враги")

        # HUD: значения, а не только наличие узлов.
        check(a.eval("$('#hud-hp').text().indexOf('Здоровье')") == 0, "HUD показывает здоровье")
        check(a.eval("$('#hud-coins').text().indexOf('Монеты')") == 0, "HUD показывает монеты")
        check(a.eval("$('#hud-level').text().indexOf('Уровень 1')") == 0, "HUD показывает номер уровня")

        # --- Управление -----------------------------------------------------
        x0 = a.eval("$('#hero').pos().x")
        a.keys(["D"])
        a.step(40)
        a.keys([])
        x1 = a.eval("$('#hero').pos().x")
        check(x1 > x0, "игрок идёт вправо (%.0f → %.0f)" % (x0, x1))

        a.keys(["A"])
        a.step(30)
        a.keys([])
        x2 = a.eval("$('#hero').pos().x")
        check(x2 < x1, "игрок идёт влево (%.0f → %.0f)" % (x1, x2))

        y_before = a.eval("$('#hero').pos().y")
        a.key("Space", "tap")
        top = y_before
        for _ in range(15):
            a.step(1)
            top = min(top, a.eval("$('#hero').pos().y"))
        check(top < y_before - 4, "прыжок поднимает игрока (%.0f → %.0f)" % (y_before, top))
        a.step(30)

        # --- Пауза -----------------------------------------------------------
        a.key("Escape", "tap")
        a.step(2)
        check(a.eval("$.time.isPaused()") is True, "Escape ставит игру на паузу")
        check(a.eval("$('#overlay').isVisible()") is True, "на паузе показан экран паузы")
        a.key("Escape", "tap")
        a.step(2)
        check(a.eval("$.time.isPaused()") is False, "повторный Escape снимает паузу")

        # --- Монеты и победа -------------------------------------------------
        a.eval("$.store.set('coins_before', $('.coin').length)")
        a.eval("$('.coin').each((i, c) => c.at($('#hero').pos().x, $('#hero').pos().y))")
        a.step(4)
        check(a.eval("$('.coin').length") < a.eval("$.store.get('coins_before')"),
              "монеты подбираются при касании")
        check(a.eval("$('#exit').attr('closed')") is False,
              "ворота открываются, когда собраны все монеты")

        a.eval("const g = $('#exit').pos(); void $('#hero').at(g.x, g.y)")
        a.step(6)
        check(a.eval("$('#overlay').isVisible()") is True, "финиш показывает экран победы")
        title = str(a.eval("$('#overlay-title').text()"))
        check("пройден" in title, "заголовок финиша: %s" % title)
        check(a.eval("JSON.stringify($.agent.snapshot().campaign)").find('"meadow"') >= 0,
              "прогресс кампании виден агенту")
        check(a.eval("$.store.get('levels').meadow.done") is True,
              "пройденный уровень сохраняется в прогрессе")

        a.step(3)
        a.screenshot(shot)
        check(os.path.getsize(shot) > 1000, "кадр игры сохранён (%d байт)" % os.path.getsize(shot))
        errors = errors_of(a)
        check(not errors, "в игре нет ошибок игрового кода (%d шт.)" % len(errors))
        if errors:
            for line in errors[:3]:
                print("        " + line.strip())

    # --- Остальные уровни: грузятся, содержат свои механики, не падают ------
    for name, spec in LEVELS.items():
        if name == "platformer":
            continue                       # это псевдоним первого уровня
        with Agent(game="game", scene=name, seed=7) as a:
            a.step(30)
            check(a.eval("$('#hero').length") == 1, "%s: игрок есть" % name)
            check(a.eval("$('.coin').length") >= spec["coins"],
                  "%s: монет не меньше %d" % (name, spec["coins"]))
            for klass in spec["has"]:
                check(a.eval("$('.%s').length" % klass) > 0, "%s: есть .%s" % (name, klass))

            # Односторонняя платформа: игрок на неё падает сверху, стоит, а
            # затем спрыгивает вниз по S+Space. Ставим ВЫШЕ платформы: тело
            # синхронизируется с узлом, и падение получается настоящим.
            if name == "caverns":
                a.eval("""const p = $('.platform').get(0);
                          void $('#hero').at(p.x, p.y - 90);""")
                a.step(45)
                stood = a.eval("$('#hero').onFloor()")
                check(stood is True, "caverns: игрок стоит на односторонней платформе")
                y_top = a.eval("$('#hero').pos().y")
                a.keys(["S"])
                a.key("Space", "tap")
                a.step(2)
                a.keys([])
                a.step(25)
                y_below = a.eval("$('#hero').pos().y")
                check(y_below > y_top + 4,
                      "caverns: S+Space спускает вниз (%.0f → %.0f)" % (y_top, y_below))

            # Чекпойнт: касание запоминает точку возрождения (видно агенту).
            if name == "spires":
                a.eval("""const k = $('.checkpoint').get(0);
                          void $('#hero').at(k.x, k.y);""")
                a.step(6)
                snap = a.eval("JSON.stringify($.agent.snapshot().campaign)")
                check('"checkpoint":true' in snap, "spires: чекпойнт взят: %s" % snap[:120])

            a.step(5)
            errors = errors_of(a)
            check(not errors, "%s: нет ошибок игрового кода (%d шт.)" % (name, len(errors)))
            if errors:
                for line in errors[:2]:
                    print("        " + line.strip())

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
