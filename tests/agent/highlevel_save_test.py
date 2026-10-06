#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы сохранений $.save через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/save и проверяет: запись/чтение слотов,
# метаданные для меню сохранений, восстановление мира (позиции, дети, hp,
# скорости тел), снимки по частям, строки export/import, миграцию старого
# формата, битые и «слишком новые» файлы, автосейв и counters.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_save_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "save")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def probe(a, key):
    """Наблюдение, записанное фикстурой в $.store (см. tests/fixtures/save/main.js)."""
    return a.eval("$.store.get('%s')" % key)


def main():
    with Agent(game=GAME, seed=11) as a:
        # Кадры нужны автосейву: он пишет по игровому времени.
        a.step(20)

        # --- Запись слота и метаданные ---------------------------------------
        check(a.eval("$.save.version()") == 2, "$.save.version() возвращает 2")
        check(probe(a, "saveOk") is True, "save() записал слот 1")
        check(probe(a, "slotExists") is True, "exists(1) видит слот")
        check(probe(a, "slotPath") == "build/test_saves/slot-1.json",
              "path(1) — путь в каталоге $.save.dir()")
        check(a.eval("$.fs.exists('build/test_saves/slot-1.json')") is True,
              "файл слота лежит на диске")
        check(a.eval("$.save.exists(9)") is False, "несуществующий слот — false")
        check(a.eval("$.save.remove(9)") is False, "удаление несуществующего слота — false")
        check(a.eval("$.save.info(9)") is None, "info несуществующего слота — null")

        info = a.eval("$.save.info(1)")
        check(isinstance(info, dict) and info.get("slot") == "1", "info(1) отдаёт метаданные слота")
        check(info.get("ok") is True and info.get("legacy") is False, "слот 1 — текущий формат")
        check(info.get("version") == 2 and info.get("current") == 2, "версия слота и текущая совпадают")
        check(info.get("size", 0) > 0, "размер слота известен")
        check(info.get("store_keys") == 2, "в слоте два ключа данных $.store")
        check(info.get("world_nodes") == 3, "в слоте три узла: герой, шляпа, пуля")
        check(info.get("has_world") is True and info.get("has_speeds") is True,
              "мир и скорости помечены в метаданных")
        check(probe(a, "slotScene") is None, "в фикстуре нет сцен — поле scene пустое")

        # --- Файл слота как JSON ----------------------------------------------
        payload = json.loads(a.eval("$.fs.readText('build/test_saves/slot-1.json')"))
        check(payload.get("format") == "r2d.save", "в файле наш формат")
        check(payload.get("version") == 2, "в файле текущая версия")
        check(payload.get("store") == {"score": 500, "kills": 2}, "данные $.store в файле")
        check(len(payload.get("world", [])) == 2, "в мире два корневых узла")
        check(len(payload.get("speeds", [])) == 3, "скорости — вектор на каждый узел")
        check(abs(payload["speeds"][2][0] - 120) < 0.01, "скорость пули сохранена в speeds")

        # --- Восстановление мира из слота -------------------------------------
        check(probe(a, "loadOk") is True, "load(1) вернул true")
        check(probe(a, "scoreAfterLoad") == 500, "данные $.store восстановлены целиком")
        check(probe(a, "junkAfterLoad") is False,
              "ключ, появившийся после сохранения, убран (слот — снимок целиком)")
        check(abs(probe(a, "heroX") - 100) < 0.01, "позиция героя восстановлена")
        check(probe(a, "heroHp") == 100, "здоровье узла восстановлено")
        check(probe(a, "hatCount") == 1, "ребёнок героя восстановлен")
        check(probe(a, "ballCount") == 1, "пуля восстановлена по id")
        check(probe(a, "worldCount") == probe(a, "worldCountBeforeSave"),
              "узлов в мире столько же, сколько было до сохранения")
        check(probe(a, "heroCountAfter") == 1 and probe(a, "junkAfterClear") == 0,
              "узел, появившийся после сохранения, убран (clear по умолчанию)")
        check(abs(probe(a, "ballVx") - 120) < 0.5 and abs(probe(a, "ballVy") + 30) < 0.5,
              "скорость пули применилась к новому телу")
        check(probe(a, "kills") == 2, "счётчик пережил сохранение")

        # --- Строки: export/import --------------------------------------------
        check(probe(a, "exportIsString") is True, "export() вернул строку")
        check(probe(a, "exportFormat") == "r2d.save", "в строке наш формат")
        check(probe(a, "exportVersion") == 2, "версия в строке — 2")
        check(probe(a, "exportRoots") == 2 and probe(a, "exportSpeeds") == 3,
              "в строке есть и мир, и скорости")
        check(probe(a, "importOk") is True, "import() применил строку")
        check(abs(probe(a, "heroXAfterImport") - 100) < 0.01, "import вернул героя на место")
        check(probe(a, "scoreAfterImport") == 500, "import вернул данные $.store")
        check(probe(a, "importBroken") is False, "битая строка — false, без исключения")
        check("битый JSON" in (probe(a, "importError") or ""), "причина битой строки в last_error")
        check(probe(a, "importFuture") is False, "сохранение «из будущего» не применяется")

        # --- Частичные слоты ---------------------------------------------------
        check(probe(a, "saveNoWorld") is True, "слот 2 сохранён без мира")
        check(probe(a, "slot2HasWorld") is False, "в слоте 2 мира нет")
        check(probe(a, "slot2Keys") == 2, "но данные $.store в нём есть")
        check(probe(a, "saveNoStore") is True and probe(a, "slot3Keys") == 0,
              "слот 3 сохранён без данных $.store")
        check(probe(a, "slot3Nodes") == 3, "в слоте 3 только мир")

        # --- Миграция и битые файлы -------------------------------------------
        check(probe(a, "legacyKey") == "ок", "старая запись $.store версии 1 прочитана")
        check(probe(a, "legacyFrom") == 1, "миграция помечена migrated_from = 1")
        check(probe(a, "legacyInfo") is True and probe(a, "legacyVersion") == 1,
              "info видит в слоте старую версию")
        check(probe(a, "brokenRead") is None, "битый слот не читается")
        check("битый JSON" in (probe(a, "brokenError") or ""),
              "причина битого слота в last_error")
        check(probe(a, "futureRead") is None and probe(a, "futureInfo") is None,
              "слот из будущего не читается и не описывается")
        check(probe(a, "missingLoad") is False and probe(a, "missingRemove") is False
              and probe(a, "missingInfo") is None, "отсутствующий слот: false / false / null")

        # --- Список слотов -----------------------------------------------------
        slots = probe(a, "slots")
        check(sorted(slots) == ["1", "2", "3", "broken", "future", "legacy"],
              "list() перечисляет все слоты каталога: " + ",".join(sorted(slots)))
        check(probe(a, "slotsCheap") == len(slots), "list({meta:false}) того же размера")
        entries = {s["slot"]: s for s in a.eval("$.save.list()")}
        check(entries["legacy"].get("legacy") is True, "старый слот помечен legacy")
        check(entries["broken"].get("ok") is False and entries["future"].get("ok") is False,
              "нечитаемые слоты видны, но помечены ok = false")
        check(entries["1"].get("ok") is True and entries["1"].get("has_world") is True,
              "слот 1 читается и содержит мир")

        # --- Автосейв -----------------------------------------------------------
        check(probe(a, "autosaveId") not in (None, 0), "autosave() вернул id таймера")
        check(probe(a, "autosaveMs") == 100, "период автосейва запомнен")
        check(probe(a, "slotBeforeAutosave") == "1", "перед автосейвом текущий слот — 1")
        check(a.eval("$.save.exists('auto')") is True, "автосейв записал служебный слот")
        check(a.eval("$.save.slot()") == "1", "автосейв не переключил текущий слот")
        check("auto" in {s["slot"] for s in a.eval("$.save.list()")},
              "слот автосейва виден в списке")
        a.eval("$.save.stopAutosave()")
        check(a.eval("$.save.stats().autosave_ms") == 0, "stopAutosave() выключил таймер")

        # --- Загрузка по частям в рантайме -------------------------------------
        world_now = a.eval("$.world.count()")
        a.eval("$.save.load(2)")
        check(a.eval("$.store.get('score')") == 500, "слот 2 применил данные $.store")
        check(a.eval("$.world.count()") == world_now, "и не тронул мир (в слоте его нет)")
        a.eval("$.save.load(3)")
        check(a.eval("$.store.get('score')") is None, "слот 3 (store: false) очистил данные")
        check(a.eval("$.world.count()") == world_now, "зато восстановил мир")
        check(a.eval("$('#hero').length") == 1 and a.eval("$('#hat').length") == 1,
              "герой и его ребёнок на месте после загрузки слота 3")

        stats = a.eval("$.save.stats()")
        check(stats.get("saves", 0) >= 3 and stats.get("loads", 0) >= 3,
              "stats() считает записи и загрузки")

        # --- Ошибки не роняют кадр ---------------------------------------------
        a.eval("$.save.load(99)")
        a.eval("$.save.import('{ сломано')")
        a.step(3)
        check(a.ping().get("pong") is True, "пустой слот и битая строка не остановили движок")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
