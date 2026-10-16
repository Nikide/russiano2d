#!/usr/bin/env python3
# ===========================================================================
# Замер производительности по §35.2 Спецификации производственной готовности.
#
# Стенд гоняет сцены demos/stress агентом с фиксированным шагом и печатает
# frame time (p50/p95/p99), длительность кадра по фактам движка, число узлов,
# тел, частиц и света. Одно и то же число можно получить повторно: сцена
# детерминирована (fixed-dt и seed), меняется только конфигурация машины.
#
# Что стенд НЕ делает: не называет GPU time (движок его не измеряет
# timestamp'ами) и не складывает CPU и GPU как независимые части. Отчёт об
# этом прямо говорит — §28 и §35.2 требуют называть метрику корректно.
#
# Использование::
#
#     python3 tools/bench_stress.py                 # все сцены, 600 кадров
#     python3 tools/bench_stress.py --scene all --frames 1200
#     python3 tools/bench_stress.py --json build/stress.json
#
# Переменные окружения те же, что у агентского клиента: R2D_BINARY.
# ===========================================================================

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import resource
import statistics
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from agent_client import Agent, resolve_binary   # noqa: E402

SCENES = ["physics", "tilemap", "vfx", "lights", "ui", "all"]


def percentile(values, p):
    """Перцентиль без внешних зависимостей: ближайший ранг сверху."""
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((p / 100.0) * len(ordered) + 0.5)) - 1))
    return ordered[index]


def _backend_of(agent):
    """GPU-бэкенд из stderr движка (metal/vulkan/d3d12) — часть конфигурации."""
    text = agent.stderr_text()
    m = re.search(r"GPU-бэкенд:\s*(\w+)", text)
    return m.group(1) if m else None


def _machine():
    """Железо и ОС — часть конфигурации измерения."""
    cpu = platform.processor() or platform.machine()
    return {
        "cpu": cpu,
        "machine": platform.machine(),
        "os": platform.platform(),
    }


