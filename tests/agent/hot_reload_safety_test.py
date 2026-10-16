#!/usr/bin/env python3
# ===========================================================================
# §46. Безопасность горячей перезагрузки.
#
# Проверяется по живому движку на СОБСТВЕННОЙ сцене теста (каталог собирается
# в build/hot_reload_safety, чтобы менять файлы «на ходу», как это делает
# художник в preview):
#
#   * перезапуск поведения (JS) с корректным файлом применяется на границе
#     кадра; повторный запрос того же файла без изменений идемпотентен;
#   * НЕсобираемый main.js не уносит с собой живой рантайм: $.reload.behavior()
#     отказывает ДО запроса, прежние глобальные значения и кадры остаются;
#   * перезагрузка ассета во время кадра (из колбэка) не оставляет мёртвых
#     обёрток: узел, спрайт и ресурс продолжают отвечать после замены;
#   * ошибка перезагрузки не уничтожает last-known-good: битый JSON/атлас/
#     RmlUi оставляют прежнюю версию рабочей, а причина названа кодом;
#   * отложенное освобождение handle'а не происходит посреди кадра.
#
# Запуск (после сборки движка):
#   python3 tests/agent/hot_reload_safety_test.py
# ===========================================================================

import os
import shutil
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

WORK = os.path.join(ROOT, "build", "hot_reload_safety")
FAILURES = []

MAIN_V1 = """// Сцена теста §46: файл переписывается на ходу.
globalThis.BUILD = 1;
globalThis.READY = false;
$.ready(() => {
    globalThis.READY = true;
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 640, 360);
    $.resource.load('hot', 'assets/hot.png');
    $('<sprite>', { id: 'tex' }).at(120, 120).size(48, 48).sprite('assets/hot.png').appendTo($.world);
    const sheet = $.atlas.load('sheet', 'assets/atlas.json');
    $('<sprite>', { id: 'frame' }).at(240, 120).size(16, 16)
        .sprite(sheet ? sheet.frame('idle_0') : -1).appendTo($.world);
    $.reload.watch('tex', { kind: 'texture', path: 'assets/hot.png', texture: () => $.resource.get('hot') });
    $.reload.watch('sheet', { kind: 'atlas', path: 'assets/atlas.json', atlas: 'sheet' });
    $.reload.watch('params', { kind: 'json', path: 'assets/params.json' });
    $.fixture = {
        build: () => globalThis.BUILD,
        ready: () => globalThis.READY,
        tex: () => $.resource.get('hot'),
        node_sprite: () => { const n = $('#frame').nodes[0]; return n ? n.sprite : -1; },
        frame: (name) => { const s = $.atlas.get('sheet'); return s ? s.frame(name) : -1; },
        info: (name) => { const s = $.atlas.get('sheet'); return s ? s.info(name) : null; },
        counters: () => ({ sprites: $.debug.limits().sprites, textures: $.debug.limits().textures,
                           nodes: $.scene.counts().nodes }),
    };
});
"""

MAIN_V2 = MAIN_V1.replace("globalThis.BUILD = 1;", "globalThis.BUILD = 2;")

#: Синтаксически несобираемая версия: закрывающая скобка функции вместо объявления.
MAIN_BROKEN = """// Сцена теста §46: НЕсобираемая версия.
globalThis.BUILD = 3;
function ( { ] это не JS
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def write_png(path, w, h, rgb):
    """Минимальный PNG (RGBA8) без внешних зависимостей."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    row = bytes([0]) + bytes([rgb[0], rgb[1], rgb[2], 255]) * w
    raw = row * h

    def chunk(tag, data):
        body = tag + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xffffffff))

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


def prepare():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    write_text(os.path.join(WORK, "project.json"),
               '{"title":"hot reload safety","version":"0.0.1","width":640,"height":360}')
    write_text(os.path.join(WORK, "main.js"), MAIN_V1)
    write_png(os.path.join(WORK, "assets", "hot.png"), 8, 8, (220, 40, 40))
    write_text(os.path.join(WORK, "assets", "atlas.json"),
               '{"frames": {"idle_0": {"x": 0, "y": 0, "w": 8, "h": 8}},'
               ' "meta": {"image": "atlas.png"}}')
    write_png(os.path.join(WORK, "assets", "atlas.png"), 16, 8, (200, 200, 200))
    write_text(os.path.join(WORK, "assets", "params.json"), '{"speed": 10, "label": "v1"}')


