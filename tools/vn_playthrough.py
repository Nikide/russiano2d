#!/usr/bin/env python3
"""Прогон демо-новеллы «Руси-тян» через агентский протокол движка.

Скрипт проходит новеллу до концовки, выбирая варианты по заданному сценарию,
и складывает скриншоты ключевых моментов. Нужен как проверка демо: без него
«новелла работает» — это предположение, а не факт.

Запуск:
    python3 tools/vn_playthrough.py --route love --out build/vn_shots
    python3 tools/vn_playthrough.py --route hate --out build/vn_shots
"""

from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from agent_client import Agent  # noqa: E402


def state(agent):
    """Снимок новеллы через $.timeline — то, что видит и агент, и тест."""
    return {
        "running": agent.eval("$.timeline.running()"),
        "waiting": agent.eval("$.timeline.state().waiting || ''"),
        "location": agent.eval("$.timeline.state().location || ''"),
        "beats": agent.eval("$.timeline.state().beats"),
        "text": agent.eval("$.dialog.isOpen() ? $.dialog.text() : ''"),
        "choices": agent.eval("$.timeline.choices().map(c => c.text)"),
        "pose": agent.eval("(($.timeline.state().actors || [])[0] || {}).pose || ''"),
        "ending": agent.eval("$.timeline.state().ending || ''"),
        "trust": agent.eval("Number($.store.get('trust', 0)) || 0"),
        "visible": agent.eval("!!(($.timeline.state().actors || [])[0] || {}).visible"),
    }


def play(route, out_dir, shots=True):
    agent = Agent(game="demos", scene="russi_vn", headless=True)
    taken = {}
    picks = []
    frames = 0
    pending = []          # (ключ, через сколько кадров снимать)
    try:
        shot_index = 0
        for _ in range(4000):
            agent.step(10)
            frames += 10
            info = state(agent)

            # Локация меняется под затемнение, поэтому кадр берём не в момент
            # смены, а когда проявится новая картинка.
            if pending:
                pending = [(key, left - 10) for key, left in pending]
                ready = [key for key, left in pending if left <= 0]
                pending = [(key, left) for key, left in pending if left > 0]
                for key in ready:
                    if not shots:
                        continue
                    shot_index += 1
                    path = os.path.join(out_dir, f"{route}_{shot_index:02d}_{key}.png")
                    agent.screenshot(path)

            # Скриншот: первый кадр каждой локации, первое появление героини,
            # каждый показ вариантов и обе концовки.
            keys = []
            if info["location"] and info["location"] not in taken:
                taken[info["location"]] = True
                keys.append("loc_" + info["location"])     # с задержкой: см. выше
            if info["visible"] and "hero" not in taken:
                taken["hero"] = True
                pending.append(("hero", 10))
            if info["choices"] and "choices" not in taken:
                taken["choices"] = True
                keys.append("choices")
            if info["ending"] and "ending" not in taken:
                taken["ending"] = True
                pending.append(("ending_" + info["ending"], 60))
            if shots:
                for key in keys:
                    # Выборы видны только пока ждут игрока — их снимаем сразу;
                    # локация и герой проявляются после затемнения, им даём время.
                    if key == "choices":
                        shot_index += 1
                        agent.screenshot(os.path.join(out_dir, f"{route}_{shot_index:02d}_{key}.png"))
                    else:
                        pending.append((key, 45))

            if info["choices"]:
                # Берём вариант по сценарию маршрута: пока не выбранный —
                # подсказка «Да» для хорошей концовки и «Не моё» для плохой.
                want_love = route == "love"
                index = None
                for i, text in enumerate(info["choices"]):
                    good = text.startswith("Да")
                    bad = text.startswith("Не моё")
                    if (want_love and good) or (not want_love and bad):
                        index = i
                        break
                if index is None:
                    index = 0 if want_love else len(info["choices"]) - 1
                picks.append(info["choices"][index][:40])
                agent.eval(f"$.dialog.choose({index})")
                continue

            if info["waiting"] == "say":
                agent.eval("$.dialog.next()")
                continue

            if not info["running"]:
                break

        # Досматриваем отложенные кадры: концовка проявляется не мгновенно.
        for _ in range(8):
            agent.step(10)
            if not pending:
                break
            pending = [(key, left - 10) for key, left in pending]
            for key, left in list(pending):
                if left <= 0:
                    shot_index += 1
                    if shots:
                        path = os.path.join(out_dir, f"{route}_{shot_index:02d}_{key}.png")
                        agent.screenshot(path)
            pending = [(key, left) for key, left in pending if left > 0]
        final = state(agent)
        return {
            "route": route,
            "ending": final["ending"],
            "trust": final["trust"],
            "picks": picks,
            "frames": frames,
            "stored": agent.eval("$.store.get('last_ending', '')"),
            "endings_seen": agent.eval("$.agent.snapshot().vn_last_ending || ''"),
        }
    finally:
        agent.close()


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", default="love", choices=["love", "hate"])
    parser.add_argument("--out", default="build/vn_shots")
    parser.add_argument("--no-shots", action="store_true")
    args = parser.parse_args(argv)

    os.makedirs(os.path.join(ROOT, args.out), exist_ok=True)
    result = play(args.route, os.path.join(ROOT, args.out), shots=not args.no_shots)
    print("маршрут     :", result["route"])
    print("концовка    :", result["ending"] or "(не дошли)")
    print("руси-метр   :", result["trust"])
    print("выборы      :", " → ".join(result["picks"]))
    print("кадров      :", result["frames"])
    print("в $.store   :", result["stored"])
    return 0 if result["ending"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
