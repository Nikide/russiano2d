#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы таймлайн-сцен ($.timeline) и демо-новеллы «Руси-тян».
#
# Гоняет живой движок в агентском режиме и проходит новеллу до концовки:
# смену локаций, позы героини, флаги выборов, тряску экрана и след концовки
# в $.store. Ход новеллы собирается её же событиями (`beat`, `location`, `say`,
# `ending`) — так тест не гадает по кадрам, а читает то, что модуль обещал
# в docs/highlevel/timeline.md.
#
# Запуск (собранный движок):
#   python3 tests/agent/highlevel_timeline_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
SCENE = "russi_vn"

# Что новелла обязана сделать: локации по порядку и обе концовки.
LOGGER = """
globalThis.__vn = { beats: 0, locations: [], says: [], shakes: 0, choices: [], endings: [] };
$.timeline.on('beat', () => { __vn.beats++; });
$.timeline.on('location', (e) => { __vn.locations.push(e.name); });
$.timeline.on('say', (e) => { __vn.says.push(String(e.text || '').slice(0, 28)); });
$.timeline.on('shake', () => { __vn.shakes++; });
$.timeline.on('choice', (e) => { __vn.choices.push(String(e.text || '').slice(0, 28)); });
$.timeline.on('ending', (e) => { __vn.endings.push(e.id); });
'logger ready'
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def play(a, picks, limit=600):
    """Пройти новеллу: «дальше» на репликах, варианты — по индексам picks."""
    used = 0
    for _ in range(limit):
        if not a.eval("$.timeline.running()"):
            return True
        choices = a.eval("$.timeline.choices().map(c => c.text)")
        if choices:
            index = picks[used] if used < len(picks) else 0
            used += 1
            a.eval(f"$.dialog.choose({index})")
            continue
        a.step(8)
        if a.eval("$.timeline.state().waiting") == "say":
            a.eval("$.dialog.next()")
    return False


def main():
    with Agent(game="demos", scene=SCENE, seed=7) as a:
        a.step(40)

        # --- Подсистема на месте ---------------------------------------------
        check(a.eval("typeof $.timeline") == "object", "$.timeline доступно")
        check(a.eval("typeof $.animatedTimelineScene2d") == "function",
              "$.animatedTimelineScene2d — литеральное имя типа сцены")
        check(a.eval("$.timeline.list().indexOf('russi_vn') >= 0"), "таймлайн объявлен")
        check(a.eval("$.scene.current()") == SCENE, "сцена новеллы открыта")
        check(a.eval("$.timeline.running()") is True, "прогон идёт")
        check(a.eval("$.timeline.state().location") == "room", "старт — комната")
        check(a.eval("$.timeline.state().actors[0].who") == "russi", "в кадре Руси-тян")

        # Прогресс новеллы переживает запуски (свой файл demos/vn_save.json),
        # поэтому тест начинает с чистого листа — иначе он зависел бы от того,
        # сколько раз до него играли.
        a.eval("['trust', 'last_ending', 'ending:love', 'ending:hate'].forEach(k => $.store.remove(k))")

        # Дальше ход новеллы пишут её же события.
        check(a.eval(LOGGER) == "logger ready", "подписки на события поставлены")

        # --- Маршрут 1: похвала JS -------------------------------------------
        check(play(a, picks=[0, 0, 0]), "новелла дошла до конца маршрута")
        vn = a.eval("__vn")
        check(vn["beats"] > 40, f"битов пройдено: {vn['beats']}")
        # Стартовая комната объявляется ещё до подписки на события — её видно
        # в состоянии, а дальше локации идут по сценарию.
        check(vn["locations"][:3] == ["class", "roof", "street"],
              f"локации сменились по сценарию: {vn['locations'][:3]}")
        check(len(vn["says"]) > 30, f"реплик показано: {len(vn['says'])}")
        check(len(vn["choices"]) == 3, f"пройдено развилок: {len(vn['choices'])}")
        check(vn["endings"] == ["love"], f"концовка маршрута: {vn['endings']}")
        check(a.eval("$.store.get('ending:love')") is True,
              "флаг концовки записан в $.store")
        check(a.eval("$.timeline.ended()") is True, "прогон помечен завершённым")
        check(a.eval("$.timeline.current()") == "russi_vn",
              "current() помнит прогон и после концовки")
        check(a.eval("Number($.store.get('trust', 0))") == 3,
              "«руси-метр» вырос на трёх похвалах")
        check(a.eval("$.timeline.state().ending") == "love", "state() помнит концовку")

        # --- Маршрут 2: ругаем движок ----------------------------------------
        a.eval("$.timeline.play('russi_vn'); __vn.endings.length = 0; __vn.locations.length = 0;")
        a.step(20)
        check(a.eval("$.timeline.running()") is True, "новелла перезапускается программно")
        check(a.eval("$.store.get('trust', 0)") == 3,
              "флаги прошлого прогона остались в $.store (прогресс не сбрасывается)")
        check(play(a, picks=[2, 0, 1]), "второй маршрут пройден")
        vn2 = a.eval("__vn")
        check(vn2["endings"] == ["hate"], f"вторая концовка достигнута: {vn2['endings']}")
        check(a.eval("$.store.get('ending:hate')") is True,
              "и она тоже записана флагом")
        check(a.eval("$.store.keys().filter(k => k.indexOf('ending:') === 0).length") == 2,
              "в $.store обе открытые концовки")

        # --- Перезапуск не плодит героиню ------------------------------------
        # Регрессия: каждый startRun создавал новый узел спрайта, и после
        # нескольких «заново» на экране оказывалось две (три, четыре) Руси-тян.
        # id узла живёт в реестре $.ctx.byId (attrs.id — только у ui-узлов).
        def one(expr):
            return a.eval(expr)

        def heroes():
            return one("(function () { let n = 0; for (const [k] of $.ctx.byId) { if (k.indexOf('__tl_hero_russi') === 0) n++; } return n; })()")

        def sprites():
            return one("$.ctx.nodes.filter(n => n.tag === 'sprite').length")

        base_sprites = sprites()
        check(heroes() == 1, f"в сцене ровно одна героиня (сейчас {heroes()})")
        for _ in range(3):
            a.eval("$.timeline.play('russi_vn')")
            a.step(40)
        check(heroes() == 1, f"после трёх перезапусков по-прежнему одна (стало {heroes()})")
        check(sprites() == base_sprites,
              f"узлов-спрайтов не прибавилось ({base_sprites} → {sprites()})")

        # И после остановки прогона: окончание не должно оставлять дубль.
        a.eval("$.timeline.stop('test')")
        a.step(20)
        check(heroes() == 1, "после остановки прогона дублей нет")

        # --- Агентский снимок -------------------------------------------------
        snapshot = a.eval("$.agent.snapshot()")
        check(snapshot.get("vn_scene") == SCENE, "агент видит сцену новеллы")
        check(snapshot.get("vn_last_ending") == "hate", "агент видит последнюю концовку")
        check("vn_trust" in snapshot and "vn_pose" in snapshot,
              "агент видит «руси-метр» и позу героини")

    print()
    if FAILURES:
        print(f"ПРОВАЛЕНО {len(FAILURES)}:")
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
