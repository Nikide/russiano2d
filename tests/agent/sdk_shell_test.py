#!/usr/bin/env python3
# ===========================================================================
# Агентский тест оболочки SDK (приложение R2D на RmlUi, проект sdk/).
#
# Проверяет то, что обещает docs/SDK.md для Phase 1:
#   * мост $.sdk включён проектом и ходит в нативный r2d-sdk;
#   * launcher строит каталог из sdk_tools.json и показывает name/description/
#     last_updated, а ошибки реестра — структурной диагностикой;
#   * проект открывается, Asset Browser показывает реальные файлы;
#   * человек (клик по элементу RmlUi) и агент (операции $.sdkApp) вызывают
#     одну реализацию;
#   * запуск и сборка идут через бэкенд, состояние видно в снимке агента.
#
# Запуск (после сборки): python3 tests/agent/sdk_shell_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
FIX = "tests/fixtures/sdk"
DOC = "$.ui.doc('sdk/ui/shell.rml')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def snap(a):
    return json.loads(a.eval("JSON.stringify($.sdkApp.snapshot())"))


def wait_idle(a, limit=240):
    """Крутить кадры, пока бэкенд не освободится (busy == 0)."""
    a.step(2)
    for _ in range(limit):
        if a.eval("$.sdkApp.state.busy") == 0:
            a.step(1)
            return True
        a.step(2)
    return False


