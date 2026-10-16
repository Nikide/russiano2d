#!/usr/bin/env python3
# ===========================================================================
# §29 Спецификации: панели студий SDK проверяют тем же backend, что CLI.
#
# Проверяется по факту, по каждому инструменту:
#   * «Проверить» в панели вызывает нативный `r2d-sdk validate` и показывает
#     ровно его структурные диагностики: коды панели РАВНЫ кодам CLI на том же
#     файле (панель не подменяет их своими);
#   * корректный ассет даёт «ошибок 0», сломанный — коды CLI;
#   * preview-ссылка ведёт на ТОТ ЖЕ путь, что проверялся (файл = идентичность,
#     базы проекта нет);
#   * undo/redo документа не теряется после проверки.
#
# Готовые образцы и CLI-хелпер берутся из tests/sdk_validation_test.py — один
# источник данных для обеих проверок §29.
#
# Запуск (после сборки):
#   python3 tools/run_tests.py sdk_tools_panels_test
#   R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py sdk_tools_panels_test
# ===========================================================================

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests"))
from agent_client import Agent   # noqa: E402
import sdk_validation_test as SV   # noqa: E402  (GOOD/BROKEN/validate/write_fixture)

FAILURES = []
TMP = os.path.join(ROOT, "build", "sdk_panels")

#: инструмент реестра, studio-ключ, тип валидатора, суффикс файла
DATA_TOOLS = [
    ("tilemap-studio", "tilemap-studio", "tilemap", ".tilemap.json"),
    ("particle-studio", "particle-studio", "particles", ".particles.json"),
    ("collision-tools", "collision-tools", "collision", ".collision.json"),
    ("parallax-tools", "parallax-tools", "layers", ".layers.json"),
    ("font-tools", "font-tools", "fonts", ".fonts.json"),
    ("audio-tools", "audio-tools", "audio", ".audio.json"),
    ("input-tools", "input-tools", "input", ".input.json"),
]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def wait_idle(a, limit=300):
    a.step(2)
    for _ in range(limit):
        if a.eval("$.sdkApp.state.busy") == 0:
            return True
        a.step(2)
    return False


def wait_studio(a, key, limit=200):
    for _ in range(limit):
        if a.eval(f"$.sdkApp.studios['{key}'] && $.sdkApp.studios['{key}'].snapshot().active") is True:
            return True
        a.step(2)
    return False


def snap(a, key):
    s = json.loads(a.eval(f"JSON.stringify($.sdkApp.studios['{key}'].snapshot())"))
    # У части студий поля панели лежат только во вложенном panel — поднимаем их,
    # чтобы проверки были одинаковыми для всех девяти инструментов.
    p = s.get("panel") or {}
    for field in ("validatedPath", "previewPath", "previewMatchesValidated", "codes", "errors", "warnings"):
        if s.get(field) is None and p.get(field) is not None:
            s[field] = p[field]
    return s


def open_tool(a, tool_id, path, key):
    a.eval(f"$.sdkApp.openTool('{tool_id}', {{ assetAbs: {json.dumps(path)} }}); 1")
    if not wait_studio(a, key):
        return False
    # Студия могла остаться активной от прошлого файла: ждём именно этот путь.
    # У Automation путь в снимке называется path, у остальных — file.
    probe = f"($.sdkApp.studios['{key}'].snapshot().file || $.sdkApp.studios['{key}'].snapshot().path)"
    for _ in range(120):
        if a.eval(probe) == path:
            return True
        a.step(2)
    return a.eval(probe) == path


def sdk_codes(a, key, label):
    a.eval(f"$.sdkApp.studios['{key}'].validate(); 1")
    wait_idle(a)
    s = snap(a, key)
    return s, s.get("codes") or []


def fixture(kind, suffix, name, broken=False):
    data = SV.BROKEN[kind][0] if broken else SV.GOOD[kind]
    neighbours = SV.NEIGHBOURS.get(kind, ())
    return SV.write_fixture(TMP, name + suffix, data, neighbours)


