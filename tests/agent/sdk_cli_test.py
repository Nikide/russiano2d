#!/usr/bin/env python3
# ===========================================================================
# Тест нативного CLI r2d-sdk: команды tools/assets/project/projects/validate/
# run/build печатают один JSON-объект с структурной диагностикой.
#
# Python здесь только тестовая обвязка репозитория; сам инструмент — C-бинарник
# без внешних runtime (docs/SDK.md).
#
# Запуск (после сборки): python3 tests/agent/sdk_cli_test.py
# ===========================================================================

import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SDK = os.environ.get("R2D_SDK_BINARY", os.path.join(ROOT, "build", "r2d-sdk"))
ENGINE = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
FIX = os.path.join(ROOT, "tests", "fixtures", "sdk")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sdk(*args, timeout=120):
    proc = subprocess.run([SDK, *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    check(len(lines) == 1, f"{args[0]}: ровно одна строка JSON в stdout (строк: {len(lines)})")
    try:
        data = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        data = None
    check(data is not None, f"{args[0]}: вывод — валидный JSON")
    return proc.returncode, data or {}


def codes(data):
    return [d["code"] for d in data.get("diagnostics", [])]


def main():
    check(os.path.isfile(SDK), f"бинарник r2d-sdk собран: {SDK}")

    # --- version / commands -------------------------------------------------
    rc, d = sdk("version")
    check(rc == 0 and d["ok"] and d["name"] == "r2d-sdk", "version")
    rc, d = sdk("commands")
    names = [c["name"] for c in d["commands"]]
    for n in ("tools", "assets", "project", "projects", "validate", "run", "build"):
        check(n in names, f"commands содержит {n}")

    # --- tools: корневой реестр ---------------------------------------------
    rc, d = sdk("tools", "--registry", os.path.join(ROOT, "sdk_tools.json"))
    check(rc == 0 and d["ok"] and d["schema_version"] == 1, "tools: корневой sdk_tools.json валиден")
    ids = [t["id"] for t in d["tools"]]
    check(len(ids) == len(set(ids)) and ids, "tools: каждый компонент ровно один раз")
    check(all(t["valid"] for t in d["tools"]), "tools: все записи валидны")
    check(all(t["last_updated"] for t in d["tools"]), "tools: у каждой записи есть last_updated")

    # --- tools: плохие записи не пропускаются молча ----------------------------
    rc, d = sdk("tools", "--registry", os.path.join(FIX, "bad_tools.json"))
    check(rc == 1 and not d["ok"], "tools: плохой реестр — код 1")
    check(len(d["tools"]) == 4, "tools: все 4 записи в списке (ничего не пропущено)")
    check([t["valid"] for t in d["tools"]] == [True, False, False, False], "tools: valid по записям")
    for c in ("SDK_REGISTRY_DATE", "SDK_REGISTRY_DUPLICATE_ID", "SDK_REGISTRY_ID", "SDK_REGISTRY_FIELD"):
        check(c in codes(d), f"tools: диагностика {c}")
    bad = [x for x in d["diagnostics"] if x["code"] == "SDK_REGISTRY_DATE"][0]
    check(bad["severity"] == "error" and bad["location"]["id"] == "bad-date", "tools: location указывает на запись")

    rc, d = sdk("tools", "--registry", os.path.join(FIX, "badver_tools.json"))
    check(rc == 1 and "SDK_REGISTRY_SCHEMA_VERSION" in codes(d), "tools: неверная schema_version — структурная ошибка")
    check(d["diagnostics"][0]["details"] == {"expected": 1, "found": 2}, "tools: details версии схемы")

    rc, d = sdk("tools", "--registry", os.path.join(FIX, "нет_такого.json"))
    check(rc == 1 and "SDK_FILE_NOT_FOUND" in codes(d), "tools: нет файла реестра")

    # --- assets ---------------------------------------------------------------
    rc, d = sdk("assets", os.path.join(FIX, "proj"), "--registry", os.path.join(FIX, "bad_tools.json"))
    check(rc == 0 and d["ok"] and d["count"] == 5, "assets: 5 файлов фикстуры")
    types = {e["path"]: e["type"] for e in d["entries"]}
    check(types.get("assets/hero.character.json") == "re2dsprite.character", "assets: тип character")
    check(types.get("ui/menu.rml") == "rmlui.document", "assets: тип rml")
    check(types.get("project.json") == "project", "assets: тип project")
    paths = [e["path"] for e in d["entries"]]
    check(paths == sorted(paths), "assets: порядок детерминирован")
    tool = {e["path"]: e["tool"] for e in d["entries"]}
    check(tool.get("assets/a.png") == "good-tool", "assets: сопоставление с инструментом по шаблону реестра")
    check(tool.get("ui/menu.rml") is None, "assets: нет инструмента — null")
    check("SDK_REGISTRY_INVALID" in codes(d), "assets: плохой реестр не скрыт")

    rc, d = sdk("assets", os.path.join(FIX, "нет_каталога"))
    check(rc == 1 and "SDK_PROJECT_NOT_FOUND" in codes(d), "assets: нет каталога")

    # --- project / projects ----------------------------------------------------
    rc, d = sdk("project", os.path.join(FIX, "proj"))
    check(rc == 0 and d["title"] == "SDK fixture" and d["version"] == "1.2.3", "project: поля манифеста")
    check(d["width"] == 640 and d["height"] == 360 and d["hasMain"], "project: размер и main.js")
    rc, d = sdk("project", os.path.join(FIX, "нет_каталога"))
    check(rc == 2 and "SDK_PROJECT_NOT_FOUND" in codes(d), "project: нет каталога — код 2")
    rc, d = sdk("projects", os.path.join(ROOT, "tests", "fixtures", "hello", ".."))
    found = [p["path"] for p in d["projects"]]
    check(rc == 0 and "hello" in found and "sdk/proj" in found, "projects: найдены проекты под каталогом")

    # --- validate -----------------------------------------------------------------
    rc, d = sdk("validate", os.path.join(FIX, "bad_project.json"), "--type", "project")
    check(rc == 1 and "SDK_PROJECT_FIELD" in codes(d), "validate: ошибка поля project.json")
    rc, d = sdk("validate", os.path.join(ROOT, "sdk", "project.json"))
    check(rc == 0 and d["type"] == "project" and d["errors"] == 0, "validate: sdk/project.json корректен")
    rc, d = sdk("validate", os.path.join(FIX, "proj", "assets", "a.png"))
    check(rc == 0 and "SDK_NO_VALIDATOR" in codes(d), "validate: нет проверки — info, не ошибка")
    rc, d = sdk("validate", os.path.join(FIX, "нет.json"))
    check(rc == 1 and "SDK_FILE_NOT_FOUND" in codes(d), "validate: нет файла")

    # --- атласы: atlas-grid / atlas-format / atlas-info --------------------------------
    png = os.path.join(ROOT, "tests", "fixtures", "sdk", "sprite_proj", "hero.png")
    out_dir = os.path.join(ROOT, "build", "sdk_cli_atlas")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "hero.atlas.json")
    rc, d = sdk("atlas-grid", png, "--out", out, "--cell", "32x32", "--prefix", "h", "--duration", "80",
                "--tags", "idle:0-3,walk:4-7")
    check(rc == 0 and d["ok"] and d["frames"] == 8 and d["cols"] == 4 and d["rows"] == 2, "atlas-grid: сетка 4×2 из клеток 32×32")
    text = open(out, encoding="utf-8").read()
    check('"h_7": {"frame": {"x": 96, "y": 32, "w": 32, "h": 32}, "duration": 80}' in text, "atlas-grid: канонический вид, кадр в одну строку")
    check('"image": "' in text and 'hero.png"' in text, "atlas-grid: путь картинки относительно JSON")
    rc, d = sdk("atlas-format", out)
    check(rc == 0 and d["ok"] and d["changed"] is False, "atlas-format: канонический файл не меняется")
    open(out, "w", encoding="utf-8").write(json.dumps(json.loads(text)))   # однострочный JSON
    rc, d = sdk("atlas-format", out, "--write")
    check(rc == 0 and d["changed"] and d["written"], "atlas-format --write: приводит однострочный JSON к каноническому виду")
    check(open(out, encoding="utf-8").read() == text, "atlas-format: результат совпал с тем, что создал atlas-grid")
    rc, d = sdk("atlas-info", out)
    check(rc == 0 and [f["name"] for f in d["frames"]][:2] == ["h_0", "h_1"] and len(d["tags"]) == 2
          and d["image"]["exists"] and d["image"]["w"] == 128, "atlas-info: кадры, теги и картинка")
    rc, d = sdk("validate", out)
    check(rc == 0 and d["type"] == "sprite.atlas" and d["errors"] == 0, "validate: тип sprite.atlas, ошибок нет")
    rc, d = sdk("atlas-grid", png, "--out", out, "--cell", "30x30")
    check(rc == 0 and "SDK_ATLAS_GRID_REMAINDER" in codes(d), "atlas-grid: остаток картинки — предупреждение")
    rc, d = sdk("atlas-grid", png, "--out", out, "--cell", "32x32", "--tags", "idle:0-99")
    check(rc == 1 and "SDK_ATLAS_TAG_RANGE" in codes(d), "atlas-grid: тег вне диапазона отвергнут")
    rc, d = sdk("atlas-grid", png, "--out", out)
    check(rc == 2 and "SDK_USAGE" in codes(d), "atlas-grid без сетки — SDK_USAGE")
    rc, d = sdk("atlas-grid", os.path.join(FIX, "нет.png"), "--out", out, "--cell", "8x8")
    check(rc == 2 and "SDK_ATLAS_IMAGE_MISSING" in codes(d), "atlas-grid: нет картинки")
    bad = os.path.join(out_dir, "bad.atlas.json")
    open(bad, "w", encoding="utf-8").write('{"meta":{"image":"../../tests/fixtures/sdk/sprite_proj/hero.png"},"frames":{"far":{"frame":{"x":100,"y":0,"w":64,"h":64}}}}')
    rc, d = sdk("validate", bad)
    check(rc == 1 and "SDK_ATLAS_FRAME_BOUNDS" in codes(d), "validate: кадр за пределами картинки")
    diag = [x for x in d["diagnostics"] if x["code"] == "SDK_ATLAS_FRAME_BOUNDS"][0]
    check(diag["location"]["frame"] == "far" and diag["details"]["image"] == [128, 64], "validate: location и details указывают на кадр и размер картинки")
    shutil.rmtree(out_dir, ignore_errors=True)

    # --- Re2DSprite: re2d-info / re2d-debug / re2d-sample / validate --------------------
    model = os.path.join(ROOT, "tests", "fixtures", "sdk", "re2d_proj", "animal.character.json")
    rc, d = sdk("validate", model)
    check(rc == 0 and d["type"] == "re2dsprite.character" and d["errors"] == 0, "validate: модель Re2DSprite валидна")
    rc, d = sdk("re2d-info", model)
    check(rc == 0 and d["png"]["w"] == 1024 and d["png"]["headerOk"] and d["samples"]["active"] > 100, "re2d-info: PNG v2 и статистика карт")
    check({p["id"]: p["bone"] for p in d["parts"]}.get(91) == "head", "re2d-info: часть 91 принадлежит кости head")
    dbg = os.path.join(ROOT, "build", "sdk_cli_re2d.png")
    rc, d = sdk("re2d-debug", model, "--mode", "part", "--out", dbg, "--scale", "2")
    check(rc == 0 and d["w"] == 512 and d["h"] == 384 and os.path.isfile(dbg), "re2d-debug: PNG вида 512×384 при --scale 2")
    rc, d = sdk("re2d-debug", model, "--mode", "нет", "--out", dbg)
    check(rc == 2 and "SDK_RE2D_MODE" in codes(d), "re2d-debug: неизвестный режим")
    rc, d = sdk("re2d-debug", png, "--mode", "part", "--out", dbg)
    check(rc == 1 and ("SDK_RE2D_PNG_SIZE" in codes(d) or "SDK_RE2D_PNG_HEADER" in codes(d)), "re2d-debug: обычный PNG — не Re2DSprite v2")
    if os.path.exists(dbg):
        os.remove(dbg)
    rc, d = sdk("re2d-sample", model, "--x", "9999", "--y", "0")
    check(rc == 1 and "SDK_RE2D_SAMPLE_RANGE" in codes(d), "re2d-sample: отсчёт вне карты")
    rc, d = sdk("re2d-sample", model, "--x", "0", "--y", "0")
    check(rc == 0 and d["sample"]["coverage"] in (0, 128, 255), "re2d-sample: отсчёт читается")
    rc, d = sdk("re2d-info", png)
    check(rc == 1 and ("SDK_RE2D_PNG_SIZE" in codes(d) or "SDK_RE2D_PNG_HEADER" in codes(d)), "re2d-info: PNG 128×64 — не v2")

    # --- ошибки использования ---------------------------------------------------
    rc, d = sdk("unknown-command")
    check(rc == 2 and "SDK_UNKNOWN_COMMAND" in codes(d), "неизвестная команда — код 2")
    rc, d = sdk("assets")
    check(rc == 2 and "SDK_USAGE" in codes(d), "assets без каталога — SDK_USAGE")

    # --- run / build через движок --------------------------------------------------
    if os.path.isfile(ENGINE):
        rc, d = sdk("run", os.path.join(ROOT, "tests", "fixtures", "hello"), "--headless", "--frames", "3",
                    "--fixed-dt", "0.0166666667", "--engine", ENGINE)
        check(rc == 0 and d["ok"] and d["exitCode"] == 0, "run: игра отработала 3 кадра headless")
        out = os.path.join(ROOT, "build", "sdk_cli_test_game")
        if os.path.exists(out):
            os.remove(out)
        rc, d = sdk("build", os.path.join(ROOT, "tests", "fixtures", "hello"), "--out", out, "--no-encrypt",
                    "--engine", ENGINE)
        check(rc == 0 and d["ok"] and os.path.isfile(out), "build: собран исполняемый файл")
        if os.path.exists(out):
            os.remove(out)
        rc, d = sdk("run", os.path.join(FIX, "proj"), "--engine", os.path.join(ROOT, "build", "нет_движка"))
        check(rc == 2 and "SDK_ENGINE_NOT_FOUND" in codes(d), "run: нет движка — понятная ошибка")
    else:
        print("  skip нет бинарника движка — run/build пропущены")

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
