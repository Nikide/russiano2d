#!/usr/bin/env python3
# ===========================================================================
# §27. Хот-релоад ассетов + отложенный перезапуск скриптов.
#
# Часть 1 — три РАЗНЫЕ операции: reload данных (ассеты), reload поведения
# ($.script.request — перезапуск рантайма на границе кадра) и restart сцены.
#
# Часть 2 — приёмка §27 по четырём сценариям (фикстура tests/fixtures/reload,
# ассеты пишет сам тест, чтобы менять их «на ходу»):
#   * текстура: замена на месте (тот же handle), кадр меняется, handle не течёт;
#   * атлас: та же раскладка — ни одного нового спрайта; изменённая раскладка —
#     кадры перепривязываются ПО ИМЕНИ, старая ссылка на атлас продолжает
#     работать; кадр, пропавший из новой раскладки и используемый в мире, —
#     перезагрузка ОТКЛОНЯЕТСЯ (last-known-good);
#   * данные карты: визуал и коллизия едут согласованно;
#   * документ RmlUi: текст и стиль (rcss) применяются; битый .rml отклоняется,
#     живой документ остаётся рабочим;
#   * битый JSON не завершает игру;
#   * серия reload не растёт по узлам/телам/подпискам/ресурсам/текстурам;
#   * старый texture handle освобождается на СЛЕДУЮЩЕМ кадре, не в кадре замены.
#
# Запуск после сборки:
#   python3 tools/run_tests.py highlevel_reload_test
# ===========================================================================

import hashlib
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []

#: Разметка RmlUi со ВСТРОЕННЫМ стилем: правка стиля приезжает вместе с .rml
#: (внешние .rcss RmlUi кэширует по URL — это отдельная проверка ниже).
HUD_RML = ("<rml><head><style>#hud-line { display: block; width: %dpx; height: 20px;"
           " color: #ffffff; }</style></head><body><div id=\"hud-line\">%s</div></body></rml>")
#: Документ со ВНЕШНИМ стилем (кэш RmlUi).
HUD_EXT_RML = ("<rml><head><link type=\"text/css\" href=\"hud_ext.rcss\"/></head>"
               "<body><div id=\"hud-line\">ext</div></body></rml>")
