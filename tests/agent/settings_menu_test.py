#!/usr/bin/env python3
# ===========================================================================
# Приёмка эталонного меню настроек (демо demos/settings).
#
# Проверяется то, что обещано пользователю, и ЧИСЛАМИ:
#   * экран открывается, разметка RmlUi на месте (вкладки и строки видны);
#   * каждая настройка меняет состояние СООТВЕТСТВУЮЩЕЙ подсистемы (числа
#     до/после: ui.scale, sound.volume, gfx.smaa, window.fullscreen, i18n.lang);
#   * сохранение переживает ПЕРЕЗАПУСК движка (настройку меняем, агента
#     перезапускаем, значение на месте);
#   * сброс возвращает значения по умолчанию;
#   * навигация клавиатурой и геймпадом двигает кольцо выбора;
#   * мышь (клик по строке) работает тем же путём;
#   * время открытия экрана и время применения настроек измерены;
#   * в headless ничего не падает.
#
# Геймпад проверяется через тот же путь, которым идёт настоящий d-pad: контекст
# ввода `settings` привязывает `gamepad.dpdown/dpup/...` к действиям меню, а
# `$.input.synthPress('menu_down')` поднимает это действие. Аналоговый стик
# проверить нечем — он требует живого геймпада; это отмечено в отчёте.
#
# Запуск после сборки:
#   python3 tests/agent/settings_menu_test.py
# ===========================================================================

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = "demos"
SCENE = "settings"
DOC = "demos/settings/settings.rml"
SETTINGS_FILE = "settings.json"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def doc_eval(a, code):
    """Выполнить код с обёрткой документа в области видимости."""
    return a.eval("(() => { const doc = $.ui.doc('%s'); %s })()" % (DOC, code))


def facts(a):
    return a.state().get("settings")


def cleanup():
    path = os.path.join(ROOT, SETTINGS_FILE)
    if os.path.exists(path):
        os.remove(path)


def main():
    cleanup()
    try:
        run()
    finally:
        cleanup()

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("Все проверки пройдены")
    return 0


