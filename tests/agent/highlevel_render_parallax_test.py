#!/usr/bin/env python3
# ===========================================================================
# Проверка бесшовного повторения параллакс-полосы в движке.
#
# Юнит-тесты (tests/js/layers_test.mjs) проверяют раскладку repeatLayout без
# движка. Здесь — то, что видно только на кадре: полоса реально закрывает
# кадр (в фоне не остаётся ни одного пикселя «пустоты») при движении камеры и
# при зуме, а выключение повторения снова оставляет дыру.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_render_parallax_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

try:
    from PIL import Image
except ImportError:              # pragma: no cover
    Image = None

GAME = os.path.join("tests", "fixtures", "text")
# Кадры остаются в build/: «полоса включена» и «полоса выключена» — видно
# разницу глазами, а не только по числу пикселей фона.
SHOT_ON = os.path.join("build", "parallax_repeat_on.png")
SHOT_OFF = os.path.join("build", "parallax_repeat_off.png")
SHOT = os.path.join("build", "parallax_repeat.png")
# Полностью непрозрачный тайл 256×144 — по нему видно, закрыт ли кадр.
TEXTURE = "demos/assets/tiles/bg_mountains.png"
PERIOD = 256
BACKGROUND = (255, 0, 255)
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, path=SHOT):
    a.cmd("screenshot", path=path)
    return path if os.path.isfile(path) else ""


def background_pixels(path):
    """Сколько пикселей центральной строки осталось цветом фона."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    row = h // 2
    return sum(1 for x in range(w) if im.getpixel((x, row)) == BACKGROUND)


def main():
    if Image is None:
        print("  skip PIL недоступен — тест пропущен")
        return 0
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.eval("""
            $('#world').remove(); $('#hud').remove(); $('#go').remove();
            $.world.color('#ff00ff');
        """)
        # Слой с образцом-спрайтом и параллаксом: одна картинка 256×144.
        a.eval("""
            const band = $.layers.create({ name: 'band', order: -30 });
            $('<sprite>', { src: '%s', w: %d, h: 144 }).at(0, 180).appendTo(band);
            $.layers.parallax('band', 0.9).repeat('band', { period: %d });
            $.camera.at(0, 180);
        """ % (TEXTURE, PERIOD, PERIOD))
        a.step(3)

        check(a.eval("$.layers.repeatInfo('band') !== null"), "полоса включена")
        info = a.eval("JSON.stringify($.layers.repeatInfo('band'))")
        print(f"  --   repeatInfo: {info}")

        # 1. Кадр закрыт целиком при камере в начале уровня.
        p = shot(a, SHOT_ON)
        check(p != "", "скриншот снят")
        gap = background_pixels(p)
        check(gap == 0, f"в начале уровня пустоты в кадре нет (пикселей фона {gap})")

        # 2. Уехали далеко вправо — полоса едет вместе с камерой и остаётся
        #    бесшовной: модульный сдвиг, а не накопление позиции.
        a.eval("$.camera.at(5000, 180)")
        a.step(2)
        p = shot(a)
        gap = background_pixels(p)
        check(gap == 0, f"на x=5000 полоса всё ещё закрывает кадр (пикселей фона {gap})")

        # 3. Зум: шаг полосы в экранных точках = period × zoom, копий нужно
        #    больше. Раньше такие полосы расходились при zoom < 1.
        for zoom in (0.5, 2.0):
            a.eval(f"$.camera.zoom({zoom})")
            a.step(2)
            p = shot(a)
            gap = background_pixels(p)
            check(gap == 0, f"при zoom {zoom} полоса закрывает кадр (пикселей фона {gap})")
        a.eval("$.camera.zoom(1).at(0, 180)")
        a.step(2)

        # 4. Параллакс-сдвиг меньше мирового: за 1000 px камеры образец уезжает
        #    на 0.9 × 1000 экранных точек (фактор читается из образца).
        check(abs(float(a.eval("$.layers.repeatInfo('band').factor")) - 0.9) < 1e-6,
              "коэффициент параллакса дошёл до образца через слой")

        # 5. Выключили повторение — дыра возвращается: тест умеет её видеть.
        a.eval("$.layers.repeatOff('band')")
        a.step(2)
        p = shot(a, SHOT_OFF)
        gap = background_pixels(p)
        check(gap > 0, f"без повторения один спрайт 256 px не закрывает 640 px (фона {gap})")
        print(f"  --   кадры: включено {SHOT_ON}, выключено {SHOT_OFF}")

        # 6. Повторение не создаёт узлов: счётчик мира не растёт.
        nodes_without = a.eval("$.world.count()")
        a.eval("$.layers.repeat('band', { period: %d })" % PERIOD)
        a.step(1)
        check(a.eval("$.world.count()") == nodes_without,
              "полоса не добавляет узлов в мир (копии — задача отрисовщика)")

        check(a.ping().get("pong") is True, "движок жив после работы с полосой")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