HUD_EXT_RCSS = "#hud-line { display: block; width: %dpx; height: 20px; color: #ffffff; }\n"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, path):
    a.cmd("screenshot", path=path)
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def write_png(path, w, h, rgb, alpha=255):
    """Минимальный PNG (RGBA8) без внешних зависимостей: тесту нужны свои ассеты."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    row = bytes([0]) + bytes([rgb[0], rgb[1], rgb[2], alpha]) * w
    raw = row * h

    def chunk(tag, data):
        body = tag + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xffffffff))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def write_atlas(path, layout):
    """Атлас в простом формате модуля: layout — имя кадра → (x, y), кадры 8×8."""
    items = []
    for name, (x, y) in layout.items():
        items.append('"%s": {"x": %d, "y": %d, "w": 8, "h": 8}' % (name, x, y))
    text = '{"frames": {' + ", ".join(items) + '}, "meta": {"image": "atlas.png"}}'
    write_text(path, text)


def main():
    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        check(a.eval("typeof $.script") == "object", "$.script доступна игре")
        check(a.eval("$.script.pending()") is False, "до запроса перезапуска нет")

        before = a.eval("$.script.count()")
        check(a.eval("$.script.request('тест')") is True, "запрос принят")
        check(a.eval("$.script.pending()") is True, "запрос ждёт границы кадра")

        # Кадр доигрывается: вызовы в том же кадре работают, рантайм ещё жив.
        check(a.eval("1 + 1") == 2, "в том же кадре рантайм отвечает")

        a.step(2)
        check(a.eval("$.script.pending()") is False, "после кадра запрос снят")
        check(a.eval("$.script.count()") > before, "рантайм перезапустился")
        check(a.eval("typeof $") == "function", "игра загрузилась заново")

        hot = a.eval("$.script.hotReload()")
        check(hot in (True, False), "состояние слежения читается")

    # ---------------------------------------------------------------------
    # Часть 2: §27 — хот-релоад ассетов
    # ---------------------------------------------------------------------
    fixture = os.path.join("tests", "fixtures", "reload")
    assets = os.path.join(fixture, "assets")
    ui_dir = os.path.join(fixture, "ui")

    write_png(os.path.join(assets, "hot.png"), 8, 8, (220, 40, 40))
    write_png(os.path.join(assets, "extra.png"), 8, 8, (40, 220, 40))
    write_png(os.path.join(assets, "atlas.png"), 16, 8, (200, 200, 200))
    write_atlas(os.path.join(assets, "atlas.json"), {"idle_0": (0, 0), "run_0": (8, 0)})
    write_text(os.path.join(assets, "map.json"),
               '{"cols":4,"rows":4,"solid":true,"data":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]}')
    write_text(os.path.join(assets, "params.json"), '{"speed": 10, "label": "v1"}')
    write_text(os.path.join(ui_dir, "hud.rml"), HUD_RML % (120, "v1"))
    write_text(os.path.join(ui_dir, "hud_ext.rml"), HUD_EXT_RML)
    write_text(os.path.join(ui_dir, "hud_ext.rcss"), HUD_EXT_RCSS % 90)

    with Agent(game=fixture, seed=5) as a:
        a.step(3)
        check(a.eval("typeof $.reload") == "object", "§27 $.reload доступен игре")
        check(a.eval("$.reload.kinds().length") == 5,
              f"§27 пять встроенных видов ассетов: {a.eval('$.reload.kinds()')}")
        check(a.eval("$.reload.list().length") == 7,
              f"§27 семь ассетов под наблюдением: {[x['name'] for x in a.eval('$.reload.list()')]}")

        # --- сценарий 1: текстура --------------------------------------------
        tex_before = a.eval("$.fixture.tex_id()")
        sprites_before = a.eval("$.fixture.counters()")
        shot_red = shot(a, "/tmp/reload_red.png")
        write_png(os.path.join(assets, "hot.png"), 8, 8, (40, 40, 220))
        res = a.eval("$.reload.reload('tex')")
        a.step(2)
        shot_blue = shot(a, "/tmp/reload_blue.png")
        check(res["ok"] is True and res["changed"] is True and res["version"] == 1,
              f"§27 текстура перезагружена (version 0 → {res.get('version')})")
        check(a.eval("$.fixture.tex_id()") == tex_before,
              f"§27 handle текстуры НЕ изменился ({tex_before} → {a.eval('$.fixture.tex_id()')})")
        check(shot_red != shot_blue, "§27 новые пиксели реально попали в кадр")
        after_tex = a.eval("$.fixture.counters()")
        check(after_tex["textures"] == sprites_before["textures"]
              and after_tex["sprites"] == sprites_before["sprites"],
              f"§27 замена на месте не создала handle'ов: текстуры "
              f"{sprites_before['textures']}→{after_tex['textures']}, спрайты "
              f"{sprites_before['sprites']}→{after_tex['sprites']}")
        check(a.eval("$.resource.info('hot').version") == 2,
              f"§27 версия ресурса в $.resource растёт вместе с заменой "
              f"({a.eval(chr(36) + '.resource.info(' + chr(39) + 'hot' + chr(39) + ').version')})")
        check(a.eval("$.reload.version('tex')") == 1, "§27 версия ассета читается по имени")

        # --- сценарий 2: атлас ------------------------------------------------
        idle_before = a.eval("$.fixture.frame('idle_0')")
        node_before = a.eval("$.fixture.atlas_sprite()")
        a.eval("$.fixture.old_sheet = $.fixture.sheet()")
        # та же раскладка, другая картинка: спрайты не пересобираются вовсе
        write_png(os.path.join(assets, "atlas.png"), 16, 8, (120, 120, 240))
        res = a.eval("$.reload.reload('atlas_page')")
        check(res["ok"] is True, f"§27 страница атласа (текстура) перезагружена: {res.get('code')}")
        check(a.eval("$.fixture.frame('idle_0')") == idle_before,
              f"§27 при той же раскладке frame ID не меняется ({idle_before} → "
              f"{a.eval(chr(36) + '.fixture.frame(' + chr(39) + 'idle_0' + chr(39) + ')')})")
        check(a.eval("$.fixture.atlas_sprite()") == node_before,
              "§27 узел держит тот же спрайт — перепривязки не было")
        # изменённая раскладка: idle_0 сдвинулся, узел перепривязывается по имени
        write_atlas(os.path.join(assets, "atlas.json"), {"idle_0": (8, 0), "run_0": (0, 0)})
        res = a.eval("$.reload.reload('atlas')")
        a.step(1)
        new_idle = a.eval("$.fixture.frame('idle_0')")
        check(res["ok"] is True and new_idle != idle_before,
              f"§27 изменённая раскладка пересобрала кадры ({idle_before} → {new_idle})")
        check(a.eval("$.fixture.atlas_sprite()") == new_idle,
              "§27 спрайт узла перепривязан к новому кадру по имени")
        check(a.eval("$.fixture.old_sheet.frame('idle_0')") == new_idle,
              "§27 старая ссылка на атлас читает новую версию (делегирование)")
        check(a.eval("$.fixture.sheet().info('idle_0').x") == 8,
              "§27 новая раскладка видна в info()")
        # кадр, используемый в мире, пропал из новой раскладки → отказ
        write_atlas(os.path.join(assets, "atlas.json"), {"run_0": (0, 0)})   # idle_0 исчез
        res = a.eval("$.reload.reload('atlas')")
        check(res["ok"] is False and res["code"] == "R2D_RELOAD_FRAME_MISSING",
              f"§27 исчезнувший используемый кадр — отказ {res.get('code')}, а не тихая привязка")
        check(a.eval("$.fixture.atlas_sprite()") == new_idle,
              "§27 после отказа спрайт узла не тронут (last-known-good)")
        check(a.eval("$.fixture.sheet().frame('idle_0')") == new_idle,
              "§27 и атлас остался прежней версии")
        # возвращаем рабочий атлас
        write_atlas(os.path.join(assets, "atlas.json"), {"idle_0": (8, 0), "run_0": (0, 0)})
        a.eval("$.reload.reload('atlas')")

        # --- сценарий 3: данные карты (коллизия) ------------------------------
        cell = a.eval("(() => { const p = $.fixture.map_tile_pixel(0, 0); return [p.x, p.y]; })()")
        solid_before = a.eval("$.fixture.solids_at(%d, %d)" % (cell[0], cell[1]))
        check(a.eval("$.fixture.map_cell(0, 0)") == 1 and solid_before >= 1,
              f"§27 до перезагрузки клетка (0,0) — тайл 1 и твёрдая ({solid_before} тел)")
        write_text(os.path.join(assets, "map.json"),
                   '{"cols":4,"rows":4,"solid":true,"data":[0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]}')
        res = a.eval("$.reload.reload('map')")
        a.step(3)
        solid_after = a.eval("$.fixture.solids_at(%d, %d)" % (cell[0], cell[1]))
        check(res["ok"] is True and res["changed"] is True,
              f"§27 данные карты применены ({res.get('code')})")
        check(a.eval("$.fixture.map_cell(0, 0)") == 0,
              "§27 клетка (0,0) стала пустой (визуал)")
        check(solid_after == 0,
              f"§27 коллизия ушла вместе с тайлом ({solid_before} → {solid_after} тел)")

        # --- сценарий 4: документ RmlUi (текст + стиль) ------------------------
        check(a.eval("$.fixture.hud_line()") == "v1", "§27 документ открыт и читается (v1)")
        width_before = a.eval("$.fixture.hud_width()")
        write_text(os.path.join(ui_dir, "hud.rml"), HUD_RML % (200, "v2"))
        res = a.eval("$.reload.reload('hud')")
        a.step(2)
        width_after = a.eval("$.fixture.hud_width()")
        check(res["ok"] is True and res["changed"] is True,
              f"§27 документ RmlUi перезагружен ({res.get('code')})")
        check(a.eval("$.fixture.hud_line()") == "v2", "§27 новый текст документа виден")
        check(width_before != width_after and width_after > 0,
              f"§27 новый .rcss применён: ширина {width_before} → {width_after}")
        # битый .rml: отказ, живой документ остаётся рабочим
        write_text(os.path.join(ui_dir, "hud.rml"), "<rml><body><div id='hud-line'>сломано")
        res = a.eval("$.reload.reload('hud')")
        check(res["ok"] is False and res["code"] in ("R2D_RELOAD_RML", "R2D_RELOAD_VALIDATE"),
              f"§27 битый .rml отклонён ({res.get('code')})")
        check(a.eval("$.fixture.hud_line()") == "v2",
              "§27 после отказа документ v2 продолжает работать (last-known-good)")
        # внешний .rcss: RmlUi кэширует таблицу по URL — результат об этом
        # предупреждает структурно, а не делает вид, что стиль применён
        write_text(os.path.join(ui_dir, "hud_ext.rcss"), HUD_EXT_RCSS % 180)
        res = a.eval("$.reload.reload('hud_ext')")
        codes = [w.get("code") for w in (res.get("warnings") or [])]
        check(res["ok"] is True and "R2D_RELOAD_STYLE_CACHED" in codes,
              f"§27 правка внешнего .rcss помечена R2D_RELOAD_STYLE_CACHED: {codes}")
        check(any(e.get("code") == "R2D_RELOAD_STYLE_CACHED" for e in a.eval("$.debug.errors()")),
              "§27 предупреждение о кэше стилей видно в $.debug.errors()")

        # --- ошибка JSON не завершает игру ------------------------------------
        write_text(os.path.join(assets, "params.json"), '{ это не json')
        res = a.eval("$.reload.reload('params')")
        check(res["ok"] is False and res["code"] == "R2D_RELOAD_PARSE",
              f"§27 битый JSON даёт failed с кодом ({res.get('code')})")
        check(a.eval("1 + 1") == 2, "§27 игра отвечает после ошибки JSON")
        frames_before = a.eval("$.debug.stats().frame")
        a.step(3)
        check(a.eval("$.debug.stats().frame") > frames_before, "§27 кадры продолжают идти")
        check(any(e.get("code") == "R2D_RELOAD_PARSE" for e in a.eval("$.debug.errors()")),
              "§27 ошибка видна структурно в $.debug.errors()")
        # валидатор схемы тоже отклоняет
        write_text(os.path.join(assets, "params.json"), '{"speed": "быстро"}')
        res = a.eval("$.reload.reload('params')")
        check(res["ok"] is False and res["code"] == "R2D_RELOAD_VALIDATE",
              f"§27 схема validate отклоняет данные ({res.get('code')})")
        write_text(os.path.join(assets, "params.json"), '{"speed": 25, "label": "v2"}')
        res = a.eval("$.reload.reload('params')")
        check(res["ok"] is True and res["value"]["speed"] == 25,
              "§27 корректные данные применяются после ошибок")

        # --- серия reload: ничего не растёт -----------------------------------
        a.eval("$.reload.reloadAll()")
        a.step(2)
        before = a.eval("$.fixture.counters()")
        for _ in range(100):
            a.eval("$.reload.reloadAll()")
        a.step(2)
        after = a.eval("$.fixture.counters()")
        check(before == after,
              f"§27 100 reload: счётчики не выросли — {before} → {after}")
        applied_series = a.eval("$.reload.stats().applied")
        check(a.eval("$.reload.stats().unchanged") >= 100,
              f"§27 неизменившиеся ассеты не публикуют версии (applied={applied_series})")

        # серия с РЕАЛЬНО меняющимся содержимым той же текстуры (на месте)
        before = a.eval("$.fixture.counters()")
        v0 = a.eval("$.reload.version('tex')")
        r0 = a.eval("$.resource.info('hot').version")
        for i in range(30):
            write_png(os.path.join(assets, "hot.png"), 8, 8, (i * 7 % 255, 60, 200))
            a.eval("$.reload.reload('tex')")
        a.step(2)
        after = a.eval("$.fixture.counters()")
        check(before == after,
              f"§27 30 замен текстуры на месте: handle'ы не растут — {before} → {after}")
        check(a.eval("$.reload.version('tex')") == v0 + 30,
              f"§27 версия ассета после 30 замен: {a.eval(chr(36) + '.reload.version(' + chr(39) + 'tex' + chr(39) + ')')} (было {v0})")
        check(a.eval("$.resource.info('hot').version") == r0 + 30,
              f"§27 версия ресурса после 30 замен: {a.eval(chr(36) + '.resource.info(' + chr(39) + 'hot' + chr(39) + ').version')} (было {r0})")

        # --- отложенное освобождение handle'а ---------------------------------
        tex_live = a.eval("$.debug.limits().textures")
        extra_id = a.eval("engine.loadTexture('assets/extra.png')")
        check(extra_id >= 0 and a.eval("$.debug.limits().textures") == tex_live + 1,
              f"§27 тестовая текстура создана (live {tex_live} → {a.eval('$.debug.limits().textures')})")
        a.eval("$.reload.retire({ kind: 'texture', handle: %d, name: 'extra' })" % extra_id)
        check(a.eval("$.reload.pending().length") == 1,
              "§27 handle встал в очередь освобождения")
        check(a.eval("$.debug.limits().textures") == tex_live + 1,
              "§27 в кадре замены handle ещё жив (никто не освобождает посреди кадра)")
        a.step(2)
        check(a.eval("$.debug.limits().textures") == tex_live,
              f"§27 на следующем кадре handle освобождён "
              f"({tex_live + 1} → {a.eval('$.debug.limits().textures')})")
        check(a.eval("$.reload.pending().length") == 0, "§27 очередь освобождения пуста")

        # --- три операции различаются явно -------------------------------------
        ops = a.eval("({ asset: $.reload.reload('tex').operation, "
                     "behavior: typeof $.reload.behavior, scene: typeof $.reload.restartScene })")
        check(ops["asset"] == "asset" and ops["behavior"] == "function" and ops["scene"] == "function",
              f"§27 три операции различаются: {ops}")

        # --- пакет не зависит от кэша SDK --------------------------------------
        paths = [item["path"] for item in a.eval("$.reload.list()") if item["path"]]
        check(all(("sdk" not in p) and (".cache" not in p) for p in paths),
              f"§27 ассеты читаются из каталога игры, без кэша SDK: {paths}")

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