def measure(scene, frames, warmup, game=None):
    """Прогнать сцену и вернуть отчёт по ней.

    `game` — каталог игры-стенда; по умолчанию штатная `demos/stress`. Другой
    каталог нужен, когда измеряемая подсистема в штатных сценах не участвует
    (например, световая карта: сцена «lights» рисует свет прямо в сцену).
    """
    game = game or os.path.join("demos", "stress")
    with Agent(game=game, scene=scene, seed=7,
               fixed_dt=1.0 / 60.0, start_timeout=120, timeout=300) as a:
        a.step(warmup)
        counts = a.state().get("counts") or {}
        targets = a.state().get("count_targets") or {}

        # Замер кадров: профайлер подсистем включаем явно (по умолчанию он
        # выключен и стоит ноль, docs/HIGH_LEVEL_API_PERF.md §3.7).
        a.cmd("eval", code="engine.profileReset(); $.debug.profiler.on(true); $.debug.profiler.reset()")
        samples = []
        remaining = frames
        while remaining > 0:
            portion = min(60, remaining)
            started = time.perf_counter()
            a.step(portion)
            elapsed = time.perf_counter() - started
            # На кадр: время клиента включает протокол, поэтому это верхняя
            # граница, а не «CPU кадра». Основное число — из профайлера ниже.
            samples.extend([elapsed / portion * 1000.0] * portion)
            remaining -= portion

        prof = a.eval("engine.profile()")
        report = a.eval("$.debug.profiler.report()")
        debug_render = a.eval("$.debug.render()")
        backend = _backend_of(a)


    zones = {row.get("name"): row.get("avg_ms") for row in (prof.get("zones") or [])}
    game_ms = (report or {}).get("логика игры", {}).get("avg_ms", 0.0)
    return {
        "scene": scene,
        "game": game,
        "frames": frames,
        "warmup": warmup,
        "counts": counts,
        "targets": targets,
        # Верхняя граница по времени клиента: включает агентский протокол.
        "client_frame_ms": {
            "p50": round(percentile(samples, 50), 3),
            "p95": round(percentile(samples, 95), 3),
            "p99": round(percentile(samples, 99), 3),
            "max": round(max(samples), 3) if samples else 0.0,
        },
        "js_logic_ms": round(game_ms, 3),
        "zones_ms": {k: round(v, 3) for k, v in sorted(zones.items()) if isinstance(v, (int, float))},
        "profiler_frames": (prof.get("frames") or 0),
        # Бэкенд и память: §35.2 требует называть конфигурацию измерения, иначе
        # число p95 нельзя ни сравнить, ни воспроизвести.
        "backend": backend,
        # Память движка здесь НЕ измеряется: своего счётчика у него нет, `ps`
        # из песочницы/CI недоступен, а RUSAGE_CHILDREN на macOS не учитывает
        # детей без явного wait4 (проверено: возвращает 0). Метрика, которую
        # нельзя измерить, честно помечена как отсутствующая (§35.2), а способ
        # измерить — в примечании отчёта.
        "engine_peak_rss_kb": None,
        "draw_calls_detail": ((debug_render or {}).get("info") or {}).get("draws"),
        "passes": ((debug_render or {}).get("info") or {}).get("passes"),
        # Что из кадра уходит в JS-подсистемы, сколько остаётся на всё прочее
        # (нативная физика, отрисовка) и сколько занимает GPU. GPU называется
        # GPU-временем только если движок снял его timestamp'ами.
        "frames_cpu_ms": {
            "frame": round(prof.get("frame_ms") or 0.0, 3),
            "zones": round(prof.get("zones_ms") or 0.0, 3),
            "unaccounted": round(prof.get("unaccounted_ms") or 0.0, 3),
            "gpu": round(prof.get("gpu_ms") or 0.0, 3) if prof.get("gpu_available") else None,
            "gpu_available": bool(prof.get("gpu_available")),
        },
        "draw_calls": (debug_render or {}).get("batch", {}).get("draws"),
        "gpu_time": None,        # движок не измеряет GPU timestamps
        "notes": [
            "client_frame_ms — верхняя граница: включает агентский протокол и ожидание ответа.",
            "js_logic_ms и zones_ms — факты профайлера движка (fixed-dt).",
            "GPU time отсутствует: timestamp'ов GPU движок не снимает (§28).",
            "Память движка не измерена: ps недоступен, RUSAGE_CHILDREN на macOS не считает детей. "
            "Измерить вручную: /usr/bin/time -l ./build/russiano2d --game demos/stress --scene all",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="Замер стресс-сцен (§35.2)")
    parser.add_argument("--scene", action="append", default=None,
                        help="сцена стенда (можно повторять); по умолчанию все")
    parser.add_argument("--frames", type=int, default=600, help="кадров замера на сцену")
    parser.add_argument("--warmup", type=int, default=120, help="прогревочных кадров")
    parser.add_argument("--game", default=None,
                        help="каталог игры-стенда (по умолчанию demos/stress); "
                             "нужен для сцен, которых в штатном стенде нет")
    parser.add_argument("--json", default=None, help="куда сохранить машиночитаемый отчёт")
    args = parser.parse_args()

    scenes = args.scene or SCENES
    binary = resolve_binary()
    results = []
    for scene in scenes:
        try:
            results.append(measure(scene, args.frames, args.warmup, args.game))
            row = results[-1]
            print("  %-8s узлов %-5s тел %-5s частиц %-5s свет %-3s  p50 %6.2f мс  p95 %6.2f мс  p99 %6.2f мс  логика %5.2f мс"
                  % (scene, row["counts"].get("nodes"), row["counts"].get("bodies"),
                     row["counts"].get("particles"), row["counts"].get("lights"),
                     row["client_frame_ms"]["p50"], row["client_frame_ms"]["p95"],
                     row["client_frame_ms"]["p99"], row["js_logic_ms"]))
        except Exception as exc:                      # noqa: BLE001 — стенд не должен падать целиком
            print("  %-8s НЕ ИЗМЕРЕНО: %s" % (scene, exc))
            results.append({"scene": scene, "error": str(exc)})

    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                         cwd=ROOT, text=True).strip()
    except Exception:                                 # noqa: BLE001
        commit = None
    report = {
        "tool": "tools/bench_stress.py",
        "spec": "docs/PRODUCTION_READINESS.md §35.2",
        "binary": binary,
        "commit": commit,
        "machine": _machine(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "game": args.game or os.path.join("demos", "stress"),
        "resolution": "1920x1080",
        "target_fps": 60,
        "fixed_dt": 1.0 / 60.0,
        "frames": args.frames,
        "warmup": args.warmup,
        "gate": {
            # Предлагаемый gate базового профиля из §35.2: p95 <= 16,67 мс.
            "p95_limit_ms": 1000.0 / 60.0,
            "measured": "client_frame_ms.p95",
            "note": "client_frame_ms — верхняя граница: включает агентский протокол, "
                    "поэтому gate по ней осторожен. Факты движка — js_logic_ms/zones_ms.",
        },
        "results": results,
    }
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print("отчёт: %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