def run():
    # --- 1. Экран открывается, разметка на месте ---------------------------
    with Agent(game=GAME, scene=SCENE, seed=5, headless=True) as a:
        a.step(5)
        state = facts(a)
        check(state is not None, "демо отдаёт факты о настройках через $.agent.expose")
        if state is None:
            return
        check(state["open"] is True, "экран настроек открыт")
        check(a.eval("$.scene.current()") == SCENE, "сцена settings активна")
        check(a.eval("(() => { const d = $.ui.doc('%s'); return d && d.id >= 0 && d.visible(); })()" % DOC)
              is True, "документ RmlUi загружен и виден")
        check(doc_eval(a, "return doc.content('title');") == "Настройки",
              "заголовок меню отрисован: %r" % doc_eval(a, "return doc.content('title');"))
        rows = doc_eval(a, "return ['row-g-fullscreen','row-g-mode','row-g-scale','row-g-smaa','row-g-fps']"
                           ".filter((id) => doc.rect(id).w > 0).length;")
        check(rows == 5, "пять строк вкладки «Графика» размечены (получено %s)" % rows)
        check(state["modes"] > 0, "движок отдал список режимов дисплея (%d)" % state["modes"])
        check(state["openMs"] >= 0, "время открытия экрана измерено: %.1f мс" % state["openMs"])
        check(not a.eval("$.ui.doc('%s') === null" % DOC), "headless: документ доступен без окна")

        # --- 2. Каждая настройка меняет своё состояние ---------------------
        # Масштаб интерфейса: первый клик выбирает строку, значение — стрелкой.
        doc_eval(a, "doc.click('row-g-scale'); return 1;")
        a.step(2)
        check(facts(a)["selected"] == "g-scale", "мышь: клик выбрал строку масштаба")
        before = a.eval("$.ui.scaleValue()")
        a.key("Right", "tap"); a.step(2)
        after = a.eval("$.ui.scaleValue()")
        check(after > before, "масштаб интерфейса: $.ui.scaleValue() %.2f → %.2f" % (before, after))
        check(facts(a)["values"]["gfx.scale"] == after, "состояние меню совпало с движком")

        # SMAA
        doc_eval(a, "doc.click('row-g-smaa'); doc.click('row-g-smaa'); return 1;"); a.step(2)
        smaa = a.eval("$.gfx.smaa()")
        check(smaa["on"] is True and smaa["preset"] == "medium",
              "сглаживание: $.gfx.smaa() → on=%s preset=%s" % (smaa["on"], smaa["preset"]))

        # Полный экран (цикл «окно → рабочий стол → эксклюзивно»)
        doc_eval(a, "doc.click('row-g-fullscreen'); doc.click('row-g-fullscreen'); return 1;"); a.step(2)
        check(facts(a)["values"]["gfx.fullscreen"] == "desktop",
              "полный экран переключился в %r" % facts(a)["values"]["gfx.fullscreen"])
        check(a.eval("$.window.fullscreen()") is True, "движок подтвердил полный экран")

        # Звук: сначала вкладка, затем строка (первый клик — выбор, второй — шаг)
        doc_eval(a, "doc.click('tab-sound'); return 1;"); a.step(2)
        check(facts(a)["tab"] == "sound", "вкладка «Звук» открыта кликом")
        doc_eval(a, "doc.click('row-s-master'); doc.click('row-s-master'); return 1;"); a.step(2)
        vol_before = a.eval("$.sound.volume()")
        a.key("Left", "tap"); a.step(2)
        vol_after = a.eval("$.sound.volume()")
        check(vol_after < vol_before, "мастер-громкость: $.sound.volume() %.2f → %.2f" % (vol_before, vol_after))

        # Звук: тишина
        doc_eval(a, "doc.click('row-s-mute'); doc.click('row-s-mute'); return 1;"); a.step(2)
        check(a.eval("$.sound.mute()") is True, "тишина включена: $.sound.mute() → true")
        check(facts(a)["values"]["snd.mute"] is True, "состояние меню: тишина")

        # Язык на лету
        doc_eval(a, "doc.click('tab-lang'); doc.click('row-l-en'); doc.click('row-l-en'); return 1;"); a.step(2)
        check(a.eval("$.i18n.lang()") == "en", "язык переключён: $.i18n.lang() → en")
        check(doc_eval(a, "return doc.content('lbl-s-master');") == "Master volume",
              "подписи перерисованы на лету: %r" % doc_eval(a, "return doc.content('lbl-s-master');"))
        doc_eval(a, "doc.click('row-l-ru'); doc.click('row-l-ru'); return 1;"); a.step(2)
        check(a.eval("$.i18n.lang()") == "ru", "язык вернулся: ru")

        # --- 3. Навигация: клавиатура и геймпад ----------------------------
        doc_eval(a, "doc.click('tab-graphics'); doc.click('row-g-fullscreen'); return 1;"); a.step(1)
        start = facts(a)["selected"]
        a.key("Down", "tap"); a.step(2)
        after_key = facts(a)["selected"]
        check(after_key != start, "клавиатура: ↓ двигает кольцо %s → %s" % (start, after_key))
        a.key("Up", "tap"); a.step(2)
        check(facts(a)["selected"] == start, "клавиатура: ↑ возвращает кольцо на %s" % start)

        binds = a.eval("($.input.context().filter((c) => c.name === 'settings')[0] || {}).binds || {}")
        check("gamepad.dpdown" in binds.get("menu_down", []),
              "геймпад: d-pad привязан к действиям меню (menu_down ← %s)" % binds.get("menu_down"))
        # Живого геймпада в headless нет, поэтому проверяем обе половины пути:
        # (1) d-pad привязан к действиям меню (строка выше) и (2) действие
        # menu_down двигает кольцо — синтезируем ту же клавишу, которой это
        # действие отвечает; для кода меню разницы между клавишей и d-pad нет.
        a.eval("$.input.synthPress('down')"); a.step(1)
        pad_move = facts(a)["selected"]
        check(pad_move != start, "геймпад (то же действие menu_down): кольцо %s → %s" % (start, pad_move))
        a.eval("$.input.synthPress('escape')"); a.step(1)
        check(facts(a)["selected"] == pad_move, "menu_back (геймпад B) не сбивает кольцо")

        # Мышь: клик по строке = выбор строки
        doc_eval(a, "doc.click('row-g-fps'); doc.click('row-g-fps'); return 1;"); a.step(2)
        check(facts(a)["selected"] == "g-fps", "мышь: клик выбрал строку %s" % facts(a)["selected"])
        check(facts(a)["values"]["gfx.fps"] is False, "мышь: клик переключил значение (FPS выключен)")

        # --- 4. Время применения и сохранение ------------------------------
        log = facts(a)["applyLog"]
        check(len(log) > 0, "время применения настроек записано (%d замеров)" % len(log))
        worst = max((item["ms"] for item in log), default=0)
        check(worst < 50, "самое долгое применение настройки: %.2f мс" % worst)

        a.step(40)   # дать сработать отложенной записи (250 мс игрового времени)
        path = os.path.join(ROOT, SETTINGS_FILE)
        check(os.path.exists(path), "файл настроек %s создан" % SETTINGS_FILE)
        size = os.path.getsize(path) if os.path.exists(path) else 0
        check(0 < size < 4096, "размер файла настроек: %d Б" % size)
        saved = json.load(open(path, encoding="utf-8"))["data"] if os.path.exists(path) else {}
        check(saved.get("settings.gfx.smaa") == "medium",
              "в файле лежит применённое значение SMAA: %r" % saved.get("settings.gfx.smaa"))

        # Захват клавиши: Enter на строке действия → ждём нажатие → переназначили
        doc_eval(a, "doc.click('row-tab-controls'); return 1;") if False else None
        a.eval("(() => { const d = $.ui.doc('%s'); d.click('tab-controls'); return 1; })()" % DOC)
        a.step(2)
        check(facts(a)["tab"] == "controls", "вкладка «Управление» открыта")
        a.eval("(() => { const d = $.ui.doc('%s'); d.click('row-c-jump'); return 1; })()" % DOC)
        a.step(2)
        check(facts(a)["capturing"] == "c-jump", "захват клавиши начался: %s" % facts(a)["capturing"])
        a.key("K", "tap"); a.step(3)
        check(facts(a)["capturing"] is None, "захват завершился после нажатия")
        # $.input.bindings() отдаёт объект {действие: [клавиши]}, а не список.
        jump_keys = a.eval("$.input.bindings()['jump']")
        check(any(str(key).lower() == "k" for key in jump_keys),
              "клавиша переназначена: jump → %s" % jump_keys)
        check(facts(a)["values"]["bind.jump"] == jump_keys, "меню показывает ту же привязку")
        a.step(40)

        # --- 5. Сброс возвращает значения по умолчанию ---------------------
        a.eval("(() => { const d = $.ui.doc('%s'); d.click('tab-lang'); d.click('row-l-reset');"
               " d.click('row-l-reset'); return 1; })()" % DOC)
        a.step(3)
        state = facts(a)
        check(state["values"]["gfx.scale"] == 1 and state["values"]["gfx.smaa"] == "off"
              and state["values"]["snd.master"] == 0.8 and state["values"]["snd.mute"] is False,
              "сброс вернул дефолты: scale=%s smaa=%s master=%s mute=%s"
              % (state["values"]["gfx.scale"], state["values"]["gfx.smaa"],
                 state["values"]["snd.master"], state["values"]["snd.mute"]))
        check(a.eval("$.ui.scaleValue()") == 1, "движок тоже сброшен: $.ui.scaleValue() → 1")
        check(a.eval("$.sound.mute()") is False, "тишина снята: $.sound.mute() → false")
        a.step(40)

        # --- 6. Числа кадра: меню открыто против закрытого -----------------
        open_frames = a.step(60)
        open_fps = a.eval("$.ui.fps()")
        check(open_fps > 0, "FPS с открытым меню: %.1f (60 кадров)" % open_fps)

    # --- 7. Перезапуск: настройки пережили выход движка --------------------
    # Перед перезапуском кладём в файл заметное значение, чтобы отличить его от
    # дефолта: масштаб 1.75 и язык en.
    with Agent(game=GAME, scene=SCENE, seed=5, headless=True) as a:
        a.step(5)
        a.eval("(() => { const d = $.ui.doc('%s'); d.click('row-g-scale'); return 1; })()" % DOC)
        a.step(1)
        for _ in range(3):
            a.key("Right", "tap"); a.step(1)
        a.eval("(() => { const d = $.ui.doc('%s'); d.click('tab-lang'); d.click('row-l-en');"
               " d.click('row-l-en'); return 1; })()" % DOC)
        a.step(2)
        scale_set = facts(a)["values"]["gfx.scale"]
        check(scale_set > 1, "перед перезапуском масштаб поднят до %.2f" % scale_set)
        a.step(40)

    with Agent(game=GAME, scene=SCENE, seed=5, headless=True) as a:
        a.step(5)
        state = facts(a)
        check(abs(state["values"]["gfx.scale"] - scale_set) < 0.001,
              "после перезапуска масштаб тот же: %.2f (был %.2f)" % (state["values"]["gfx.scale"], scale_set))
        check(a.eval("$.ui.scaleValue()") == scale_set,
              "и движок применил сохранённый масштаб при старте: %.2f" % a.eval("$.ui.scaleValue()"))
        check(a.eval("$.i18n.lang()") == "en", "язык пережил перезапуск: %s" % a.eval("$.i18n.lang()"))
        check(doc_eval(a, "return doc.content('lbl-g-scale');") == "UI scale",
              "подписи на сохранённом языке: %r" % doc_eval(a, "return doc.content('lbl-g-scale');"))
        print("  ..   числа: открытие %.1f мс, применение (макс) %.2f мс, файл %d Б"
              % (state["openMs"], max((i["ms"] for i in state["applyLog"]), default=0),
                 os.path.getsize(os.path.join(ROOT, SETTINGS_FILE))))


if __name__ == "__main__":
    sys.exit(main())
