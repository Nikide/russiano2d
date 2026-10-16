#!/usr/bin/env python3
# ===========================================================================
# §51: базлайны профайлера на стресс-сценах.
#
# Порогов «60 FPS на любом железе» здесь нет и быть не может: замер зависит от
# машины. Проверяется то, что обязано быть верным всегда, а числа печатаются
# рядом с проверкой — по логу видно, сколько кадр стоил на этой машине:
#
#   * стресс-сцена действительно содержит заявленное число узлов/спрайтов/
#     тел/частиц (иначе «базлайн» меряет пустоту);
#   * порядок величины: CPU-цена кадра на каждой сцене ниже потолка, за
#     которым цикл уже сломан, а не медленный;
#   * рост нагрузки вдвое не даёт квадратичного роста цены (N → 2N);
#   * за длинный прогон цена НЕ деградирует вдвое (окно A против окна B через
#     три сотни кадров в том же процессе: так ловится накопление, а не шум
#     загрузки машины);
#   * счётчики ресурсов за длинный прогон не растут (runaway resource count):
#     узлы, тела, спрайты, текстуры — те же в окне A и в окне B;
#   * смешанная сцена (тела + частицы + спрайты + интерфейс + текст + свет)
#     укладывается в тот же потолок и не деградирует.
#
# Запуск (после сборки):
#   python3 tests/agent/profiler_baseline_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
BENCH = os.path.join("tests", "fixtures", "bench")

#: Потолок CPU-цены кадра на стресс-сценах, миллисекунды. Обоснование: кадр при
#: --fixed-dt идёт 16.67 мс; если сумма ИЗМЕРЕННЫХ CPU-зон перевалила за 50 мс,
#: это уже не «медленная машина», а сломанный кадровый цикл (сцена с 1000
#: спрайтов на штатном железе стоит единицы миллисекунд — см. печать замеров).
CPU_CEILING_MS = 50.0

#: Допуск на рост цены при удвоении числа объектов: линейная работа даёт ~2×,
#: квадратичная — 4×. Порог 3× отделяет одно от другого и прощает шум.
SCALE_ALLOWANCE = 3.0

#: Допуск на деградацию за длинный прогон: «вдвое» из §51 — это и есть порог.
DEGRADE_ALLOWANCE = 2.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def window(a, frames):
    """Одно окно замера: средние по кадрам CPU-зоны кадра."""
    a.eval("engine.profileReset()")
    a.step(frames)
    prof = ev(a, "engine.profile()", None)
    if not prof:
        return None
    zones = {row["name"]: row["ms"] for row in prof.get("zones", [])}
    # «ожидание swapchain» — это не работа CPU, а ожидание vsync: из суммы зон
    # её вычитаем, иначе базлайн мерил бы монитор.
    cpu = prof.get("zones_ms", 0.0) - zones.get("ожидание swapchain", 0.0)
    return {
        "cpu": cpu,
        "logic": zones.get("JS: логика", -1.0),
        "batch": zones.get("JS: сборка батча", -1.0),
        "physics": zones.get("физика (Box2D)", 0.0),
        "frames": prof.get("frames", 0),
        "zones": zones,
    }


def ui_nodes(a):
    """Сколько узлов интерфейса в реестре (у них флаг ui в описании узла)."""
    try:
        return sum(1 for row in a.query("*") if row.get("ui"))
    except AgentError as exc:
        print("  --   query не выполнился: %s" % str(exc).splitlines()[0][:140])
        return -1


def resources(a):
    """Наблюдаемые счётчики ресурсов: узлы, тела, спрайты, текстуры."""
    lim = ev(a, "$.debug.limits()", {}) or {}
    stats = ev(a, "$.gfx.stats()", {}) or {}
    return {
        "nodes": ev(a, "$.world.count()", -1),
        "bodies": lim.get("bodies"),
        "sprites": stats.get("sprites"),
        "textures": lim.get("textures"),
        "raw": stats.get("raw_count"),
    }