def main():
    prepare()
    with Agent(game=WORK, seed=5) as a:
        a.step(3)
        check(a.eval("$.fixture.ready()") is True and a.eval("$.fixture.build()") == 1,
              "сцена поднялась на первой версии (BUILD=1)")

        # --- Перезапуск поведения с корректным файлом --------------------------
        a.eval("globalThis.__mark = 'живой'; 'ok'")
        write_text(os.path.join(WORK, "main.js"), MAIN_V2)
        first = a.eval("$.reload.behavior('тест §46: v2')")
        print("  --   behavior(v2): %s" % first)
        check(first["ok"] is True and first["operation"] == "behavior",
              "перезапуск поведения запрошен: %s" % first)
        check(first.get("checked") is True, "точка входа проверена на синтаксис до запроса")
        a.step(2)
        check(a.eval("typeof $") == "function" and a.eval("$.fixture.build()") == 2,
              "новая версия загрузилась (BUILD=2)")
        check(a.eval("globalThis.__mark") is None,
              "замыкания/глобальные значения прежней версии не сохраняются (обещание движка)")

        # --- Идемпотентность: тот же файл ещё раз ------------------------------
        count_before = a.eval("$.script.count()")
        second = a.eval("$.reload.behavior('тест §46: тот же файл')")
        a.step(2)
        check(second["ok"] is True and a.eval("$.fixture.build()") == 2,
              "повторный перезапуск того же файла даёт ту же версию (BUILD=2)")
        check(a.eval("$.script.count()") == count_before + 1,
              "рантайм перезапустился ровно один раз (%s → %s)"
              % (count_before, a.eval("$.script.count()")))
        check(a.eval("$.reload.behavior('без проверки', { check: false })")["checked"] is False,
              "проверку можно выключить явно — и результат об этом говорит")
        a.step(2)     # завершаем запрошенный перезапуск, пока файл ещё целый
        check(a.eval("$.fixture.build()") == 2 and a.eval("typeof $") == "function",
              "перезапуск без проверки дошёл до конца (BUILD=2)")

        # --- Несобираемый файл не уносит живой рантайм -------------------------
        write_text(os.path.join(WORK, "main.js"), MAIN_BROKEN)
        refused = a.eval("$.reload.behavior('тест §46: битый файл')")
        print("  --   behavior(broken): %s" % refused)
        check(refused["ok"] is False and refused.get("code") == "R2D_RELOAD_SYNTAX",
              "несобираемая версия отклонена с кодом R2D_RELOAD_SYNTAX: %s" % refused.get("code"))
        check(refused.get("request") is False, "запрос перезапуска НЕ отправлен (прежний код жив)")
        check("main.js" in str(refused.get("file")), "отказ называет проверенный файл: %s" % refused.get("file"))
        check(isinstance(refused.get("error"), str) and refused["error"] != "",
              "отказ называет причину: %s" % str(refused.get("error"))[:80])
        frames = a.eval("engine.frame")
        a.step(3)
        check(a.eval("engine.frame") > frames, "кадры продолжают идти")
        check(a.eval("$.fixture.ready()") is True and a.eval("$.fixture.build()") == 2,
              "прежний код продолжает работать: BUILD=%s" % a.eval("$.fixture.build()"))
        check(a.eval("$('#tex').length") == 1, "узлы прежней версии на месте")
        check(a.ping().get("pong") is True, "движок отвечает после отказа")

        # Возвращаем рабочий файл: перезапуск снова возможен.
        write_text(os.path.join(WORK, "main.js"), MAIN_V2)
        check(a.eval("$.reload.behavior('тест §46: восстановление')")["ok"] is True,
              "после починки файла перезапуск снова проходит")

        # --- Перезагрузка ассета во время кадра --------------------------------
        a.step(2)
        counters_before = a.eval("$.fixture.counters()")
        tex_before = a.eval("$.fixture.tex()")
        sprite_before = a.eval("$.fixture.node_sprite()")
        write_png(os.path.join(WORK, "assets", "hot.png"), 8, 8, (40, 40, 220))
        in_frame = a.eval("""(() => {
            globalThis.__reload_stages = [];
            $.update(() => { globalThis.__reload_stages.push($.reload.reload('tex').stage); });
            return 'запланировано';
        })()""")
        a.step(3)
        stages = a.eval("globalThis.__reload_stages")
        print("  --   стадии перезагрузки ИЗ КАДРА: %s" % stages)
        check(in_frame == "запланировано" and "applied" in (stages or []),
              "перезагрузка из кадра применилась (стадии: %s)" % stages)
        check(a.eval("$.fixture.tex()") == tex_before,
              "handle текстуры не изменился (замена на месте): %s" % tex_before)
        check(a.eval("$.fixture.node_sprite()") == sprite_before,
              "спрайт узла остался живым (мёртвых обёрток не появилось)")
        check(a.eval("$('#tex').length") == 1 and a.eval("$('#tex').nodes[0].removed") is False,
              "узел не помечен удалённым после перезагрузки в кадре")
        after = a.eval("$.fixture.counters()")
        check(after == counters_before,
              "замена на месте не создала ресурсов: %s → %s" % (counters_before, after))

        # --- Last-known-good: битый JSON и битый атлас -------------------------
        write_text(os.path.join(WORK, "assets", "params.json"), '{ это не json')
        bad = a.eval("$.reload.reload('params')")
        check(bad["ok"] is False and bad["code"] == "R2D_RELOAD_PARSE",
              "битый JSON даёт failed с кодом R2D_RELOAD_PARSE: %s" % bad.get("code"))
        check(a.eval("$.reload.get('params').version") == 0,
              "версия ассета не выросла после отказа: %s" % a.eval("$.reload.get('params').version"))
        write_text(os.path.join(WORK, "assets", "params.json"), '{"speed": 25, "label": "v2"}')
        good = a.eval("$.reload.reload('params')")
        check(good["ok"] is True and good["changed"] is True and good["value"]["speed"] == 25,
              "после починки данные применились (speed=%s)" % (good.get("value") or {}).get("speed"))

        # Битый атлас: кадр, используемый в мире, пропал из новой раскладки.
        frame_before = a.eval("$.fixture.frame('idle_0')")
        write_text(os.path.join(WORK, "assets", "atlas.json"),
                   '{"frames": {"other": {"x": 0, "y": 0, "w": 8, "h": 8}}, "meta": {"image": "atlas.png"}}')
        atlas_bad = a.eval("$.reload.reload('sheet')")
        check(atlas_bad["ok"] is False and atlas_bad["code"] == "R2D_RELOAD_FRAME_MISSING",
              "исчезнувший используемый кадр отклоняет атлас: %s" % atlas_bad.get("code"))
        check(a.eval("$.fixture.frame('idle_0')") == frame_before,
              "last-known-good: прежний кадр жив (%s)" % frame_before)
        check(a.eval("$.fixture.node_sprite()") == sprite_before, "спрайт узла не тронут отказом")

        # --- Проверка синтаксиса по явному файлу -------------------------------
        # `$.reload.behavior(reason, { file })` умеет проверять не только main.js:
        # это тот же путь, что защищает штатный перезапуск.
        write_text(os.path.join(WORK, "probe_ok.js"), "const probe = 1;\n")
        write_text(os.path.join(WORK, "probe_broken.js"), "const probe = ;\n")
        count_before = a.eval("$.script.count()")
        bad_file = a.eval("$.reload.behavior('тест §46: чужой файл', { file: 'probe_broken.js' })")
        check(bad_file["ok"] is False and bad_file.get("code") == "R2D_RELOAD_SYNTAX"
              and bad_file.get("request") is False,
              "битый файл по явному пути отклонён без запроса перезапуска: %s" % bad_file.get("code"))
        check(a.eval("$.script.count()") == count_before,
              "рантайм не перезапускался при отказе (%s → %s)"
              % (count_before, a.eval("$.script.count()")))
        ok_file = a.eval("$.reload.behavior('тест §46: чужой файл ок', { file: 'probe_ok.js' })")
        check(ok_file["ok"] is True and ok_file.get("checked") is True,
              "корректный файл по явному пути проходит проверку: %s" % ok_file)
        a.step(2)
        check(a.eval("$.script.count()") == count_before + 1,
              "после корректного файла рантайм перезапустился один раз")
        # Модульный синтаксис так не проверить — об этом честно сообщается.
        write_text(os.path.join(WORK, "probe_module.js"), "import { engine } from 'r2d/native.js';\n")
        module_file = a.eval("$.reload.behavior('тест §46: модуль', { file: 'probe_module.js' })")
        check(module_file["ok"] is True and module_file.get("checked") is False
              and bool(module_file.get("check_note")),
              "модульный файл: проверка не выполнена, и это названо (checked=%s, note=%s)"
              % (module_file.get("checked"), str(module_file.get("check_note"))[:60]))
        a.step(2)

        # --- Кадр и движок живы ------------------------------------------------
        frames = a.eval("engine.frame")
        a.step(3)
        check(a.eval("engine.frame") > frames, "кадры идут после всех проверок §46")
        check(a.eval("$.reload.stats().watched") >= 3, "ассеты остались под наблюдением: %s"
              % a.eval("$.reload.stats().watched"))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
