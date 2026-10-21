#!/usr/bin/env python3
# ===========================================================================
# §34 и §49 Спецификации: этапы A–H и минимальная последовательность.
#
# §34 задаёт порядок работ и gate каждого этапа, §49 — минимальную
# последовательность закрытия функциональных пробелов. Это не «код», а
# контракт о том, что именно считается доказанным. Проверять его тоже нужно
# машиной, иначе порядок закрытия живёт только в обсуждении.
#
# Для каждого этапа/шага названо доказательство (тест или артефакт). Тест
# проходит, когда доказательство есть; отсутствующее печатается как «ждёт
# этап X» и НЕ считается закрытым.
#
# Запуск:
#   python3 tests/stages_test.py
# ===========================================================================

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


#: Этап §34 → (содержание, доказательства gate, номер шага §49)
STAGES = [
    ("A", "Baseline API, clocks, ownership, проектирование совместимых transforms", [
        "docs/PHILOSOPHY.md", "docs/FRAME_PHASES.md", "tests/agent/frame_phases_test.py",
    ], None),
    ("B", "Transforms, compound sensors, contact/controller contract, lifecycle, input contexts", [
        "tests/agent/highlevel_transforms_test.py", "tests/agent/highlevel_controls_test.py",
        "tests/agent/lifecycle_numbers_test.py", "tests/agent/highlevel_input_contexts_test.py",
    ], 1),
    ("C", "Animation tracks и окна, hit/hurt resolution, flows/patterns", [
        "tests/agent/highlevel_animtracks_test.py", "tests/agent/highlevel_combat_contract_test.py",
        "tests/agent/highlevel_cutscene_test.py",
    ], 2),
    ("D", "Stable IDs, RNG state, transactional save, replay hashes", [
        "tests/agent/save_restore_test.py", "tests/agent/highlevel_replay_test.py",
        "tests/agent/highlevel_random_test.py",
    ], 3),
    ("E", "Atlas, partial-tile collision, simplex, room data, generation validation", [
        "tests/agent/highlevel_tile_geometry_test.py", "tests/agent/highlevel_random_test.py",
        "tests/fixtures/generation_noise/reference_samples.json",
    ], 3),
    ("F", "Renderer integration, camera arbitration, lighting/materials, VFX budgets", [
        "tests/agent/highlevel_render_test.py", "tests/agent/highlevel_light_test.py",
        "tests/agent/highlevel_presentation_test.py", "tests/agent/screenfx_test.py",
    ], 5),
    ("G", "Audio routing/stems, timeline integration, UI/localization", [
        "tests/agent/highlevel_audiobus_test.py", "tests/js/timeline_test.mjs",
        "tests/agent/rusya_love_vn_test.py",
        "tests/agent/highlevel_i18n_test.py",
    ], 5),
    ("H", "SDK panels, examples, installed packaging, release acceptance", [
        "tests/profile_2d_test.py", "tests/acceptance_test.py", "tests/checklist_test.py",
        "demos/foundations/README.md", "tests/agent/platformer_editor_demo_test.py",
        "tests/agent/rusya_love_vn_test.py",
    ], 6),
]

#: §49 → шаг и доказательство gate
SEQUENCE = {
    1: ("§39–40 transforms и независимые sensors: sword/muzzle/область совпадают после flip/rotation",
        ["tests/agent/highlevel_transforms_test.py"]),
    2: ("§41 + §6 tracks и единое время: attack clip с окном, частицами, звуком и interrupt",
        ["tests/agent/highlevel_animtracks_test.py"]),
    3: ("§42–43 partial tiles и simplex: карта, платформы, свободные зоны и spawn через $",
        ["tests/agent/highlevel_tile_geometry_test.py", "tests/agent/highlevel_random_test.py"]),
    4: ("§44–45 + §5 start → room → death → retry → next room без оставшихся узлов/подписок",
        ["tests/agent/lifecycle_numbers_test.py"]),
    5: ("§46–48 точность screen/particle/audio presentation",
        ["tests/agent/screenfx_test.py", "tests/agent/highlevel_audiobus_test.py"]),
    6: ("Остальные P0-интеграционные проверки, затем P1/P2 по профилю продукта",
        ["tests/checklist_test.py"]),
}

#: Шаги, доказательство которых ещё в работе: печатаются как ожидание.
PENDING = {
    4: "§45 в работе (W3-B)",
}


def test_stages():
    print("== §34: этапы A–H ==")
    for stage, content, proofs, _seq in STAGES:
        missing = [p for p in proofs if not exists(p)]
        label = "Этап %s: %s" % (stage, content)
        if missing:
            print("  ждёт %s: нет %s" % (label, missing))
        else:
            check(True, "%s → %s" % (label, ", ".join(proofs)))


def test_sequence():
    print("\n== §49: минимальная последовательность ==")
    for step in sorted(SEQUENCE):
        content, proofs = SEQUENCE[step]
        missing = [p for p in proofs if not exists(p)]
        if missing and step in PENDING:
            print("  ждёт шаг %d: %s (%s)" % (step, PENDING[step], ", ".join(missing)))
            continue
        check(not missing, "Шаг %d: %s → %s" % (step, content, ", ".join(proofs) if not missing else "НЕТ: %s" % missing))


def test_docs():
    print("\n== §34/§49: договорённости в документации ==")
    spec = open(os.path.join(ROOT, "docs", "PRODUCTION_READINESS.md"), encoding="utf-8").read()
    check("## 34." in spec and "## 49." in spec, "разделы §34 и §49 на месте")
    plan = open(os.path.join(ROOT, "docs", "PRODUCTION_PLAN.md"), encoding="utf-8").read()
    check("Волна" in plan or "волн" in plan, "план описывает волны работ (порядок §34/§49)")
    check("checklist_test" in plan and "acceptance_test" in plan,
          "план ссылается на машинные гейты чеклиста и приёмки")


def main():
    test_stages()
    test_sequence()
    test_docs()
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
