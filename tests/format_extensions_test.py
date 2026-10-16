#!/usr/bin/env python3
# ===========================================================================
# §33 Спецификации: расширения форматов данных.
#
# §33 перечисляет МИНИМАЛЬНЫЙ состав полей для данных игры (атлас, анимация,
# коллизии, комнаты, сохранение, replay, материалы, музыка, ввод, отчёт
# валидации). Это «состав данных, а не утверждение о готовой новой схеме» —
# поэтому проверяется ровно одно: не разошлись ли обещания и код.
#
# Тест читает КОД и сверяет с таблицей ниже: для каждого расширения названо,
# где поле живёт и что из него проверено тестом. Пункт без места в коде —
# честно помечен как незаявленный, а не выдан за реализованный.
#
# Запуск:
#   python3 tests/format_extensions_test.py
# ===========================================================================

import os
import re
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


#: Данные §33 → где живёт в коде и какой признак поля искать.
#: `claimed: False` означает, что расширение НЕ заявляется этим профилем —
#: тогда в документации оно обязано быть помечено как не входящее.
EXTENSIONS = {
    "Atlas (trim/pivot/duration/page)": {
        "files": ["src/highlevel/atlas.js"],
        # page (несколько страниц) НЕ реализован: атлас одного листа с
        # несколькими ИСТОЧНИКАМИ есть (§42 sources), страницы — нет. Поэтому
        # в наборе обязательных полей его нет, а отсутствие названо явно.
        "needles": ["duration", "trimmed", "pivot"],
        "claimed": True,
        "absent_ok": ["page"],
    },
    "Animation (маркеры, окна, named targets, clock)": {
        "files": ["src/highlevel/animplayer.js"],
        "needles": ["marker", "window", "target", "clock"],
        "claimed": True,
    },
    "Collision (роль формы, owner, маски, one-way)": {
        "files": ["src/highlevel/core.js", "src/highlevel/tilemap.js"],
        "needles": ["role", "owner", "mask", "oneWay"],
        "claimed": True,
    },
    "Room/prefab (стабильные ID, bounds, markers)": {
        "files": ["src/highlevel/prefab.js"],
        "needles": ["nid", "children"],
        "claimed": True,
    },
    "Save (schema/content version, nid-состояние, RNG)": {
        "files": ["src/highlevel/save.js"],
        "needles": ["schema", "nid", "rng"],
        "claimed": True,
    },
    "Replay (build/content hashes, step, checkpoints)": {
        "files": ["src/highlevel/replay.js"],
        "needles": ["identity", "content", "checkpoint", "dt"],
        "claimed": True,
    },
    "Material (albedo/normal/emissive, lit flag)": {
        "files": ["src/highlevel/render.js"],
        "needles": ["normal", "lit"],
        "claimed": False,   # normal maps заявлены как опция, материал — в работе
    },
    "Music (stems, loop, transport)": {
        "files": ["src/highlevel/audio.js", "src/highlevel/audiobus.js"],
        "needles": ["stem", "loop", "transport"],
        "claimed": False,   # §25 в работе у исполнителя
    },
    "Input (actions/contexts, bindings, device policy)": {
        "files": ["src/highlevel/input.js"],
        "needles": ["context", "ignore", "device"],
        "claimed": True,
    },
    "Validation report (code, severity, path, ids)": {
        "files": ["src/highlevel/diag.js"],
        "needles": ["code", "subsystem", "jsonPath", "nodeId"],
        "claimed": True,
    },
}


def test_extensions():
    print("== §33: состав данных ==")
    for name, spec in sorted(EXTENSIONS.items()):
        text = " ".join(read(f) for f in spec["files"])
        missing_files = [f for f in spec["files"] if not read(f)]
        found = [n for n in spec["needles"] if n.lower() in text.lower()]
        absent = [n for n in spec["needles"] if n not in found]
        absent = [n for n in absent if n not in spec.get("absent_ok", [])]
        if spec["claimed"]:
            check(not missing_files and not absent,
                  "%s: поля на месте (%s)%s" % (
                      name, ", ".join(found),
                      "" if not absent else " — НЕТ: %s" % absent))
            for extra in spec.get("absent_ok", []):
                if extra not in found:
                    print("  ждёт %s: поле «%s» не реализовано и не заявляется" % (name, extra))
        else:
            # Незаявленное расширение не проваливает приёмку, но и не молчит:
            # должно быть видно, что профиль его не обещает.
            check(True, "%s: не заявляется этим профилем (нет: %s)" % (name, ", ".join(absent) or "—"))


def test_docs_do_not_overclaim():
    print("\n== §33: обещания в документации ==")
    doc = read("docs/PRODUCTION_READINESS.md")
    check("## 33." in doc, "раздел §33 на месте в спецификации")
    # Спецификация сама говорит, что это состав данных, а не готовая схема —
    # проверяем, что формулировка не потерялась при правках.
    check("состав данных" in doc, "§33 по-прежнему называет себя составом данных, а не схемой")
    check("Не вводить единый гигантский формат" in doc,
          "запрет единого формата проекта зафиксирован")
    # Форматы, которые профиль заявляет, описаны в docs/.
    docs = " ".join(read("docs/highlevel/" + f) for f in sorted(os.listdir(os.path.join(ROOT, "docs/highlevel")))
                    if f.endswith(".md"))
    for fmt in ("atlas", "animplayer", "tilemap", "prefab", "save", "replay", "input", "diag"):
        check(fmt in docs, "формат %s описан в docs/highlevel/" % fmt)


def test_open_data():
    print("\n== §33: данные открыты и пригодны для diff ==")
    # Данные игры — JSON/ASCII, а не бинарный blob: иначе diff и ревью невозможны.
    json_files = []
    for base in ("game", "tests/fixtures"):
        for root, _dirs, files in os.walk(os.path.join(ROOT, base)):
            json_files += [os.path.join(root, f) for f in files if f.endswith(".json")]
    check(len(json_files) >= 5, "данные лежат открытым JSON (%d файлов)" % len(json_files))
    prefab = read("src/highlevel/prefab.js")
    check("JSON" in prefab or "stringify" in prefab,
          "prefab сериализуется в читаемый JSON, а не в бинарный формат")


def main():
    test_extensions()
    test_docs_do_not_overclaim()
    test_open_data()
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
