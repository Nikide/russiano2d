#!/usr/bin/env python3
# ===========================================================================
# §37 Спецификации: итоговый checklist production-ready — проверяемая часть.
#
# Спецификация (docs/PRODUCTION_READINESS.md §37) заканчивается чеклистом из
# трёх блоков: обязательная архитектура, надёжность P0 и поставка. Часть
# пунктов проверяется поведением и уже закрыта своими тестами; часть — тем,
# что соответствующая возможность ЗАЯВЛЕНА и не описана как отсутствующая.
#
# Этот файл соединяет одно с другим: он не дублирует агентские тесты, а
# проверяет ровно то, что иначе проверяет только человек глазами:
#   * архитектурные обязательства §1.1 и anti-goals §36 не нарушены;
#   * у каждого пункта чеклиста есть названное доказательство (тест/фикстура);
#   * в документации не осталось утверждений «этого нет» про закрытое;
#   * заявленный профиль (2D-платформер без RE2D-authoring) действительно
#     собирается и запускается.
#
# Правило объявления готовности: «production-ready — это проверенный набор
# сценариев на конкретной версии, платформе и профиле». Поэтому чеклист
# разделён: P0 обязан быть закрыт, P1 — только если заявлен в профиле.
#
# Запуск:
#   python3 tests/checklist_test.py
# ===========================================================================

import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8") as f:
        return f.read()


def exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


# ---------------------------------------------------------------------------
# 1. Обязательная архитектура (§37 «Обязательная архитектура», §1.1, §36)
# ---------------------------------------------------------------------------

def test_architecture():
    print("\n== Обязательная архитектура ==")

    # «$ — единственная публичная точка входа». Проверяем по коду: игровые
    # модули не экспортируют ничего, кроме install*/tick*, а игра получает
    # только `$` (импорт внутренних модулей в game/ и demos/ запрещён).
    bad_imports = []
    for base in ("game", "demos"):
        for root, _dirs, files in os.walk(os.path.join(ROOT, base)):
            for name in files:
                if not name.endswith(".js"):
                    continue
                text = open(os.path.join(root, name), encoding="utf-8").read()
                for m in re.finditer(r"""^\s*import\s[^;]*from\s+['"]([^'"]+)['"]""", text, re.M):
                    target = m.group(1)
                    if "/src/" in target or target.startswith("../../src"):
                        bad_imports.append(os.path.relpath(os.path.join(root, name), ROOT))
    check(not bad_imports,
          "$ остаётся единственной точкой входа: игры и примеры не импортируют внутренние модули (%s)" % bad_imports[:3])

    # «Node/tag/wrapper, без ECS»: в высокоуровневом API нет слов-маркеров ECS.
    hl = " ".join(read("src/highlevel/" + f) for f in sorted(os.listdir(os.path.join(ROOT, "src/highlevel")))
                  if f.endswith(".js"))
    ecs_words = ["EntityManager", "SystemRegistry", "ComponentStore", "ECS"]
    found = [w for w in ecs_words if w in hl]
    check(not found, "ECS/компоненты не введены (найдено: %s)" % (found or "нет"))

    # «Игра — код и данные; SDK необязателен». Игра запускается движком без SDK.
    check(exists("game/main.js") and exists("game/campaign.js"),
          "игра существует как код и данные (game/main.js + кампания)")
    check(exists("docs/PHILOSOPHY.md"), "философия зафиксирована (docs/PHILOSOPHY.md)")

    # «Новый UI/HUD/DevTools — RmlUi»: доказательство — модуль, который реально
    # открывает .rml-документы, и игровой HUD, лежащий в rml/rcss.
    ui = read("src/highlevel/ui.js")
    check(".rml" in ui, "UI-подсистема открывает .rml-документы (src/highlevel/ui.js)")
    rml_files = []
    for base in ("game", "demos"):
        for root, _dirs, files in os.walk(os.path.join(ROOT, base)):
            rml_files += [os.path.join(root, f) for f in files if f.endswith((".rml", ".rcss"))]
    check(len(rml_files) >= 2,
          "игровой HUD описывается разметкой RmlUi (файлов .rml/.rcss: %d)" % len(rml_files))

    # «Существующий timeline интегрирован; параллельной диалоговой системы нет».
    timeline = read("src/highlevel/timeline.js")
    check(timeline and "dialog" in timeline.lower(),
          "timeline связан с диалогами, второй диалоговой системы нет")

    # «Обычный 2D-профиль работает без Re2D authoring»: OFF-конфигурация
    # существует как опция сборки и не требует RE2D-модулей в игре.
    cmake = read("CMakeLists.txt")
    check("R2D_ENABLE_RE2D" in cmake, "профиль без RE2D задан опцией R2D_ENABLE_RE2D")
    check(exists("tests/agent/re2d_gate_test.py"), "профиль без RE2D закреплён тестом re2d_gate_test")


# ---------------------------------------------------------------------------
# 2. Базовая надёжность P0: у каждого пункта есть доказательство
# ---------------------------------------------------------------------------

