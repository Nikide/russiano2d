#!/usr/bin/env python3
# ===========================================================================
# Тест prefab-системы $.prefab через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/prefab и проверяет регистрацию, наследование
# (extend/overrides/add), инстанцирование пачкой, клонирование, сохранение в
# $.store, восстановление сцены целиком и методы узла toData/clone/prefab.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_prefab_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "prefab")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=13) as a:
        # --- Реестр -----------------------------------------------------------
        check(a.eval("$.prefab.has('hero')") is True, "prefab 'hero' зарегистрирован")
        check(a.eval("$.prefab.has('hero-fast')") is True, "prefab 'hero-fast' зарегистрирован")
        check(a.eval("$.prefab.list().length") == 2, "$.prefab.list показывает оба prefab")
        check(a.eval("$.prefab.get('нет-такого')") is None, "неизвестный prefab — null")
        check(a.eval("$.prefab.get('hero').data.score") == 5, "данные prefab читаются")

        # --- Сериализация: описание, а не числовые id -------------------------
        data = a.eval("$.prefab.get('hero')")
        check(data.get("tag") == "player", "тег сохранён")
        check(data.get("body") == "dynamic", "тело сохранено описанием (строка)")
        check(isinstance(data.get("children"), list) and len(data["children"]) == 1,
              "поддерево сохранено")
        check(data.get("data", {}).get("score") == 5, "data_store сохранён")
        check(data.get("class") == "prototype", "классы сохранены")
        check(a.eval("typeof $.prefab.get('hero').attrs.script") == "undefined",
              "функции в данные не попадают")

        # --- Наследование extend + overrides + add ---------------------------
        child = a.eval("$.prefab.get('hero-fast')")
        check(child.get("w") == 40 and child.get("h") == 60, "overrides size=[40,60] применён")
        check(child.get("hp") == 50, "overrides hp=50 применён")
        check(child.get("attrs", {}).get("speed") == 400, "overrides speed ушёл в attrs")
        check(len(child.get("children", [])) == 2, "add добавил ребёнка к унаследованным")
        check(child["children"][1].get("class") == "cape", "добавленный ребёнок — cape")

        # --- Инстанцирование --------------------------------------------------
        check(a.eval("$('#hero1').length") == 1, "prefab инстанцирован с заданным id")
        check(a.eval("$('#hero1').hp()") == 100, "свойства узла восстановлены")
        check(a.eval("$('#hero1').children().length") == 1, "иерархия восстановлена")
        check(a.eval("$('#hero1').children().first().hasClass('hat')") is True,
              "ребёнок сохранил класс")

        check(a.eval("$.store.get('crowdCount')") == 3, "count=3 вернул обёртку из трёх копий")
        check(a.eval("$('.crowd').length") == 3, "три копии видны селектору")
        check(a.eval("$('.crowd').first().hp()") == 50, "копия унаследовала hp")
        check(a.eval("$('.crowd').first().children().length") == 2, "копия получила add-ребёнка")
        check(a.eval("$('.crowd').first().get(0).body >= 0") is True, "у копии есть тело Box2D")
        check(a.eval("$('.crowd').first().toData().body") == "dynamic",
              "тело копии описано строкой, а не id")

        # --- Защита от дубликатов id ------------------------------------------
        check(a.eval("$.store.get('twinId')") == "hero12", "занятый id получил суффикс")
        check(a.eval("$('#hero1').length") == 1, "оригинал '#hero1' не сломан")
        check(a.eval("$('#hero12').length") == 1, "вторая копия доступна по новому id")

        # --- Клонирование -----------------------------------------------------
        check(a.eval("$.store.get('cloneChildren')") == 1, "клон сохранил иерархию")
        check(a.eval("$.store.get('cloneId')") != "hero1", "клон не дублирует id")
        check(a.eval("$.store.get('heroPrefabName')") == "hero",
              "узел помнит имя prefab, из которого создан")
        check(a.eval("$.store.get('crowdPrefabName')") == "hero-fast",
              "копии помнят унаследованный prefab")

        eval_clone = a.eval("$('#hero1').clone().length")
        check(eval_clone == 1, "метод узла .clone() возвращает копию")
        check(a.eval("$('#hero1').toData().tag") == "player", "метод узла .toData() работает")
        check(a.eval("$('#hero1').toData().body") == "dynamic", "тело в .toData() — описание")

        # --- Файлы через $.store ---------------------------------------------
        check(a.eval("$.store.has('prefab:hero-saved')") is True, "saveTo положил prefab в $.store")
        check(a.eval("$.fs.exists('build/test_prefab_save.json')") is True,
              "saveTo записал prefab на диск")
        check(a.eval("$('#hero-restored').length") == 1, "loadFrom инстанцировал сохранённый prefab")
        check(a.eval("$('#hero-restored').hp()") == 100, "свойства из файла восстановлены")
        check(abs(a.eval("$('#hero-restored').pos().x") - 800) < 0.01, "loadFrom применил opts.x")

        # --- JSON round-trip --------------------------------------------------
        check(a.eval("typeof $.prefab.toJSON($.prefab.get('hero'))") == "string",
              "toJSON возвращает строку")
        check(a.eval("JSON.stringify($.prefab.fromJSON($.prefab.toJSON($.prefab.get('hero'))))"
                     " === JSON.stringify($.prefab.get('hero'))") is True,
              "fromJSON(toJSON(x)) равен x")

        # --- Сцена целиком ----------------------------------------------------
        check(a.eval("$.store.has('scene:level')") is True, "saveScene сохранила сцену")
        # Фикстура уже один раз восстановила сцену — до того, как тест
        # добавил свои узлы (толпа, клоны, hero-restored). Чтобы проверить
        # восстановление, добавляем мусор и загружаем сцену здесь же.
        a.eval("(() => { $('<rect>', { class: 'junk2' }).at(0, 0).appendTo($.world); })()")
        junk_before = a.eval("$('.junk2').length")
        a.eval("(() => { $.prefab.loadScene('level', { clear: true }); })()")
        check(junk_before == 1, "мусорный узел добавлен перед восстановлением")
        check(a.eval("$.world.count()") == a.eval("$.store.get('beforeScene')"),
              "loadScene с clear восстановил прежнее число узлов")
        check(a.eval("$('.junk').length") == 0, "loadScene с clear убрал лишний узел")
        check(a.eval("$('.junk2').length") == 0, "loadScene с clear убрал и новый мусор")
        check(a.eval("$('#hero1').length") == 1, "после восстановления сцены '#hero1' на месте")
        check(a.eval("$('#hero1').toData().body") == "dynamic",
              "после восстановления сцены тело пересоздано")

        # --- Ошибки не роняют кадр -------------------------------------------
        a.eval("$.prefab.instantiate('нет-такого', { x: 0, y: 0 })")
        a.eval("$.prefab.loadFrom('тоже-нет')")
        a.step(2)
        check(a.ping().get("pong") is True, "неизвестный prefab не останавливает движок")

        a.eval("$.prefab.clear()")
        check(a.eval("$.prefab.list().length") == 0, "$.prefab.clear очищает реестр")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
