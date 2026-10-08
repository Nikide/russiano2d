#!/usr/bin/env python3
"""Стенд замера высокоуровневого API `$` (Russiano2D).

Гоняет сцену-стенд ``tests/fixtures/bench`` в агентском режиме движка
(``--agent --headless --fixed-dt``) и печатает, сколько времени кадра уходит
на JS-слой: цикл кадра, селекторы, обёртки, сборку батча. Замеры берутся из
встроенного профайлера (``$.debug.profile()``), CPU-зоны исключают ожидание vsync, но зависят от сборки, GPU-бэкенда,
частоты CPU и фоновой нагрузки. Сравнивайте одинаковые условия.

Зачем отдельный инструмент: у движка есть профайлер кадра, но не было сцены,
на которой видно цену самого `$`. Отчёт по результатам —
``docs/HIGH_LEVEL_API_PERF.md``.

Использование::

    python3 tools/bench_highlevel.py                    # быстрый набор
    python3 tools/bench_highlevel.py --full             # все виды и все N
    python3 tools/bench_highlevel.py --only sprite,body --ns 100,1000
    python3 tools/bench_highlevel.py --repeat 3 --json build/bench_highlevel.json

Колонки таблицы:

* ``логика``    — зона «JS: логика»: весь engine.setUpdate (мир, подсистемы,
                  игровые ``$.update``);
* ``батч``      — зона «JS: сборка батча»: ``$.render`` + ``$.gfx._render()``;
* ``JS итого``  — сумма двух зон: цена кадра на стороне JS;
* ``физика``    — шаг Box2D (C);
* ``GPU``       — время кадра на GPU по fence (если доступно);
* ``кадр``      — реальное время кадра окна наблюдения;
* ``нарисовано``— сколько спрайтов ушло в кадр (``$.gfx.stats()``).

Время — миллисекунды, среднее по окну наблюдения.

Окружение::

    R2D_BINARY=...        # бинарник движка (иначе build/russiano2d)
    R2D_BENCH_WARM=40     # кадров прогрева (JIT, кэши) до замера
    R2D_BENCH_FRAMES=120  # кадров в окне замера
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agent_client import Agent, AgentError  # noqa: E402

#: Каталог сцены-стенда (относительно корня репозитория).
GAME = os.path.join("tests", "fixtures", "bench")

#: Быстрый набор: по одному размеру на вид работы — хватает, чтобы увидеть
#: и фиксированную цену кадра, и масштабирование.
QUICK: List[Tuple[str, int]] = [
    ("none", 0),
    ("sprite", 100),
    ("sprite", 1000),
    ("body", 1000),
    ("query", 1000),
    ("cached", 1000),
    ("id", 1000),
    ("tween", 1000),
    ("particles", 1000),
    ("ui", 1000),
    ("tilemap", 10000),
    ("chain", 1000),
    ("fast", 1000),
    ("churn", 1000),
    ("batch", 1000),
]

#: Полный набор: каждый вид на нескольких размерах.
FULL_KINDS: List[str] = [
    "none", "sprite", "body", "query", "id", "cached",
    "tween", "move", "particles", "ui", "text", "tilemap", "signal",
    "chain", "fast", "churn", "batch",
]
FULL_NS: List[int] = [0, 100, 250, 500, 1000, 2000]

#: Имена зон профайлера (src/profile.h, R2DProfileZone).
ZONE_LOGIC = "JS: логика"
ZONE_BATCH = "JS: сборка батча"
ZONE_PHYSICS = "физика (Box2D)"

WARM = int(os.environ.get("R2D_BENCH_WARM", "40"))
FRAMES = int(os.environ.get("R2D_BENCH_FRAMES", "120"))


def die(message: str) -> "None":
    print("ошибка: " + message, file=sys.stderr)
    raise SystemExit(2)


def parse_args(argv: List[str]) -> Dict[str, Any]:
    """Разбор аргументов вручную — как в tools/run_tests.py и release.py."""
    opts: Dict[str, Any] = {
        "quick": not argv,
        "full": False,
        "only": None,
        "ns": None,
        "repeat": 1,
        "json": None,
        "frames": FRAMES,
        "warm": WARM,
        "binary": None,
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--full":
            opts["full"] = True
            opts["quick"] = False
        elif arg == "--quick":
            opts["quick"] = True
        elif arg == "--only" and i + 1 < len(argv):
            i += 1
            opts["only"] = [k for k in argv[i].split(",") if k]
        elif arg == "--ns" and i + 1 < len(argv):
            i += 1
            opts["ns"] = [int(x) for x in argv[i].split(",") if x != ""]
        elif arg == "--repeat" and i + 1 < len(argv):
            i += 1
            opts["repeat"] = max(1, int(argv[i]))
        elif arg == "--json" and i + 1 < len(argv):
            i += 1
            opts["json"] = argv[i]
        elif arg == "--frames" and i + 1 < len(argv):
            i += 1
            opts["frames"] = max(10, int(argv[i]))
        elif arg == "--warm" and i + 1 < len(argv):
            i += 1
            opts["warm"] = max(0, int(argv[i]))
        elif arg == "--binary" and i + 1 < len(argv):
            i += 1
            opts["binary"] = argv[i]
        elif arg in ("-h", "--help"):
            print(__doc__)
            raise SystemExit(0)
        else:
            die("неизвестный аргумент: " + arg)
        i += 1
    return opts


def plan(opts: Dict[str, Any]) -> List[Tuple[str, int]]:
    """Список пар (вид, N) по аргументам командной строки."""
    if opts["only"]:
        kinds = opts["only"]
        if opts["ns"]:
            jobs = [(k, n) for k in kinds for n in opts["ns"]]
        else:
            jobs = [(k, 1000) for k in kinds]
    elif opts["full"]:
        jobs = [(k, n) for k in FULL_KINDS for n in FULL_NS]
    else:
        jobs = list(QUICK)
    return jobs


def measure(kind: str, n: int, opts: Dict[str, Any]) -> Dict[str, Any]:
    """Один прогон сценария: прогрев, окно замера, снимок профайлера."""
    scene = "%s:%d" % (kind, n)
    with Agent(game=opts.get("game", GAME), scene=scene, seed=opts.get("seed", 1), binary=opts["binary"],
               start_timeout=60, timeout=120) as a:
        if opts["warm"]:
            a.step(opts["warm"])
        a.cmd("eval", code="$.debug.profileReset()")
        a.step(opts["frames"])
        prof = a.eval("$.debug.profile()")
        stats = a.eval("$.gfx.stats()")
        nodes = a.eval("$.bench && $.bench.nodes")

    zones = {row["name"]: row["ms"] for row in prof["zones"]}
    logic = zones.get(ZONE_LOGIC, 0.0)
    batch = zones.get(ZONE_BATCH, 0.0)
    return {
        "kind": kind,
        "n": n,
        "scene": scene,
        "logic_ms": logic,
        "batch_ms": batch,
        "js_ms": logic + batch,
        "physics_ms": zones.get(ZONE_PHYSICS, 0.0),
        "frame_ms": prof["frame_ms"],
        "gpu_ms": prof["gpu_ms"],
        "gpu_available": prof["gpu_available"],
        "nodes": nodes,
        "sprites": stats.get("sprites"),
        "triangles": stats.get("triangles"),
        "texts": stats.get("texts"),
        "zones": zones,
    }


def median_run(kind: str, n: int, opts: Dict[str, Any]) -> Dict[str, Any]:
    """Несколько прогонов одного сценария: берём медиану по JS-времени.

    Разброс между прогонами на одной машине невелик, но он есть (частота
    ядра, фон). Медиана честнее среднего: один выброс её не сдвинет.
    """
    runs = [measure(kind, n, opts) for _ in range(opts["repeat"])]
    if len(runs) == 1:
        return runs[0]
    out = dict(runs[0])
    for key in ("logic_ms", "batch_ms", "js_ms", "physics_ms", "gpu_ms"):
        out[key] = statistics.median([r[key] for r in runs])
    out["runs"] = runs
    return out


def print_table(results: List[Dict[str, Any]]) -> None:
    header = ("вид", "N", "логика", "батч", "JS итого", "физика", "GPU", "кадр", "нарисовано")
    print("%-10s %7s %9s %9s %9s %9s %9s %9s  %s" % header)
    print("-" * 96)
    for r in results:
        draw = "спрайтов %s, узлов %s" % (r["sprites"], r["nodes"])
        print("%-10s %7d %9.3f %9.3f %9.3f %9.3f %9.3f %9.3f  %s" % (
            r["kind"], r["n"], r["logic_ms"], r["batch_ms"], r["js_ms"],
            r["physics_ms"], r["gpu_ms"], r["frame_ms"], draw))


def main(argv: List[str]) -> int:
    opts = parse_args(argv)
    jobs = plan(opts)
    results: List[Dict[str, Any]] = []
    for kind, n in jobs:
        try:
            results.append(median_run(kind, n, opts))
        except AgentError as exc:
            print("FAIL %s:%d — %s" % (kind, n, exc), file=sys.stderr)
            return 1
    print_table(results)
    print()
    print("прогрев %d кадров, замер %d кадров, повторов %d" % (
        opts["warm"], opts["frames"], opts["repeat"]))
    if opts["json"]:
        with open(opts["json"], "w", encoding="utf-8") as handle:
            json.dump({"options": {k: v for k, v in opts.items()}, "results": results},
                      handle, ensure_ascii=False, indent=2)
        print("JSON: " + opts["json"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
