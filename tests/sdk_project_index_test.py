#!/usr/bin/env python3
# ===========================================================================
# `r2d project-index`: editor.graph в project.json (docs/PROJECT_JSON.md).
#
# Критерии готовности ТЗ, которые проверяет этот тест:
#   * пример со сценой, <player>, <sprite>, .sprite() и .appendTo() индексируется;
#   * сцена — регистрация, а не пространственный родитель;
#   * .sprite(path) на объекте — ресурсная связь, а не фиктивный дочерний <sprite>;
#   * ручные и неизвестные поля, origin:"graph" и views переживают пересборку;
#   * без изменений кода — пустой diff, без временных меток;
#   * динамический код даёт partial, а не выдуманную структуру;
#   * устаревший индекс виден в validate (R2D206) и в --check.
#
# Запуск: R2D_BINARY=/path/to/r2d python3 tests/sdk_project_index_test.py
# ===========================================================================
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
R2D = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "r2d"))
FAILURES = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILURES.append(msg)


def run(*args):
    p = subprocess.run([R2D, *args], capture_output=True, text=True, timeout=60)
    try:
        return p.returncode, json.loads(p.stdout)
    except ValueError:
        return p.returncode, {"raw": p.stdout, "err": p.stderr}


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


MAIN = """$.scene.add('game', () => {
    const hero = $('<player>', { id: 'hero' })
        .at(100, 200)
        .appendTo($.world);

    $('<sprite>', { id: 'hero_body' })
        .sprite('art/hero.png')
        .appendTo(hero);

    $('<particles>', { id: 'smoke' })
        .appendTo(hero);

    hero.sprite('art/hero.png');
});
"""

MANIFEST = {
    "schema_version": 2,
    "project": {"name": "Index", "version": "0.1.0"},
    "runtime": {"entry": "main.js", "start_scene": "game"},
    "custom": {"keep": [1, 2, 3]},
}


def graph(root):
    with open(os.path.join(root, "project.json"), encoding="utf-8") as f:
        return json.load(f)["editor"]["graph"]


