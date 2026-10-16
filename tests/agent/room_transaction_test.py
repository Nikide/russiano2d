#!/usr/bin/env python3
# ===========================================================================
# §23. Tilemaps, комнаты и prefab data: транзакция, консистентность, ссылки.
#
# Фикстура tests/fixtures/room_tx: две комнаты (alpha/beta), описанные данными
# (bounds, карта, инстансы prefab, маркеры, exits), HUD и глобальная заметка
# созданы ВНЕ комнаты.
#
# Приёмка (числами):
#   * неудачная загрузка комнаты не меняет текущий мир (узлы/тела/подписки);
#   * загрузка/перезагрузка комнаты обновляет визуал, коллизию И occluders;
#   * правка одной клетки пересобирает только её (dirty_cells/rebuilt/reused);
#   * ссылка на отсутствующий маркер или комнату — структурированная ошибка,
#     а не молчаливый переход; мир при этом не меняется;
#   * смена комнаты не трогает HUD/глобальные узлы и не копит объекты;
#   * сохранение хранит ID комнаты (scene) и её изменения; после восстановления
#     мира комната возвращается по своему узлу карты (`$.room.adopt()`).
#
# Запуск:
#   python3 tools/run_tests.py room_transaction_test
#   R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py room_transaction_test
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=os.path.join("tests", "fixtures", "room_tx"), seed=5) as a:
        a.step(3)
        check(a.eval("typeof $.room") == "object", "§23 $.room доступен игре")
        check(a.eval("$.room.list().sort().join(',')") == "alpha,beta",
              f"§23 комнаты зарегистрированы из данных: {a.eval('$.room.list()')}")

        # --- загрузка комнаты -------------------------------------------------
        res = a.eval("(r => ({ ok: r.ok, id: r.id, code: r.code, errs: r.errors }))($.room.enter('alpha'))")
        a.step(2)
        check(res["ok"] is True and res["id"] == "alpha", f"§23 комната alpha загружена: {res}")
        check(a.eval("$.scene.current()") == "room:alpha",
              f"§23 комната — та же сцена: {a.eval('$.scene.current()')} (это же поле хранит §14)")
        check(a.eval("$.fixture.mapCell(0, 0)") == 1 and a.eval("$.fixture.cellBody(0, 0)") >= 1,
              f"§23 карта alpha: клетка (0,0) твёрдая "
              f"(cell={a.eval('$.fixture.mapCell(0,0)')}, тел={a.eval('$.fixture.cellBody(0,0)')})")
        occl_a = a.eval("$.fixture.occluders()")
        occl_hash_a = a.eval("$.fixture.occluderHash()")
        check(occl_a > 0, f"§23 occluders карты заполнены: {occl_a} отрезков")

        # --- prefab data: стабильные ID инстансов и детей ----------------------
        check(a.eval("$('#torch_a').toArray().length") == 1, "§23 инстанс prefab создан по id из данных")
        check(a.eval("$('#torch_a/flame').toArray().length") == 1,
              "§23 ребёнок инстанса получил стабильный id «инстанс/путь»")
        check(a.eval("$('#torch_a/flame').toArray()[0].color") == a.eval("$.fixture.pack('#ff0000')"),
              "§23 override ребёнка по пути применён (flame перекрашен в #ff0000)")
        check(a.eval("$('#marker_exit_east').toArray().length") == 1,
              "§23 маркер-узел создан (markers.exit_east.node = true)")
        check(a.eval("$.room.marker('spawn')")["ok"] is True
              and a.eval("$.room.marker('spawn')")["x"] == 64,
              f"§23 маркер читается из данных: {a.eval('$.room.marker(' + chr(39) + 'spawn' + chr(39) + ')')}")
        check(a.eval("$('#hud').toArray().length") == 1 and a.eval("$('#global_note').toArray().length") == 1,
              "§23 HUD и глобальный узел живут вне комнаты")

        # --- правка одной клетки: инкрементально ------------------------------
        res = a.eval("(() => {"
                     "  const before = $.fixture.mapResult();"
                     "  $('#map_alpha').setTile(0, 0, 0);"
                     "  $('#map_alpha').rebuild();"
                     "  const r = $.fixture.mapResult();"
                     "  return { before_reused: before.reused, dirty: r.dirty_cells,"
                     "           planned: r.planned, created: r.created, reused: r.reused,"
                     "           destroyed: r.destroyed, rebuilt: r.rebuilt };"
                     "})()")
        check(res["dirty"] == 1, f"§23 одна изменённая клетка: dirty_cells = {res['dirty']}")
        check(res["reused"] >= 1 and res["rebuilt"] <= 3,
              f"§23 пересобраны только затронутые тела: переиспользовано {res['reused']}, "
              f"пересобрано {res['rebuilt']} из {res['planned']} (создано {res['created']}, снято {res['destroyed']})")
        check(a.eval("$.fixture.mapCell(0, 0)") == 0 and a.eval("$.fixture.cellBody(0, 0)") == 0,
              "§23 правка клетки убрала и картинку, и коллизию")
        occl_hash_after = a.eval("$.fixture.occluderHash()")
        check(occl_hash_after != occl_hash_a,
              f"§23 occluders пересчитаны вместе с клеткой: геометрия "
              f"{occl_hash_a} → {occl_hash_after} ({a.eval('$.fixture.occluders()')} отрезков)")

        # --- перезагрузка комнаты в новые данные ------------------------------
        before_nodes = a.eval("$.debug.counters().nodes")
        a.eval("$.fixture.defineAlpha({ tilemap: $.fixture.mapSpec($.fixture.cellsAlpha, 'alpha') })")
        res = a.eval("(r => ({ ok: r.ok, id: r.id }))($.room.enter('alpha'))")
        a.step(2)
        check(res["ok"] is True and a.eval("$.fixture.mapCell(0, 0)") == 1,
              "§23 перезагрузка комнаты вернула прежние данные карты")
        check(a.eval("$.fixture.cellBody(0, 0)") >= 1 and a.eval("$.fixture.occluderHash()") == occl_hash_a,
              f"§23 после перезагрузки снова согласованы визуал, коллизия и occluders "
              f"(тел {a.eval('$.fixture.cellBody(0,0)')}, occluders {a.eval('$.fixture.occluders()')})")
        check(a.eval("$('#torch_a').toArray().length") == 1,
              "§23 инстанс пересоздан с тем же логическим id (не размножился)")
        check(a.eval("$.debug.counters().nodes") == before_nodes,
              f"§23 перезагрузка комнаты не копит узлы: {before_nodes} → {a.eval('$.debug.counters().nodes')}")

        # --- ссылка на отсутствующий маркер/комнату ---------------------------
        base = a.eval("$.fixture.counters()")
        bad = a.eval("(r => ({ ok: r.ok, code: r.code, errors: r.errors.map(e => e.code) }))($.room.marker('нет-такого'))")
        check(bad["ok"] is False and "room_missing_marker" in bad["errors"],
              f"§23 отсутствующий маркер — структурированная ошибка: {bad['code']}")
        bad_define = a.eval("$.room.define('broken', { schema: 1, id: 'broken', "
                            "exits: [{ id: 'x', marker: 'нет' }] })")
        check(bad_define is None, "§23 define с ссылкой на отсутствующий маркер отклонён")
        check(any(e.get("code") == "R2D_ROOM_MISSING_MARKER"
                  for e in a.eval("$.debug.errors()")),
              "§23 ошибка попала в $.debug.errors() с кодом R2D_ROOM_*")
        # убираем соседнюю комнату — переход обязан отказать, мир не меняется
        a.eval("$.room.remove('beta')")
        gone = a.eval("(r => ({ ok: r.ok, code: r.code, errors: r.errors.map(e => e.code) }))($.room.goto('east'))")
        a.step(2)
        check(gone["ok"] is False and "room_missing_room" in gone["errors"],
              f"§23 переход в незарегистрированную комнату — ошибка: {gone['code']}")
        check(a.eval("$.fixture.counters()") == base,
              f"§23 неудачная загрузка не изменила мир: {base} → {a.eval('$.fixture.counters()')}")
        check(a.eval("$.room.current().id") == "alpha",
              f"§23 текущая комната не сменилась: {a.eval('$.room.current().id')}")
        check(a.eval("$.scene.current()") == "room:alpha", "§23 сцена тоже осталась прежней")
        # возвращаем beta и проверяем успешный переход
        a.eval("$.fixture.defineBeta()")
        res = a.eval("(r => ({ ok: r.ok, id: r.id }))($.room.goto('east'))")
        a.step(3)
        check(res["ok"] is True and a.eval("$.room.current().id") == "beta",
              "§23 переход по выходу в зарегистрированную комнату прошёл")
        check(a.eval("$.fixture.mapCell(1, 1)") == 1,
              f"§23 у beta своя карта: клетка (1,1) = {a.eval('$.fixture.mapCell(1, 1)')}")
        check(a.eval("$('#map_alpha').toArray().length") == 0 and a.eval("$('#torch_a').toArray().length") == 0,
              "§23 узлы прежней комнаты закрыты вместе с её областью")
        check(a.eval("$('#hud').toArray().length") == 1, "§23 HUD пережил смену комнаты")

        # --- серия смен не копит объекты --------------------------------------
        first = a.eval("$.fixture.counters()")
        for _ in range(5):
            a.eval("$.room.enter('alpha')")
            a.step(2)
            a.eval("$.room.enter('beta')")
            a.step(2)
        after = a.eval("$.fixture.counters()")
        check(first == after, f"§23 10 смен комнаты: счётчики не выросли — {first} → {after}")
        check(a.eval("$.room.stats().generation") >= 12,
              f"§23 generation растёт на каждый переход: {a.eval('$.room.stats().generation')}")

        # --- сохранение хранит ID комнаты и её изменения -----------------------
        a.eval("$.room.enter('beta')")
        a.step(2)
        a.eval("$('#map_beta').setTile(0, 0, 0)")
        a.step(1)                          # правка попадает и в данные узла (§23)
        saved_ok = a.eval("$.save.save('room_slot')")
        check(saved_ok is True, "§23 снимок с комнатой записан")
        slot = a.eval("$.save.snapshot()")
        check(slot.get("scene") == "room:beta",
              f"§23 снимок хранит ID комнаты: scene = {slot.get('scene')}")
        check(a.eval("$.fixture.mapCell(0, 0)") == 0
              and a.eval("$('#map_beta').attr('data')[0]") == 0,
              "§23 изменение клетки видно и в данных узла (иначе снимок хранил бы прежнюю карту)")
        # уходим в другую комнату и восстанавливаем снимок
        a.eval("$.room.enter('alpha')")
        a.step(2)
        check(a.eval("$.fixture.mapCell(0, 0)") == 1, "§23 в alpha своя карта")
        loaded = a.eval("$.save.load('room_slot')")
        a.step(3)
        check(loaded is True, f"§23 снимок восстановлен: {loaded}")
        check(a.eval("$('#map_beta').toArray().length") == 1,
              "§23 после восстановления в мире карта beta (данные узла из снимка)")
        check(a.eval("$.fixture.mapCell(0, 0)") == 0,
              f"§23 изменение клетки пережило save/restore: (0,0) = {a.eval('$.fixture.mapCell(0, 0)')}")
        adopted = a.eval("(r => ({ ok: r.ok, id: r.id }))($.room.adopt())")
        check(adopted["ok"] is True and adopted["id"] == "beta",
              f"§23 комната возвращена по своему узлу карты: {adopted}")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