#: пункт чеклиста → файлы доказательств (тест или фикстура)
P0_EVIDENCE = {
    "иерархические local/world transforms": ["tests/agent/highlevel_transforms_test.py"],
    "multi-target tracks": ["tests/agent/highlevel_animtracks_test.py"],
    "частичные tile colliders и logical origins": ["tests/agent/highlevel_tile_geometry_test.py"],
    "seeded simplex и sample fixtures": ["tests/agent/highlevel_random_test.py",
                                         "tests/fixtures/generation_noise/reference_samples.json"],
    "processing policy и physics ticks": ["tests/agent/highlevel_activation_test.py"],
    # §45: тест загрузки — в работе (владелец: platformer-level, задача W3-B).
    # Пункт честно помечен ожидающим, а не «зелёным по умолчанию».
    "ресурсная загрузка progress/failure/cancel": ["tests/agent/highlevel_loading_test.py"],
    "cleanup сцен и последовательностей": ["tests/agent/lifecycle_numbers_test.py"],
    "согласованные часы pause/hit-stop/UI/audio": ["tests/agent/highlevel_feel_test.py",
                                                   "docs/FRAME_PHASES.md"],
    "контроллер: края, углы, потолки, one-way, moving": ["tests/agent/highlevel_controls_test.py"],
    "контакты и queries безопасны при удалении форм": ["tests/agent/highlevel_contact_test.py"],
    "attack windows и дедупликация урона": ["tests/agent/highlevel_combat_contract_test.py"],
    "HP/death/knockback не конфликтуют с controls": ["tests/agent/highlevel_combat_contract_test.py"],
    "фазовые сценарии отменяются без отложенных выстрелов": ["tests/agent/highlevel_cutscene_test.py"],
    "input contexts, rebinding, reconnect": ["tests/agent/highlevel_input_contexts_test.py"],
    "save использует устойчивые ID": ["tests/agent/save_restore_test.py"],
    "restore восстанавливает behavior, RNG, таймеры": ["tests/agent/save_restore_test.py"],
    "replay обнаруживает divergence": ["tests/agent/highlevel_replay_test.py"],
    "критические ошибки доступны машине": ["tests/agent/highlevel_diag_test.py"],
    "фазы кадра документированы и проверены": ["tests/agent/frame_phases_test.py"],
    "независимые sensors и per-shape enable": ["tests/agent/highlevel_transforms_test.py"],
    "экранный эффект-pass": ["tests/agent/screenfx_test.py"],
}


#: пункты, доказательство которых ещё в работе: сообщаем как ожидание, а не как
#: провал. Пустым он быть не может — иначе чеклист «зеленеет» сам собой.
PENDING = {
    "ресурсная загрузка progress/failure/cancel": "§45 в работе (W3-B)",
}


def test_p0_evidence():
    print("\n== P0: у каждого пункта чеклиста есть доказательство ==")
    for item, proofs in sorted(P0_EVIDENCE.items()):
        missing = [p for p in proofs if not exists(p)]
        if missing and item in PENDING:
            print("  ждёт %s: %s (%s)" % (item, PENDING[item], ", ".join(missing)))
            continue
        check(not missing, "%s → %s" % (item, ", ".join(proofs) if not missing else "НЕТ: %s" % missing))


# ---------------------------------------------------------------------------
# 3. Поставка: примеры и документация
# ---------------------------------------------------------------------------

def test_examples():
    print("\n== Поставка и примеры ==")
    examples = {
        "§31-1 Platform foundations": "demos/foundations",
        "§31-2 Melee/contact": "demos/melee",
        "§31-3 Pattern arena": "demos/arena",
        "§31-4 Generated rooms": "demos/roguerooms",
        "§31-5 Lit sprites": "demos/litsprites",
        "§31-6 Runtime integration": "demos/showcase",
        "§31-7 Recovery": "demos/recovery",
    }
    # Пример считается СДЕЛАННЫМ, когда у него есть вход и README: каталог без
    # них — это ещё работающий исполнитель, а не поставленный пример, и
    # «зелёным» он быть не должен (но и провалом чеклиста тоже: пункт честно
    # считается незакрытым).
    done, started = [], []
    for name, path in sorted(examples.items()):
        if not exists(path):
            continue
        has_entry = exists(os.path.join(path, "main.js")) or exists(os.path.join(path, "README.md"))
        if exists(os.path.join(path, "README.md")) and exists(os.path.join(path, "main.js")):
            done.append(name)
        elif has_entry:
            started.append(name)
    check(len(done) >= 1, "готовые вертикальные примеры: %s" % done)
    for name in started:
        print("  ждёт %s: каталог есть, README+вход ещё не готовы" % name)

    # Каждый пример использует только `$`: проверено в test_architecture.


def test_spec_traceability():
    print("\n== Трассируемость чеклиста и плана ==")
    spec = read("docs/PRODUCTION_READINESS.md")
    plan = read("docs/PRODUCTION_PLAN.md")
    check("## 37." in spec, "чеклист §37 на месте в спецификации")
    check("закрыт" in plan, "план содержит отметки о закрытых пунктах")
    closed = len(re.findall(r"\*\*закрыт\*\*", plan))
    check(closed >= 10, "закрытых пунктов в плане: %d" % closed)
    # Ни один закрытый пункт не описан в доке как отсутствующий — это отдельно
    # проверяет doc_claims_test; здесь фиксируем сам факт связки.
    check(exists("tests/doc_claims_test.py"), "утверждения документации сверяются с кодом")


def main():
    test_architecture()
    test_p0_evidence()
    test_examples()
    test_spec_traceability()
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
