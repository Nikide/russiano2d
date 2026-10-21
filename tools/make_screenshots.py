#!/usr/bin/env python3
"""Обновить скриншоты демо для README и docs/demos.md.

Демо — это то, что продаёт движок, а скриншоты в документации быстро стареют:
меняется интерфейс, добавляются демо, удаляются устаревшие. Инструмент снимает
кадр каждой оставшейся сцены через агентский режим — без рук и без открытия окна.

    python3 tools/make_screenshots.py                 # все сцены демо-проекта
    python3 tools/make_screenshots.py --only shooter_witch # одну
    python3 tools/make_screenshots.py --out docs/screenshots

Кадры кладутся в `docs/screenshots/<сцена>.png`; имена совпадают с именами сцен,
поэтому ссылки в README не расходятся с файлами. Меню снимается как `launcher`.

Инструмент снимает только модули игры `demos/`. Самостоятельные проекты,
созданные через Editor, включая новую VN, имеют отдельные walkthrough-кадры в
`docs/editor/images/`.
"""

from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from agent_client import Agent  # noqa: E402

# Сцена → сколько кадров шагать до снимка (в «Типичная ночь в Мытищинском лесу» бой начинается не сразу).
SHOTS = {
    "launcher": 90,
    "platformer": 420,
    "shooter_witch": 900,
}

# Сцена → что подержать до снимка. Платформеру нужно дойти до земли и пройти
# вправо: на первых кадрах камера висит на пустом небе, и кадр выходит пустым.
HOLD = {
    "platformer": ["D"],
}


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="docs/screenshots")
    parser.add_argument("--only", default="", help="сцены через запятую")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    args = parser.parse_args(argv)

    wanted = [s.strip() for s in args.only.split(",") if s.strip()] or list(SHOTS)
    unknown = [scene for scene in wanted if scene not in SHOTS]
    if unknown:
        parser.error("неизвестные сцены проекта demos: " + ", ".join(unknown))
    out_dir = os.path.join(ROOT, args.out)
    os.makedirs(out_dir, exist_ok=True)

    for scene in wanted:
        steps = SHOTS.get(scene, 120)
        path = os.path.join(out_dir, f"{scene}.png")
        try:
            with Agent(game="demos", scene=scene, seed=11,
                       extra_args=["--width", str(args.width), "--height", str(args.height)]) as agent:
                keys = HOLD.get(scene, [])
                if keys:
                    agent.keys(keys)
                left = steps
                while left > 0:
                    portion = min(150, left)
                    agent.step(portion)
                    left -= portion
                if keys:
                    agent.keys([])
                agent.screenshot(path)
            size = os.path.getsize(path) // 1024
            print(f"→ {args.out}/{scene}.png ({size} КБ, {args.width}×{args.height})")
        except Exception as error:
            print(f"не снял {scene}: {error}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