def main():
    os.makedirs(TMP, exist_ok=True)
    with Agent(game="sdk", seed=3) as a:
        a.step(3)
        check(wait_idle(a), "стартовое чтение реестра завершилось")
        a.eval("$.sdkApp.openProject('tests/fixtures/sdk/data_proj'); 1")
        wait_idle(a)

        # --- Семь студий данных: один и тот же backend -------------------------
        for tool_id, key, kind, suffix in DATA_TOOLS:
            good = fixture(kind, suffix, kind + "-good")
            bad = fixture(kind, suffix, kind + "-bad", broken=True)

            check(open_tool(a, tool_id, good, key), f"{tool_id}: файл открылся")
            s, codes = sdk_codes(a, key, tool_id)
            ref = SV.validate(good, kind)[1]
            check(sorted(codes) == sorted(ref),
                  f"{tool_id}: коды панели равны CLI на том же файле ({codes} == {ref})")
            check(s.get("errors") == 0, f"{tool_id}: корректный файл — ошибок 0 (warnings {s.get('warnings')})")

            a.eval(f"$.sdkApp.studios['{key}'].preview(); 1")
            a.step(1)
            s = snap(a, key)
            check(s.get("previewMatchesValidated") is True,
                  f"{tool_id}: preview и проверка — один путь ({s.get('previewPath')})")
            check(s.get("previewPath") == good, f"{tool_id}: preview ведёт на проверенный файл")

            # undo/redo документа не теряется после проверки
            ok_undo = a.eval(f"""(() => {{
                const h = $.sdkApp.studios['{key}'].session.history;
                h.run('панель: проба', (d) => {{ d.__panel_probe = 1; }});
                const after_run = h.canUndo();
                return after_run;
            }})()""")
            check(ok_undo is True, f"{tool_id}: правка попала в историю")
            sdk_codes(a, key, tool_id)
            still = a.eval(f"$.sdkApp.studios['{key}'].session.history.canUndo()")
            check(still is True, f"{tool_id}: проверка не сбросила undo")
            a.eval(f"$.sdkApp.studios['{key}'].session.history.undo(); 1")
            check(a.eval(f"$.sdkApp.studios['{key}'].session.history.canRedo()") is True,
                  f"{tool_id}: undo/redo работают после проверки")

            check(open_tool(a, tool_id, bad, key), f"{tool_id}: сломанный файл открылся")
            s, codes = sdk_codes(a, key, tool_id)
            ref = SV.validate(bad, kind)[1]
            check(sorted(codes) == sorted(ref),
                  f"{tool_id}: сломанный файл — те же коды, что CLI ({codes} == {ref})")
            check(s.get("errors") >= 1, f"{tool_id}: сломанный файл даёт ошибки панели")
            check(SV.BROKEN[kind][1] in codes,
                  f"{tool_id}: ожидаемый код {SV.BROKEN[kind][1]} показан")

        # --- Sprite Studio и Animation Studio: атлас ---------------------------
        atlas = fixture("sprite.atlas", ".atlas.json", "sheet-good")
        # Сломанный атлас, который всё ещё открывается студией: кадр нулевой
        # ширины. Так проверяется панель, а не «студия не смогла открыть файл».
        broken_doc = json.loads(json.dumps(SV.GOOD["sprite.atlas"]))
        broken_doc["frames"]["idle_0"]["frame"]["w"] = 0
        bad_atlas = SV.write_fixture(TMP, "sheet-bad.atlas.json", broken_doc, SV.NEIGHBOURS.get("sprite.atlas", ()))
        for tool_id, key in (("sprite-studio", "sprite"), ("animation-studio", "animation")):
            check(open_tool(a, tool_id, atlas, key), f"{tool_id}: атлас открылся")
            s, codes = sdk_codes(a, key, tool_id)
            ref = SV.validate(atlas, "sprite.atlas")[1]
            check(sorted(codes) == sorted(ref),
                  f"{tool_id}: коды равны CLI ({codes} == {ref})")
            check(s.get("errors") == 0, f"{tool_id}: корректный атлас — ошибок 0")
            a.eval(f"$.sdkApp.studios['{key}'].preview(); 1")
            a.step(1)
            s = snap(a, key)
            check(s.get("previewMatchesValidated") is True, f"{tool_id}: preview = проверенный путь")
            if key == "sprite":
                rep = s.get("report") or {}
                check(rep.get("frames") == 2, f"sprite: import report видит кадры ({rep.get('frames')})")
                check("sockets" in rep and "pages" in rep, "sprite: import report содержит sockets/pages")
            else:
                rep = s.get("report") or {}
                check("ranges" in rep and "interruption" in rep,
                      "animation: отчёт содержит диапазоны (окна) и прерывание")
                check(a.eval("$.sdkApp.studios['animation'].interrupt()") is not None,
                      "animation: прерывание preview работает")
            check(open_tool(a, tool_id, bad_atlas, key), f"{tool_id}: сломанный атлас открылся")
            s, codes = sdk_codes(a, key, tool_id)
            ref = SV.validate(bad_atlas, "sprite.atlas")[1]
            check(sorted(codes) == sorted(ref), f"{tool_id}: сломанный атлас — те же коды ({codes})")
            check(s.get("errors") >= 1, f"{tool_id}: сломанный атлас даёт ошибки")

        # --- RmlUi Studio: документ и стиль ------------------------------------
        rml_good = os.path.join(TMP, "doc-good.rml")
        SV.write_fixture(TMP, "doc-good.rml", SV.GOOD["rmlui.document"])
        rml_bad = os.path.join(TMP, "doc-bad.rml")
        SV.write_fixture(TMP, "doc-bad.rml", SV.BROKEN["rmlui.document"][0])
        check(open_tool(a, "rmlui-studio", rml_good, "rmlui-studio"), "rmlui-studio: документ открылся")
        s, codes = sdk_codes(a, "rmlui-studio", "rmlui")
        ref = SV.validate(rml_good, "rmlui.document")[1]
        check(sorted(codes) == sorted(ref), f"rmlui-studio: коды равны CLI ({codes} == {ref})")
        check(s.get("errors") == 0, "rmlui-studio: корректный документ — ошибок 0")
        a.eval("$.sdkApp.studios['rmlui-studio'].previewRun(); 1")
        a.step(1)
        s = snap(a, "rmlui-studio")
        check(s["panel"]["previewMatchesValidated"] is True, "rmlui-studio: preview = проверенный путь")
        rep = s.get("report") or {}
        check(rep.get("elements", 0) > 0 and "links" in rep, "rmlui-studio: отчёт по элементам и ссылкам")
        check(open_tool(a, "rmlui-studio", rml_bad, "rmlui-studio"), "rmlui-studio: сломанный документ открылся")
        s, codes = sdk_codes(a, "rmlui-studio", "rmlui")
        check(any("SDK_RML" in c for c in codes), f"rmlui-studio: сломанный документ даёт коды ({codes})")

        # --- DevTools: сессия агента -------------------------------------------
        check(a.eval("$.sdkApp.openTool('devtools'); 1") is not None, "devtools: инструмент открыт")
        check(wait_studio(a, "devtools"), "devtools: студия активна")
        a.eval("$.sdkApp.studios['devtools'].validateSession(); 1")
        wait_idle(a)
        s = snap(a, "devtools")
        session_file = (s.get("panel") or {}).get("validatedPath")
        check(bool(session_file), f"devtools: сессия записана и проверена ({session_file})")
        if session_file:
            ref = SV.validate(session_file, "json")[1]
            check(sorted(s["panel"]["codes"]) == sorted(ref),
                  f"devtools: коды панели равны CLI ({s['panel']['codes']} == {ref})")
        a.eval("$.sdkApp.studios['devtools'].previewSession(); 1")
        a.step(1)
        s = snap(a, "devtools")
        check((s.get("panel") or {}).get("previewMatchesValidated") is True,
              "devtools: preview сессии = проверенный путь")
        rep = s.get("report") or {}
        check(isinstance(rep.get("fixtures"), int) and rep.get("fixtures", 0) > 0,
              f"devtools: отчёт видит фикстуры приёмки ({rep.get('fixtures')})")

        # --- Automation: манифест batch ----------------------------------------
        manifest_good = os.path.join(TMP, "panel.batch.json")
        with open(manifest_good, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "jobs": [{"op": "validate", "source": atlas}]}, f)
        check(open_tool(a, "automation", manifest_good, "automation"), "automation: манифест открыт")
        s, codes = sdk_codes(a, "automation", "automation")
        ref = SV.validate(manifest_good, "json")[1]
        check(sorted(codes) == sorted(ref), f"automation: коды равны CLI ({codes} == {ref})")
        check(s.get("errors") == 0, "automation: корректный манифест — ошибок 0")
        a.eval("$.sdkApp.studios['automation'].preview(); 1")
        a.step(1)
        s = snap(a, "automation")
        check((s.get("panel") or {}).get("previewMatchesValidated") is True,
              "automation: preview = проверенный манифест")
        rep = s.get("summary") or {}
        check(rep.get("jobs") == 1, f"automation: отчёт видит задания ({rep})")

        manifest_bad = os.path.join(TMP, "panel-bad.batch.json")
        with open(manifest_bad, "w", encoding="utf-8") as f:
            f.write('{"version": 1, "jobs": [')
        check(open_tool(a, "automation", manifest_bad, "automation"), "automation: сломанный манифест открыт")
        s, codes = sdk_codes(a, "automation", "automation")
        ref = SV.validate(manifest_bad, "json")[1]
        check(sorted(codes) == sorted(ref),
              f"automation: сломанный манифест — те же коды, что CLI ({codes} == {ref})")
        check(s.get("errors") >= 1, "automation: сломанный манифест даёт ошибки")

        errs = [line.strip() for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errs, f"журнал без ошибок ({errs[:3]})")
        check(a.ping().get("pong") is True, "движок жив")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