def main():
    with tempfile.TemporaryDirectory(prefix="r2d-index-") as tmp:
        write(os.path.join(tmp, "main.js"), MAIN)
        write(os.path.join(tmp, "art", "hero.png"), "png")
        write(os.path.join(tmp, "project.json"), json.dumps(MANIFEST))

        rc, out = run("project-index", tmp)
        check(rc == 0 and out.get("changed") is True and out.get("written") is False,
              "без --write ничего не пишет (%s)" % {k: out.get(k) for k in ("changed", "written")})
        check("editor" not in json.load(open(os.path.join(tmp, "project.json"))), "project.json не тронут")

        rc, out = run("project-index", tmp, "--write")
        check(rc == 0 and out.get("written") is True and out.get("status") == "current",
              "--write записывает актуальный граф (%s)" % out.get("status"))
        g = graph(tmp)
        ents = {e["key"]: e for e in g["entities"]}
        edges = {(e["type"], e["from"], e["to"]): e for e in g["edges"]}

        check("scene:game" in ents and ents["scene:game"]["type"] == "scene", "сцена game найдена")
        check(ents["object:hero"].get("tag") == "player" and ents["object:hero"].get("public_id") == "hero",
              "<player> #hero с тегом и id")
        check(("scene_registration", "script:main.js", "scene:game") in edges,
              "сцена — регистрация из скрипта")
        check(not any(e["type"] == "spatial_parent" and e["from"] == "scene:game" for e in g["edges"])
              and not any(e["type"] == "spatial_parent" and e["to"] == "scene:game" for e in g["edges"]),
              "сцена не пространственный родитель")
        check(("spatial_parent", "world:game", "object:hero") in edges, "hero → $.world через appendTo")
        check(("spatial_parent", "object:hero", "object:hero_body") in edges
              and ("spatial_parent", "object:hero", "object:smoke") in edges,
              "hero_body и smoke — дети hero")
        check(("uses_resource", "object:hero_body", "resource:art/hero.png") in edges,
              "<sprite> #hero_body → art/hero.png")
        check(("uses_resource", "object:hero", "resource:art/hero.png") in edges
              and not [e for e in g["entities"] if e.get("tag") == "sprite" and e.get("public_id") != "hero_body"],
              "hero.sprite(path) — связь с ресурсом, без фиктивного дочернего <sprite>")
        world = [a for a in g["areas"] if a["key"] == "world:game"]
        check(world and world[0]["type"] == "world" and world[0]["scene"] == "scene:game"
              and world[0]["runtime_root"] == "$.world", "область World привязана к сцене")
        check(any(a["type"] == "entity" and a["entity"] == "object:hero" for a in g["areas"]),
              "составной объект открывается как область")
        check(all("kind" not in e for e in g["entities"]), "в схеме нет поля kind")
        check(all(e["origin"] == "code" and "line" in e["evidence"] for e in g["edges"]),
              "каждое ребро несёт origin и evidence")

        before = open(os.path.join(tmp, "project.json"), encoding="utf-8").read()
        rc, out = run("project-index", tmp, "--write")
        after = open(os.path.join(tmp, "project.json"), encoding="utf-8").read()
        check(out.get("changed") is False and before == after, "повторный индекс не даёт diff")
        check(json.load(open(os.path.join(tmp, "project.json")))["custom"] == {"keep": [1, 2, 3]},
              "неизвестные поля сохранены")
        rc, out = run("project-index", tmp, "--check")
        check(rc == 0, "--check на свежем индексе чист")

        # Пользовательские записи и раскладка переживают пересборку.
        data = json.load(open(os.path.join(tmp, "project.json"), encoding="utf-8"))
        data["editor"]["graph"]["views"] = {"overview": {"layout": {"x": 1}}}
        data["editor"]["graph"]["entities"].append(
            {"key": "object:mine", "area": "world:game", "type": "object", "origin": "graph", "tag": "npc"})
        write(os.path.join(tmp, "project.json"), json.dumps(data))
        with open(os.path.join(tmp, "main.js"), "a", encoding="utf-8") as f:
            f.write("// правка\n")
        rc, out = run("validate", tmp)
        check(any(d["code"] == "R2D206" for d in out.get("diagnostics", [])), "изменённый код → R2D206 (устарел)")
        rc, out = run("project-index", tmp, "--check")
        check(rc == 1, "--check на устаревшем индексе → код 1")
        run("project-index", tmp, "--write")
        g = graph(tmp)
        check(g["views"] == {"overview": {"layout": {"x": 1}}}, "views сохранены")
        check(any(e["key"] == "object:mine" and e["origin"] == "graph" for e in g["entities"]),
              "записи origin:graph сохранены")
        rc, out = run("validate", tmp)
        check(out.get("errors") == 0 and not any(d["code"] == "R2D206" for d in out["diagnostics"]),
              "после индекса validate без R2D206 (%s)" % [d["code"] for d in out["diagnostics"]])

        # Динамика: partial вместо выдуманной структуры.
        write(os.path.join(tmp, "dyn.js"),
              "for (let i = 0; i < 3; i++) $('<enemy>').appendTo($.world);\n"
              "$('<' + kind + '>').appendTo($.world);\n"
              "const w = $('<wall>', { id: 'w1' });\n"
              "w.appendTo(pickParent());\n")
        rc, out = run("project-index", tmp, "--write")
        g = graph(tmp)
        codes = sorted(d["code"] for d in g["diagnostics"])
        check(g["status"] == "partial" and "R2D302" in codes and codes.count("R2D301") >= 2,
              "динамический код → partial (%s)" % codes)
        check(not any(e.get("tag") == "'<'" for e in g["entities"]), "динамический тег не добавлен в граф")
        check(not any(e["to"] == "object:w1" and e["type"] == "spatial_parent" for e in g["edges"]),
              "нестатический родитель не превращается в связь")

        # project-set: настройки без переформатирования графа.
        before = open(os.path.join(tmp, "project.json"), encoding="utf-8").read()
        rc, out = run("project-set", tmp, "runtime.window.width=800", 'project.name="Новое имя"')
        after = open(os.path.join(tmp, "project.json"), encoding="utf-8").read()
        d = json.load(open(os.path.join(tmp, "project.json"), encoding="utf-8"))
        check(rc == 0 and out.get("applied") == 2 and d["runtime"]["window"]["width"] == 800 and d["project"]["name"] == "Новое имя",
              "project-set записывает настройки")
        check(json.dumps(d["editor"], sort_keys=True) == json.dumps(json.loads(before)["editor"], sort_keys=True)
              and d["custom"] == {"keep": [1, 2, 3]}, "project-set не трогает граф и неизвестные поля")
        check([l for l in before.splitlines() if "\"key\"" in l] == [l for l in after.splitlines() if "\"key\"" in l],
              "строки графа в файле не переформатированы")
        rc, out = run("project-set", tmp, "runtime.window.width=")
        check(rc == 0 and "width" not in json.load(open(os.path.join(tmp, "project.json")))["runtime"].get("window", {}),
              "пустое значение удаляет поле")
        rc, out = run("project-set", tmp, 'editor.graph.status="x"')
        check(rc == 1 and any(d["code"] == "R2D210" for d in out["diagnostics"]), "граф через project-set менять нельзя (R2D210)")
        keep = open(os.path.join(tmp, "project.json"), encoding="utf-8").read()
        rc, out = run("project-set", tmp, 'runtime.window.width="wide"')
        check(rc == 1 and open(os.path.join(tmp, "project.json"), encoding="utf-8").read() == keep,
              "неверное значение отвергнуто, файл не изменён")

        # Манифест без schema_version: индекс отказывается, ничего не переписывая.
        legacy = os.path.join(tmp, "legacy")
        write(os.path.join(legacy, "project.json"), '{"title": "x"}')
        write(os.path.join(legacy, "main.js"), "$.ready(() => {});\n")
        rc, out = run("project-index", legacy, "--write")
        check(rc == 1 and any(d["code"] == "R2D207" for d in out["diagnostics"]), "плоский манифест → R2D207")
        check(open(os.path.join(legacy, "project.json")).read() == '{"title": "x"}', "плоский манифест не переписан")

        # Повреждённый JS не ломает манифест.
        broken = os.path.join(tmp, "broken")
        write(os.path.join(broken, "project.json"), json.dumps(MANIFEST))
        write(os.path.join(broken, "main.js"), "$('<player>', { id: 'x' }.appendTo($.world\n")
        rc, out = run("project-index", broken, "--write")
        json.load(open(os.path.join(broken, "project.json")))
        check(rc == 0 and graph(broken)["status"] == "partial", "незакрытые скобки → partial, JSON цел")

        # r2d new сразу индексирует.
        dest = os.path.join(tmp, "fresh")
        templates = os.path.join(ROOT, "templates")
        rc, out = run("new", "blank", dest, "--name", "Свежий", "--root", templates)
        fresh = json.load(open(os.path.join(dest, "project.json"), encoding="utf-8"))
        check(rc == 0 and fresh.get("schema_version") == 2 and fresh["editor"]["graph"]["status"] == "current",
              "новый проект: schema_version 2 и готовый граф")
        rc, out = run("validate", dest)
        check(out.get("errors") == 0 and not out.get("diagnostics"), "новый проект проходит validate")

    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