def main():
    with Agent(game="sdk", seed=3) as a:
        a.step(3)
        check(a.eval("$.sdk.available()") is True, "мост $.sdk включён проектом (toolHost)")
        check(a.eval("$.sdk.paths().toolFound") is True, "r2d-sdk найден рядом с движком")
        check(wait_idle(a), "стартовое чтение реестра завершилось")

        # --- Launcher: каталог из sdk_tools.json ------------------------------------
        s = snap(a)
        check(s["registry"]["loaded"] and s["registry"]["ok"], "реестр загружен без ошибок")
        ids = [t["id"] for t in s["registry"]["tools"]]
        reg = json.load(open(os.path.join(ROOT, "sdk_tools.json"), encoding="utf-8"))
        check(ids == [t["id"] for t in reg["tools"]], "launcher показывает ровно записи sdk_tools.json")
        cards = a.eval(f"{DOC}.content('tool-list')")
        check(all(t["name"] in cards for t in reg["tools"]), "карточки содержат name каждого инструмента")
        check(all(t["description"][:20] in cards for t in reg["tools"]), "карточки содержат description")
        check("08.10.2026 18:00 (+03:00)" in cards, "карточки показывают last_updated")
        check("Открыть" in cards, "у валидных записей есть кнопка")
        check(a.eval(f"{DOC}.rect('view-tools').h") == 0, "скрытый экран инструментов не занимает места")
        check(a.eval(f"{DOC}.rect('view-projects').h") > 100, "активный экран проектов имеет геометрию")

        # Снимок агента: оболочка видна через стандартную команду state.
        st = a.state()
        check("sdk" in json.dumps(st), "снимок state содержит раздел sdk")

        # --- Ошибки реестра — структурная диагностика, а не молчание ----------------------
        a.eval(f"$.sdkApp.loadRegistry('{FIX}/bad_tools.json'); 1")
        wait_idle(a)
        s = snap(a)
        check(len(s["registry"]["tools"]) == 4, "плохой реестр: все 4 записи остались в списке")
        check([t["valid"] for t in s["registry"]["tools"]] == [True, False, False, False], "плохой реестр: valid по записям")
        for code in ("SDK_REGISTRY_DATE", "SDK_REGISTRY_DUPLICATE_ID", "SDK_REGISTRY_ID", "SDK_REGISTRY_FIELD"):
            check(code in s["diagnostics"]["codes"], f"панель диагностик: {code}")
        cards = a.eval(f"{DOC}.content('tool-list')")
        check(cards.count("invalid") >= 3, "невалидные карточки помечены")
        diag_html = a.eval(f"{DOC}.content('diag-list')")
        check("SDK_REGISTRY_DATE" in diag_html and "diag-err" in diag_html, "диагностика видна в RmlUi-панели")

        a.eval(f"$.sdkApp.loadRegistry('{FIX}/badver_tools.json'); 1")
        wait_idle(a)
        s = snap(a)
        check("SDK_REGISTRY_SCHEMA_VERSION" in s["diagnostics"]["codes"], "неверная schema_version — диагностика")
        a.eval("$.sdkApp.loadRegistry(); 1")
        wait_idle(a)
        check(snap(a)["registry"]["ok"], "корневой реестр перечитан")

        # --- Проект: клик человека и операция агента — одна реализация --------------------------
        a.eval(f"{DOC}.setValue('project-path', '{FIX}/proj')")
        a.eval(f"{DOC}.click('btn-open-project')")
        check(wait_idle(a), "открытие проекта завершилось")
        s = snap(a)
        check(s["project"] and s["project"]["title"] == "SDK fixture", "проект открыт кликом по кнопке")
        check(s["assets"]["loaded"] and s["assets"]["count"] == 5, "Asset Browser: 5 файлов")
        info = a.eval(f"{DOC}.content('project-info')")
        check("SDK fixture" in info and "640×360" in info, "панель проекта показывает данные манифеста")
        rows = a.eval(f"{DOC}.content('asset-list')")
        for name in ("hero.character.json", "menu.rml", "a.png", "project.json", "main.js"):
            check(name in rows, f"Asset Browser показывает {name}")
        check("→ good-tool" not in rows, "без совпадающего реестра инструмент не назначен")
        check(a.eval("$.sdkApp.state.recent[0]") == f"{FIX}/proj", "проект попал в недавние")

        # Фильтр и выбор.
        n = a.eval("$.sdkApp.setFilter('hero')")
        check(n == 1, "фильтр по подстроке оставляет 1 файл")
        a.eval("$.sdkApp.setFilter('')")
        n = a.eval("$.sdkApp.setFilter(undefined, 'image')")
        check(n == 1, "фильтр по типу image")
        a.eval("$.sdkApp.setFilter('', '')")
        a.eval("$.sdkApp.selectAsset('assets/hero.character.json')")
        check(snap(a)["assets"]["selected"] == "assets/hero.character.json", "выбор файла")
        check("row sel" in a.eval(f"{DOC}.content('asset-list')"), "выбранная строка подсвечена")

        # Проверка ассета: у RML пока нет валидатора — info, не ошибка.
        a.eval("$.sdkApp.selectAsset('ui/menu.rml'); 1")
        a.eval(f"{DOC}.click('btn-asset-validate')")
        wait_idle(a)
        s = snap(a)
        check("SDK_NO_VALIDATOR" in s["diagnostics"]["codes"] and s["diagnostics"]["errors"] == 0,
              "проверка без валидатора — info SDK_NO_VALIDATOR")

        # Открыть файл без инструмента — понятная диагностика, а не тишина.
        a.eval("$.sdkApp.openAsset('ui/menu.rml'); 1")
        check("SDK_NO_TOOL_FOR_ASSET" in snap(a)["diagnostics"]["codes"], "файл без инструмента: SDK_NO_TOOL_FOR_ASSET")

        # Несуществующий проект.
        a.eval("$.sdkApp.openProject('tests/fixtures/sdk/нет_такого'); 1")
        wait_idle(a)
        s = snap(a)
        check("SDK_PROJECT_NOT_FOUND" in s["diagnostics"]["codes"], "несуществующий проект: SDK_PROJECT_NOT_FOUND")
        check(s["project"] and s["project"]["title"] == "SDK fixture", "прежний проект остался открытым")

        # --- Инструменты и навигация -------------------------------------------------------------------
        a.eval("$.sdkApp.showView('tools')")
        check(snap(a)["view"] == "tools", "переключение на экран инструментов")
        a.step(2)
        check(a.eval(f"{DOC}.rect('view-tools').h") > 100, "экран инструментов виден (занимает место)")
        a.eval("$.sdkApp.openTool('asset-browser'); 1")
        check(snap(a)["view"] == "assets", "инструмент asset-browser открывает экран ассетов")
        a.eval("$.sdkApp.openTool('нет-такого'); 1")
        check("SDK_TOOL_NOT_FOUND" in snap(a)["diagnostics"]["codes"], "неизвестный инструмент — диагностика")
        a.eval(f"{DOC}.click('nav-docs')")
        check(snap(a)["view"] == "docs", "клик по навигации переключает экран")

        # --- Документация ----------------------------------------------------------------------------------------
        n = a.eval("$.sdkApp.showDoc('SDK_AUDIT.md')")
        check(isinstance(n, int) and n > 500, "документ прочитан")
        check("Аудит" in a.eval(f"{DOC}.content('doc-text')"), "текст документа показан в RmlUi")
        a.eval("$.sdkApp.showDoc('docs/нет.md'); 1")
        check("SDK_DOC_MISSING" in snap(a)["diagnostics"]["codes"], "нет документа — диагностика")

        # --- Запуск и сборка через бэкенд -----------------------------------------------------------------------------
        a.eval("$.sdkApp.runProject({headless:true, frames:3}); 1")
        check(snap(a)["run"] and snap(a)["run"]["running"] in (True, False), "запуск зарегистрирован в состоянии")
        for _ in range(300):
            a.step(2)
            r = snap(a)["run"]
            if r and not r["running"]:
                break
        r = snap(a)["run"]
        check(r and r["exitCode"] == 0, "игра отработала 3 кадра headless и завершилась кодом 0")

        out = os.path.join(ROOT, "build", "sdk_shell_test_game")
        if os.path.exists(out):
            os.remove(out)
        a.eval(f"{DOC}.setValue('build-out', '{out}')")
        a.eval(f"{DOC}.click('btn-build')")
        check(wait_idle(a, 600), "сборка завершилась")
        check(os.path.isfile(out), "сборка создала исполняемый файл")
        check("SDK_ENGINE_EXIT" not in snap(a)["diagnostics"]["codes"], "сборка без ошибок движка")
        if os.path.exists(out):
            os.remove(out)

        # Остановка игры: запустить без frames и убить.
        a.eval("$.sdkApp.runProject({headless:true}); 1")
        a.step(10)
        check(a.eval("$.sdkApp.stopProject()") is True, "stopProject убивает процесс игры")
        for _ in range(200):
            a.step(2)
            r = snap(a)["run"]
            if r and not r["running"]:
                break
        check(not snap(a)["run"]["running"], "процесс остановлен, Promise завершился")

        # --- Диагностика: очистка ----------------------------------------------------------------------------------------------
        a.eval(f"{DOC}.click('btn-diag-clear')")
        check(snap(a)["diagnostics"]["codes"] == [], "кнопка очищает панель диагностик")

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
