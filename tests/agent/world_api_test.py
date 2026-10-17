#!/usr/bin/env python3
# ===========================================================================
# Тест API мира (task-68): $.world.remove / clear / destroy.
#
# До этой правки все три имени были undefined, хотя «убрать узел/мир» —
# базовая операция перезапуска волны и уровня. Тест фиксирует контракт:
#
#   * remove(target) — обязательная цель, возвращает число исчезнувших узлов
#     (вместе с детьми удалённого родителя), промах — 0 и предупреждение;
#     без цели — структурная ошибка R2D_WORLD_REMOVE_NO_TARGET, а НЕ «удалить
#     всё»;
#   * clear(opts?) — сносит игровые узлы, но по умолчанию оставляет
#     persistent-узлы (класс и attrs), интерфейс и стены bounds(); {ui:true}
#     добавляет к удалению интерфейс; таймеры/сцены не трогает;
#   * destroy() — полный перезапуск мира: все узлы (включая persistent и UI),
#     границы, фон, гравитация к стартовой 0/2000, timeScale 1, pause off.
#
# Запуск (собранный движок):
#   python3 tests/agent/world_api_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "world_api")
ERROR = object()                 # eval не выполнился (например, метода ещё нет)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code):
    """eval, который не обрывает тест: красная проверка вместо исключения."""
    try:
        return a.eval(code)
    except Exception:            # noqa: BLE001 — на старом коде метода нет
        return ERROR


def call(a, code):
    """Выполнить оператор (результат-обёртка в JSON не сериализуется)."""
    return ev(a, "(function(){ %s; return 0; })()" % code)


def codes(a, code):
    return ev(a, "$.debug.errors(%r).map((e) => e.code)" % code)


