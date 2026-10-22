#!/usr/bin/env python3
"""Одиночный бинарник: без соседних docs/, editor/, templates/, assets/ и game/.

Релизный пакет — это r2d (+ README/AGENTS/схема). Всё остальное вшито в него
(tools/embed_bundle.py), поэтому копия бинарника в пустом каталоге обязана:
отдавать документацию, перечислять и разворачивать шаблоны проектов и рисовать
текст игры встроенными шрифтами.

    R2D_BINARY=build-xmake/macos-arm64/macosx/arm64/release/r2d python3 tests/standalone_binary_test.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("R2D_BINARY") or ROOT / "build-xmake/macos-arm64/macosx/arm64/release/r2d")
failures = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        failures.append(message)


def run(args, cwd, env, timeout=120):
    return subprocess.run([str(cwd / BINARY.name)] + args, cwd=cwd, env=env, capture_output=True,
                          text=True, timeout=timeout)


def main():
    if not BINARY.is_file():
        print("нужен R2D_BINARY (собранный r2d): %s" % BINARY)
        return 2
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "bin"
        work.mkdir()
        shutil.copy2(BINARY, work / BINARY.name)
        home = Path(tmp) / "home"      # кэш шаблонов (SDL_GetPrefPath) уходит сюда, а не в профиль
        home.mkdir()
        env = dict(os.environ, HOME=str(home), XDG_DATA_HOME=str(home), APPDATA=str(home), LOCALAPPDATA=str(home))
        for stale in ("docs", "editor", "templates", "assets", "game"):
            check(not (work / stale).exists(), "рядом с бинарником нет %s/" % stale)

        doc = run(["docs", "show", "AGENT_API"], work, env)
        check(doc.returncode == 0 and '"ok":true' in doc.stdout, "docs show читает страницу из бинарника")

        tpl = run(["templates"], work, env)
        data = json.loads(tpl.stdout) if tpl.stdout.strip().startswith("{") else {}
        ids = [t.get("id") for t in data.get("templates", [])]
        check(tpl.returncode == 0 and "blank" in ids, "templates берёт шаблоны из бинарника (%s)" % ids)

        proj = work / "proj"
        new = run(["new", "blank", str(proj), "--name", "Проба"], work, env)
        check(new.returncode == 0 and (proj / "project.json").is_file() and (proj / "main.js").is_file(),
              "new blank разворачивает проект без templates/ рядом")
        check("Проба" in (proj / "project.json").read_text(encoding="utf-8"), "в project.json подставлено имя проекта")

        again = run(["new", "blank", str(Path(tmp) / "proj2")], work, env)
        check(again.returncode == 0, "повторный new работает с уже распакованным кэшем шаблонов")

        game = run(["--game", str(proj), "--headless", "--frames", "5"], work, env)
        log = game.stdout + game.stderr
        check(game.returncode == 0, "игра запускается и завершается (код %d)" % game.returncode)
        check("встроенный шрифт" in log, "шрифты RmlUi берутся из бинарника")
        check("текст не будет отрисован" not in log, "нет предупреждения об отсутствующих шрифтах")
        check("иконка не найдена" not in log, "иконка окна берётся из бинарника")
    print()
    if failures:
        print("FAILED: %d" % len(failures))
        return 1
    print("OK: одиночный бинарник")
    return 0


if __name__ == "__main__":
    sys.exit(main())
