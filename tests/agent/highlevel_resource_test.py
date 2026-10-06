#!/usr/bin/env python3
# ===========================================================================
# Тест реестра ресурсов $.resource через агентский интерфейс.
#
# Проверяет то, что не зависит от GPU (ассетов-картинок в фикстуре нет):
# ленивую загрузку, кэш по имени, счётчик ссылок и выгрузку, json/text через
# $.fs, preload/list/stats/remove/clear и понятные тексты ошибок.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_resource_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "resource")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def probe(a, key):
    """Наблюдение, записанное фикстурой в $.store."""
    return a.eval("$.store.get('%s')" % key)


def main():
    with Agent(game=GAME, seed=5) as a:
        a.step(2)

        # --- Данные из кода: value и ленивый build() ---------------------------
        check(probe(a, "value") == 640, "ресурс-значение вернул данные из value")
        check(probe(a, "builtBeforeGet") == 0, "define() не вызывает build()")
        check(probe(a, "builtAfterGet") == 1 and probe(a, "waveSize") == 3,
              "get() собрал значение через build()")
        check(probe(a, "builtAfterSecondGet") == 1, "повторный get() берёт значение из кэша")

        # --- json и text через $.fs -------------------------------------------
        check(probe(a, "jsonSpeed") == 42, "json-ресурс разобран в объект")
        check(probe(a, "configKind") == "json", "вид ресурса сохранён")
        check(probe(a, "configState") == "ready", "после загрузки состояние ready")
        check(probe(a, "text") == "привет", "text-ресурс вернул строку")
        check(probe(a, "missingValue") == "запас", "get() вернул fallback для пропавшего файла")
        check(probe(a, "missingState") == "failed", "неудачная загрузка помечена failed")
        check("не найден" in (probe(a, "missingError") or ""),
              "в ошибке сказано, что файла нет: " + str(probe(a, "missingError")))

        # --- Счётчик ссылок ----------------------------------------------------
        check(probe(a, "refsAfterSecondLoad") == 2, "повторный load() добавил ссылку")
        check(probe(a, "freedOne") == 1, "free() уменьшил счётчик ссылок")
        check(probe(a, "freedTwo") == 0 and probe(a, "stateAfterFree") == "defined",
              "на нуле ссылок ресурс выгружен")
        check(probe(a, "speedAfterFree") == 42, "get() после выгрузки загрузил ресурс снова")
        check(probe(a, "stateAfterGet") == "ready", "и вернул состояние ready")
        check(probe(a, "refsWithoutGet") == 0, "get() не держит ссылку")

        # --- preload, list, stats, remove, clear --------------------------------
        preload = probe(a, "preload")
        check(isinstance(preload, list) and preload[0] >= 3, "preload() загрузил описанные ресурсы")
        check(probe(a, "statsReady") >= 3, "stats() видит готовые ресурсы")
        check(probe(a, "statsRefs") == 0, "preload() не держит ссылок")
        check(probe(a, "kinds").get("json") == 2, "stats() считает ресурсы по видам")
        check(sorted(probe(a, "names")) == ["config", "missing", "notes", "tuning", "wave"],
              "names() перечисляет все ресурсы")
        check(probe(a, "hasTuning") is True and probe(a, "removed") is True
              and probe(a, "stillHasTuning") is False, "remove() забывает ресурс")
        check(probe(a, "listLength") == 4, "list() вернул оставшиеся ресурсы")
        check(probe(a, "cleared") == 4 and probe(a, "totalAfterClear") == 0,
              "clear() очистил реестр")

        # --- Живые проверки: реестр работает в текущем кадре --------------------
        check(a.eval("$.resource.load('live', { kind: 'data', value: 7 })") == 7,
              "load() возвращает значение")
        check(a.eval("$.resource.get('live')") == 7, "get() видит загруженное")
        check(a.eval("$.resource.free('live')") == 0, "free() вернул ноль ссылок")
        check(a.eval("$.resource.load('live2', 'build/test_resource/data.json')").get("speed") == 42,
              "json-ресурс читается по пути из расширения .json")
        check(a.eval("$.resource.get('нет-такого', 'запас')") == "запас",
              "неизвестный ресурс отдаёт fallback")
        check(a.eval("$.resource.stats().total") == 2,
              "в реестре два созданных ресурса (free описание не убирает)")
        check(a.eval("$.resource.clear()") == 2, "clear() убрал оба")

        a.step(2)
        check(a.ping().get("pong") is True, "ошибки ресурсов не остановили движок")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