def main():
    with Agent(game=GAME, seed=17) as a:
        # --- Исходные числа фикстуры (сняты с живого движка) ----------------
        check(ev(a, "$.world.all().length") == 15, "в мире 15 узлов (10 игровых + UI + 4 стены)")
        check(ev(a, "$.world.count()") == 10, "count() = 10 игровых узлов")
        check(ev(a, "engine.bodyCount()") == 12, "в физике 12 тел")
        check(ev(a, "$('.world-bound').length") == 4, "bounds() поставил 4 стены")
        check(ev(a, "$('#hud').length") == 1, "UI-узел #hud на месте")
        check(ev(a, "$('#child').get(0).parent_node !== null") is True, "ребёнок привязан к родителю")

        # --- Присутствие имён (на старом коде — undefined) ------------------
        check(ev(a, "typeof $.world.remove") == "function", "$.world.remove существует")
        check(ev(a, "typeof $.world.clear") == "function", "$.world.clear существует")
        check(ev(a, "typeof $.world.destroy") == "function", "$.world.destroy существует")

        # --- remove: без цели — ошибка, а не «удалить всё» ------------------
        ev(a, "$.debug.clearErrors(); 0")
        check(ev(a, "$.world.remove()") == 0, "remove() без цели вернул 0")
        check(ev(a, "$.world.all().length") == 15, "remove() без цели НЕ тронул мир")
        check(codes(a, "R2D_WORLD_REMOVE_NO_TARGET") == ["R2D_WORLD_REMOVE_NO_TARGET"],
              "remove() без цели даёт R2D_WORLD_REMOVE_NO_TARGET")
        ev(a, "$.world.remove(); 0")
        check(len(codes(a, "R2D_WORLD_REMOVE_NO_TARGET") or []) == 1,
              "повторный remove() без цели не дублирует запись")

        # --- remove: промах — 0 и одно предупреждение на цель ---------------
        ev(a, "$.debug.clearErrors(); 0")
        check(ev(a, "$.world.remove('#nope')") == 0, "remove('#nope') вернул 0")
        check(ev(a, "$.world.all().length") == 15, "промах не удалил ничего")
        ev(a, "$.world.remove('#nope'); 0")
        check(codes(a, "R2D_WORLD_REMOVE_MISS") == ["R2D_WORLD_REMOVE_MISS"],
              "промах даёт R2D_WORLD_REMOVE_MISS ровно один раз (ключ — цель)")

        # --- remove: селектор / обёртка / сырой узел ------------------------
        check(ev(a, "$.world.remove('#hero')") == 1, "remove(селектор) вернул 1")
        check(ev(a, "$.world.all().length") == 14, "узлов стало 14")
        check(ev(a, "$.world.count()") == 9, "count() = 9")
        check(ev(a, "engine.bodyCount()") == 11, "тело героя снято: 12 → 11")
        check(ev(a, "$('#hero').length") == 0, "селектор #hero больше не находит узел")

        check(ev(a, "$.world.remove($('.goblin'))") == 3, "remove(обёртка .goblin) вернул 3")
        check(ev(a, "$.world.all().length") == 11, "узлов стало 11")
        check(ev(a, "engine.bodyCount()") == 8, "тел стало 8 (снято 3)")
        check(ev(a, "$('.goblin').length") == 0, "врагов не осталось")

        check(ev(a, "$.world.remove($('#crate').get(0))") == 1, "remove(сырой узел) вернул 1")
        check(ev(a, "$.world.all().length") == 10, "узлов стало 10")
        check(ev(a, "engine.bodyCount()") == 7, "тел стало 7")

        # Родитель + ребёнок: оба исчезают, оба в счётчике.
        check(ev(a, "$.world.remove('.group')") == 2, "remove('.group') считает и ребёнка: 2")
        check(ev(a, "$.world.all().length") == 8, "узлов стало 8")
        check(ev(a, "$.world.count()") == 3, "count() = 3 (persist, persist-attr, marker)")

        # --- clear: persistent/UI/границы выживают --------------------------
        removed = ev(a, "$.world.clear()")
        check(removed == 1, "clear() удалил marker: 1")
        check(ev(a, "$.world.all().length") == 7, "осталось 7 узлов (2 persistent + UI + 4 стены)")
        check(ev(a, "$.world.count()") == 2, "count() = 2 — оба persistent живы")
        check(ev(a, "$('#persist').length") == 1, "persistent по классу выжил")
        check(ev(a, "$('#persist-attr').length") == 1, "persistent по attrs выжил")
        check(ev(a, "$('#hud').length") == 1, "UI по умолчанию выжил")
        check(ev(a, "$('.world-bound').length") == 4, "стены bounds() выжили")
        check(ev(a, "engine.bodyCount()") == 6, "тел 6: 4 стены + 2 persistent")
        check(ev(a, "$.world.clear()") == 0, "повторный clear() вернул 0")

        # --- clear({ui:true}) снимает интерфейс, persistent остаётся ---------
        check(ev(a, "$.world.clear({ui:true})") == 1, "clear({ui:true}) снял UI: 1")
        check(ev(a, "$('#hud').length") == 0, "UI удалён")
        check(ev(a, "$('#persist').length") == 1, "persistent остался и при clear({ui:true})")
        check(ev(a, "$.world.all().length") == 6, "осталось 6 узлов (2 persistent + 4 стены)")

        # --- destroy: полный перезапуск мира --------------------------------
        call(a, "$.world.gravity(123, 456).timeScale(0.5).pause()")
        check(ev(a, "$.world.gravity()") == {"x": 123, "y": 456}, "перед destroy гравитация 123/456")
        check(ev(a, "$.world.getTimeScale()") == 0.5, "перед destroy timeScale 0.5")
        check(ev(a, "$.world.isPaused()") is True, "перед destroy мир на паузе гравитации")
        check(ev(a, "$.world.getBackground() !== null") is True, "перед destroy фон задан")

        result = ev(a, "$.world.destroy()")
        summary = result if isinstance(result, dict) else {}
        check(isinstance(result, dict), "destroy() вернул сводку-объект")
        check(summary.get("nodes") == 6, "destroy() удалил 6 узлов: %s" % (result,))
        check(summary.get("persistent") == 2, "в сводке 2 persistent-узла")
        check(summary.get("bodies") == 0, "bodies в сводке = 0")
        check(ev(a, "$.world.all().length") == 0, "после destroy узлов нет")
        check(ev(a, "$.world.count()") == 0, "count() = 0")
        check(ev(a, "engine.bodyCount()") == 0, "в физике 0 тел")
        check(ev(a, "$('#persist').length") == 0, "destroy снял persistent (это перезапуск уровня)")
        check(ev(a, "$('.world-bound').length") == 0, "стены bounds() сняты")
        check(ev(a, "$.world.gravity()") == {"x": 0, "y": 2000},
              "гравитация вернулась к стартовой 0/2000")
        check(ev(a, "$.world.getTimeScale()") == 1, "timeScale = 1")
        check(ev(a, "$.world.isPaused()") is False, "pause снят")
        check(ev(a, "$.world.getBackground()") is None, "фон сброшен")

        # --- Мир живой после destroy ----------------------------------------
        check(ev(a, "$.world.spawn('rect', 10, 10, { id: 'fresh' }).length") == 1,
              "после destroy можно спавнить узлы")
        check(ev(a, "$.world.count()") == 1, "новый узел виден в count()")

    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