def measure(kind, nodes, warm=25, frames=30, windows=3, gap=0, probe=None):
    """Прогон сцены стенда: несколько окон замера, медиана по CPU.

    `gap` — сколько кадров прогнать между первым и последним окном: так
    проверяется деградация за длинную дистанцию в одном процессе.
    `probe(a)` — дополнительный замер внутри той же сессии (например, число
    узлов интерфейса, которых нет в $.world.count()).
    """
    with Agent(game=BENCH, scene="%s:%d" % (kind, nodes), seed=1,
               start_timeout=60, timeout=180) as a:
        a.step(warm)
        extra = probe(a) if probe else None
        first = [window(a, frames) for _ in range(windows)]
        first = [w for w in first if w]
        res_a = resources(a)
        if gap:
            a.step(gap)
        last = [window(a, frames) for _ in range(windows)]
        last = [w for w in last if w]
        res_b = resources(a)
        cpu_first = median([w["cpu"] for w in first])
        cpu_last = median([w["cpu"] for w in last])
        return {
            "kind": kind, "nodes": nodes,
            "declared": ev(a, "$.bench.nodes", -1),
            "sprites": ev(a, "$.gfx.stats().sprites", -1),
            "first": cpu_first, "last": cpu_last,
            "logic": median([w["logic"] for w in first]),
            "batch": median([w["batch"] for w in first]),
            "physics": median([w["physics"] for w in first]),
            "res_a": res_a, "res_b": res_b,
            "extra": extra,
            "frames": first[0]["frames"] if first else 0,
        }


def median(values):
    if not values:
        return float("nan")
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def report(m):
    print("  --   %-14s из %.1f мс CPU: логика %.2f, батч %.2f, физика %.2f"
          % ("%s:%d" % (m["kind"], m["nodes"]), m["first"],
             m["logic"], m["batch"], m["physics"]))


