#!/usr/bin/env python3
# ===========================================================================
# Тест режимов смешивания и заглушки render target через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/render и проверяет то, что видит игра:
# $.blend()/node.blend_mode доходят до батча, все четыре режима рисуются в
# одном кадре и не ломают вывод, а $.viewport честно сообщает, что render
# target в этой сборке не поддержан. Картинку целиком не сверяем — только
# размер скриншота и живые счётчики кадра.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_render_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "render")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- $.blend: геттер/сеттер и валидация -------------------------------
        check(a.eval("typeof $.blend") == "function", "$.blend доступно")
        check(a.eval("$.blend()") == "alpha", "режим по умолчанию — alpha")

        a.eval("$.blend('add')")
        check(a.eval("$.blend()") == "add", "$.blend('add') сменил режим по умолчанию")
        check(a.eval("$.blend('screen')") == "add",
              "неизвестный режим не меняет текущий")
        a.eval("$.blend('alpha')")
        check(a.eval("$.blend()") == "alpha", "режим вернулся к alpha")

        # --- node.blend_mode --------------------------------------------------
        for node_id, mode in (("b_alpha", "alpha"), ("b_add", "add"),
                              ("b_multiply", "multiply"), ("b_none", "none")):
            check(a.eval("$('#%s').blend()" % node_id) == mode,
                  "узел #%s в режиме %s" % (node_id, mode))
        check(a.eval("$('#b_bad').blend()") == "alpha",
              "неизвестный режим узла откатился в alpha")

        # --- Кадр со всеми режимами рисуется ---------------------------------
        a.step(2)
        stats = a.eval("$.gfx.stats()")
        check(isinstance(stats, dict) and stats.get("sprites", 0) >= 6,
              "все узлы со своими режимами попали в батч (sprites=%s)"
              % (stats.get("sprites") if isinstance(stats, dict) else stats))
        check(a.eval("engine.frame") > 0, "кадры идут")

        # --- $.viewport: честная заглушка -------------------------------------
        check(a.eval("typeof $.viewport") == "object", "$.viewport доступно")
        check(a.eval("$.viewport.supported") is False,
              "render target помечен как не поддержанный")
        check(a.eval("$.viewport.list().length") == 0, "list() пуст")
        check(a.eval("$.viewport.get(1)") is None, "get() вернул null")
        check(a.eval("$.viewport.remove(1)") is False, "remove() вернул false")

        error = a.eval(
            "(() => { try { $.viewport.create(64, 64); return 'no-error'; }"
            " catch (e) { return String(e.message); } })()"
        )
        check(isinstance(error, str) and "не поддержан" in error,
              "create() объясняет, что render target не поддержан (%s)" % error)

        error = a.eval(
            "(() => { try { $.viewport.draw(1, 0, 0, 64, 64, 1); return 'no-error'; }"
            " catch (e) { return String(e.message); } })()"
        )
        check(isinstance(error, str) and "не поддержан" in error,
              "draw() объясняет, что render target не поддержан")

        # --- Пост-обработка ---------------------------------------------------
        supported = a.eval("engine.postSupported()")
        check(isinstance(supported, bool), "postSupported() отвечает да/нет")
        check(a.eval("typeof $.gfx.post") == "function", "$.gfx.post доступно")
        check(a.eval("$.gfx.postSupported()") == supported,
              "$.gfx.postSupported() совпадает с движком")

        a.step(3)
        clean = a.screenshot(os.path.join(ROOT, "build", "render_post_off.png"))
        check(os.path.getsize(clean) > 0, "кадр без поста сохранён")

        a.eval("$.gfx.post({ vignette: 0.9, glow: 0.4, grain: 0.2, chromatic: 0.004 })")
        now = a.eval("$.gfx.post()")
        check(isinstance(now, dict) and abs(now.get("vignette", 0) - 0.9) < 1e-6,
              "параметры поста читаются обратно (%s)" % now)
        a.step(3)
        tinted = a.screenshot(os.path.join(ROOT, "build", "render_post_on.png"))
        check(os.path.getsize(tinted) > 0, "кадр с пост-обработкой сохранён")

        if supported:
            check(open(clean, "rb").read() != open(tinted, "rb").read(),
                  "пост-обработка меняет картинку кадра")
        else:
            print("  пропуск: сборка без пост-обработки (шейдер не поднялся)")

        # Линза — экранное искажение: главный эффект для взрывов и чёрной дыры.
        a.eval("$.gfx.post({ lens: 1.1, centerX: 0.5, centerY: 0.5, radius: 0.3 })")
        a.step(3)
        check(a.ping().get("pong") is True, "движок жив после кадра с линзой")

        a.eval("$.gfx.post({ on: false })")
        a.step(2)
        check(a.eval("$.gfx.post().enabled") == 0, "пост выключается")

        # --- Камерные пресеты: от мультика до хоррора -------------------------
        names = a.eval("$.gfx.postPresets()")
        check(isinstance(names, list) and "horror" in names and "adventure" in names,
              "список камерных пресетов (%s)" % names)

        a.eval("$.gfx.postPreset('horror')")
        a.step(3)
        horror = a.eval("$.gfx.post()")
        check(isinstance(horror, dict) and horror.get("saturation", 1) < 0.5,
              "хоррор обесцвечивает кадр (saturation=%s)" % (horror or {}).get("saturation"))
        check((horror or {}).get("vignette", 0) > 0.5, "хоррор сильно вигнетирует")
        check((horror or {}).get("blood", 0) > 0, "у хоррора кровавые края")

        a.eval("$.gfx.postPreset('adventure', { ms: 400 })")
        a.step(1)
        mid = a.eval("$.gfx.post()")
        check(isinstance(mid, dict) and mid.get("saturation", 0) > (horror or {}).get("saturation", 0),
              "переход идёт плавно, а не рывком (saturation=%s)"
              % (mid or {}).get("saturation"))
        a.step(40)
        warm = a.eval("$.gfx.post()")
        check(isinstance(warm, dict) and warm.get("saturation", 0) > 1.1,
              "мультяшный пресет досчитался (saturation=%s)" % (warm or {}).get("saturation"))
        check((warm or {}).get("enabled", 0) == 1, "пресет включает пост сам")

        a.eval("$.gfx.postPreset('нейвероятный-пресет')")
        check(a.eval("$.gfx.post().saturation") == (warm or {}).get("saturation"),
              "неизвестный пресет ничего не меняет")

        shot = a.screenshot(os.path.join(ROOT, "build", "render_post_horror.png"))
        check(os.path.getsize(shot) > 0, "кадр в хорроре сохранён")

        # --- Скриншот кадра со смешиванием ------------------------------------
        shot = a.screenshot(os.path.join(ROOT, "build", "render_blend_test.png"))
        check(os.path.getsize(shot) > 0, "скриншот кадра сохранён: " + shot)
        check(a.ping().get("pong") is True, "движок жив после кадра с режимами")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
