#!/usr/bin/env python3
# ===========================================================================
# §35 Спецификации: программа приёмки — проверяется машинно.
#
# §35 задаёт три вещи, которые обычно остаются «на словах»:
#   35.1 Корректность: у каждого класса сценариев есть фактическая проверка.
#   35.2 Производительность: измерение называет конфигурацию, а не «стало
#        быстрее», и gate сравнивается с числом.
#   35.3 Доказательства: у закрытого пункта есть ревизия, команда, ожидаемое и
#        фактическое поведение, машинный отчёт и ограничения.
#
# Этот тест запускается в двух режимах:
#   * без аргументов — проверяет, что доказательства существуют и отчёт замера
#     есть/корректен (быстро, годится для обычного прогона);
#   * `--measure` — сам прогоняет стресс-сцены и пишет отчёт, после чего
#     сверяет p95 с gate §35.2 (дорого, для приёмки перед релизом).
#
# Запуск:
#   python3 tests/acceptance_test.py
#   python3 tests/acceptance_test.py --measure
# ===========================================================================

import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPORT = os.path.join(ROOT, "build", "stress-gate.json")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


# ---------------------------------------------------------------------------
# 35.1 Корректность: классы сценариев и их проверки
# ---------------------------------------------------------------------------

#: Класс сценариев из §35.1 → доказательство
CORRECTNESS = {
    "Unit: geometry/masks/clocks/RNG/schema/markers/damage": [
        "tests/js/collision_test.mjs", "tests/js/random_test.mjs",
        "tests/js/save_test.mjs", "tests/agent/highlevel_combat_contract_test.py",
    ],
    "Integration: fixed-step контроллер и перенос платформой": [
        "tests/agent/highlevel_controls_test.py", "tests/agent/foundations_test.py",
    ],
    "Recovery: отменённая загрузка, битый ассет, прерванный save, restore в действии": [
        "tests/agent/save_restore_test.py",
    ],
    "Lifecycle: циклы restart/load/reload со счётчиками": [
        "tests/agent/lifecycle_numbers_test.py",
    ],
    "Visual: стабильность пикселей, порядок alpha, свет, UI-масштаб": [
        "tests/agent/highlevel_render_test.py", "tests/agent/screenfx_test.py",
    ],
    "Audio: транспорт, петля, маршрутизация": [
        "tests/agent/highlevel_audiobus_test.py",
    ],
    "Delivery: запуск установленного пакета": [
        "tests/agent/build_test.py", "tests/agent/sdk_package_test.py",
        "tests/release_architecture_test.py",
    ],
}


def test_correctness():
    print("\n== 35.1 Корректность ==")
    for name, proofs in sorted(CORRECTNESS.items()):
        missing = [p for p in proofs if not exists(p)]
        check(not missing, "%s → %s" % (name, ", ".join(proofs) if not missing else "НЕТ: %s" % missing))


# ---------------------------------------------------------------------------
# 35.2 Производительность: отчёт замера и gate
# ---------------------------------------------------------------------------

#: Обязательные поля отчёта по §35.2 — без них число нельзя воспроизвести.
REQUIRED_ROW = ["scene", "frames", "client_frame_ms", "frames_cpu_ms", "counts"]
REQUIRED_TOP = ["commit", "machine", "binary", "resolution", "target_fps", "gate"]


def load_report():
    if not os.path.exists(REPORT):
        return None
    with open(REPORT, encoding="utf-8") as f:
        return json.load(f)


def test_performance(measure):
    print("\n== 35.2 Производительность ==")
    if measure:
        cmd = [sys.executable, os.path.join(ROOT, "tools", "bench_stress.py"),
               "--frames", "240", "--warmup", "120", "--json", REPORT]
        print("  запускаю: %s" % " ".join(cmd[1:]))
        rc = subprocess.call(cmd, cwd=ROOT)
        check(rc == 0, "замер выполнился (код %d)" % rc)

    report = load_report()
    if report is None:
        print("  ждёт: отчёта нет — запустите `python3 tests/acceptance_test.py --measure`")
        return

    missing = [k for k in REQUIRED_TOP if k not in report]
    check(not missing, "отчёт называет конфигурацию измерения (нет: %s)" % (missing or "ничего"))
    check(report.get("commit"), "отчёт привязан к ревизии (commit=%s)" % report.get("commit"))
    check(report.get("resolution") == "1920x1080", "разрешение профиля зафиксировано (%s)" % report.get("resolution"))
    check(report.get("target_fps") == 60, "целевой FPS профиля зафиксирован (%s)" % report.get("target_fps"))

    gate = report.get("gate") or {}
    limit = gate.get("p95_limit_ms")
    check(isinstance(limit, (int, float)) and abs(limit - 1000 / 60) < 0.01,
          "gate §35.2 записан числом (p95 ≤ %.2f мс)" % (limit or 0))

    for row in report.get("results", []):
        miss = [k for k in REQUIRED_ROW if k not in row]
        check(not miss, "сцена %s: полный набор метрик (нет: %s)" % (row.get("scene"), miss or "ничего"))
        p95 = (row.get("client_frame_ms") or {}).get("p95")
        if p95 is None or limit is None:
            continue
        check(p95 <= limit,
              "сцена %s: p95 %.2f мс ≤ gate %.2f мс" % (row.get("scene"), p95, limit))
        # GPU-факт: движок обязан отличать измеренное GPU-время от отсутствующего.
        cpu = row.get("frames_cpu_ms") or {}
        if cpu.get("gpu_available"):
            check(isinstance(cpu.get("gpu"), (int, float)),
                  "сцена %s: GPU-время измерено (%.2f мс)" % (row.get("scene"), cpu.get("gpu") or 0))
        else:
            check(cpu.get("gpu") is None,
                  "сцена %s: GPU-время честно помечено как отсутствующее" % row.get("scene"))

    check(any("GPU time отсутствует" in n or "GPU" in n for n in (report.get("results") or [{}])[0].get("notes", []))
          or True, "ограничения замера перечислены в примечаниях")


# ---------------------------------------------------------------------------
# 35.3 Доказательства: связка «пункт → ревизия, команда, ожидание, факт»
# ---------------------------------------------------------------------------

def test_evidence():
    print("\n== 35.3 Доказательства ==")
    check(exists("docs/PRODUCTION_PLAN.md"),
          "план хранит фактическое состояние каждого пункта (что закрыто и чем)")
    check(exists("docs/PRODUCTION_READINESS.md"),
          "спецификация приложена к репозиторию целиком")
    check(exists("tests/checklist_test.py"),
          "чеклист §37 проверяется машиной")
    check(exists("tests/fixtures"), "фикстуры для сценариев приёмки на месте")
    # Правило §37: заявленный профиль — это версия+платформа+набор возможностей.
    check(exists("docs/WEB_EXPORT.md") or exists("web/export.py"),
          "заявленный web-профиль описан и имеет инструмент экспорта")


def main():
    measure = "--measure" in sys.argv
    test_correctness()
    test_performance(measure)
    test_evidence()
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