def main():
    # --- 1. Пустой цикл и спрайты: порядок величины и масштаб N → 2N ---------
    idle = measure("none", 0)
    report(idle)
    check(idle["frames"] > 0 and idle["first"] == idle["first"],
          "пустая сцена измерима (%.3f мс CPU)" % idle["first"])

    small = measure("sprite", 500)
    big = measure("sprite", 1000)
    report(small)
    report(big)
    check(small["declared"] == 500 and small["sprites"] == 500,
          "сцена sprite:500 действительно содержит 500 спрайтов (%s)" % small["sprites"])
    check(big["declared"] == 1000 and big["sprites"] == 1000,
          "сцена sprite:1000 действительно содержит 1000 спрайтов (%s)" % big["sprites"])
    check(small["first"] < CPU_CEILING_MS and big["first"] < CPU_CEILING_MS,
          "цена кадра ниже потолка %.0f мс (%.2f и %.2f)"
          % (CPU_CEILING_MS, small["first"], big["first"]))
    ratio = big["first"] / max(small["first"], 1e-6)
    print("  --   sprite 500 → 1000: ×%.2f" % ratio)
    check(ratio <= SCALE_ALLOWANCE,
          "удвоение спрайтов не даёт квадратичного роста (×%.2f ≤ ×%.1f)"
          % (ratio, SCALE_ALLOWANCE))

    # --- 2. Тела, частицы, интерфейс, тайлмап --------------------------------
    bodies = measure("body", 400)
    report(bodies)
    check(bodies["declared"] == 400 and (bodies["res_a"]["bodies"] or 0) >= 400,
          "сцена body:400 подняла тела (%s)" % bodies["res_a"]["bodies"])
    check(bodies["physics"] > 0, "физика в кадре измерена (%.3f мс)" % bodies["physics"])
    check(bodies["first"] < CPU_CEILING_MS,
          "цена кадра с 400 телами ниже потолка (%.2f)" % bodies["first"])

    particles = measure("particles", 2000)
    report(particles)
    count = particles["res_a"]["sprites"]
    check((count or 0) > 0, "частицы в батче сцены particles:2000 (%s спрайтов)" % count)
    check(particles["first"] < CPU_CEILING_MS,
          "цена кадра с частицами ниже потолка (%.2f)" % particles["first"])

    ui = measure("ui", 300, probe=ui_nodes)
    report(ui)
    print("  --   ui:300 — узлов интерфейса в реестре: %s" % ui["extra"])
    check(ui["extra"] == 300, "сцена ui:300 содержит 300 узлов интерфейса (%s)" % ui["extra"])
    check(ui["first"] < CPU_CEILING_MS, "цена кадра интерфейса ниже потолка (%.2f)" % ui["first"])

    tiles = measure("tilemap", 900)
    report(tiles)
    check(tiles["declared"] == 900, "сцена tilemap:900 построила карту (%s тайлов)" % tiles["declared"])
    check(tiles["first"] < CPU_CEILING_MS, "цена кадра тайлмапа ниже потолка (%.2f)" % tiles["first"])

    # --- 3. Длинный прогон: деградация вдвое и рост счётчиков ----------------
    churn = measure("churn", 200, gap=300)
    report(churn)
    print("  --   churn:200 окно A %.2f мс → окно B %.2f мс; ресурсы %s → %s"
          % (churn["first"], churn["last"], churn["res_a"], churn["res_b"]))
    check(churn["last"] <= churn["first"] * DEGRADE_ALLOWANCE + 0.5,
          "за 300+ кадров цена не выросла вдвое (%.2f → %.2f)"
          % (churn["first"], churn["last"]))
    check(churn["res_a"] == churn["res_b"],
          "счётчики ресурсов за длинный прогон не растут (%s == %s)"
          % (churn["res_a"], churn["res_b"]))

    # --- 4. Смешанная сцена: тела + частицы + спрайты + интерфейс + свет ----
    with Agent(game=BENCH, scene="none:0", seed=1, start_timeout=60, timeout=180) as a:
        a.step(5)
        a.eval("""
            $.world.gravity(0, 500).color('#101820').bounds(-4000, -4000, 8000, 8000);
            $.camera.at(0, 0);
            for (let i = 0; i < 120; i++) {
                const x = (i % 15) * 40 - 300, y = Math.floor(i / 15) * 40 - 160;
                $('<rect>', { id: 'mix_s' + i }).at(x, y).size(16, 16).color('#3aa0ff')
                    .appendTo($.world);
            }
            for (let i = 0; i < 80; i++) {
                const x = (i % 10) * 50 - 250, y = Math.floor(i / 10) * 50 - 200;
                $('<enemy>', { id: 'mix_b' + i }).at(x, y).size(14, 14).appendTo($.world);
            }
            for (let i = 0; i < 60; i++) {
                $('<ui.label>', { id: 'mix_u' + i, text: 'HUD ' + i }).at(20 + (i % 10) * 60, 20 + Math.floor(i / 10) * 18)
                    .appendTo($.ui);
            }
            for (let i = 0; i < 40; i++) {
                $('<text>', { id: 'mix_t' + i, text: 'кадр ' + i }).at(-300 + (i % 10) * 60, 220 + Math.floor(i / 10) * 24)
                    .appendTo($.world);
            }
            $('<particles>', { id: 'mix_fx', amount: 600, rate: 1200, lifetime: 1500,
                               speed: [10, 60], spread: 360, seed: 5, max_particles: 1200 })
                .at(0, 0).appendTo($.world);
            $('<light>', { id: 'mix_light', radius: 600, intensity: 1, color: '#ffddaa',
                           cone: 360, segments: 64, shadows: true }).at(0, 0)
                .blend('add').appendTo($.world);
            $('<rect>', { id: 'mix_wall' }).at(120, 0).size(40, 40).color('#2a2f3a')
                .appendTo($.world);
            'ok'
        """)
        a.step(20)
        mixed_a = resources(a)
        mixed_ui = ui_nodes(a)
        m1 = [window(a, 30) for _ in range(3)]
        a.step(300)
        m2 = [window(a, 30) for _ in range(3)]
        mixed_b = resources(a)
        first = median([w["cpu"] for w in m1 if w])
        last = median([w["cpu"] for w in m2 if w])
        print("  --   mixed (120 спрайтов + 80 тел + 600 частиц + 60 ui + 40 текстов + свет):"
              " окно A %.2f мс → окно B %.2f мс, узлов мира %s, узлов ui %s"
              % (first, last, mixed_a["nodes"], mixed_ui))
        check(mixed_a["nodes"] >= 120 + 80 + 40 + 2 and mixed_ui >= 60,
              "смешанная сцена собрана (%s узлов мира, %s ui)" % (mixed_a["nodes"], mixed_ui))
        check((mixed_a["sprites"] or 0) > 600,
              "частицы смешанной сцены дошли до батча (%s спрайтов)" % mixed_a["sprites"])
        check(first < CPU_CEILING_MS,
              "смешанный кадр ниже потолка %.0f мс (%.2f)" % (CPU_CEILING_MS, first))
        check(last <= first * DEGRADE_ALLOWANCE + 0.5,
              "смешанная сцена не деградирует вдвое за 300 кадров (%.2f → %.2f)"
              % (first, last))
        check(mixed_a["nodes"] == mixed_b["nodes"] and mixed_a["bodies"] == mixed_b["bodies"],
              "узлы и тела смешанной сцены не растут (%s/%s → %s/%s)"
              % (mixed_a["nodes"], mixed_a["bodies"], mixed_b["nodes"], mixed_b["bodies"]))

        check(a.ping().get("pong") is True, "движок отвечает после стресс-сцен")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
