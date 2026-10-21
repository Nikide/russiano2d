#!/usr/bin/env python3
"""Release ownership: локальный build_and_push — единственный публикатор.

Кодовая база после миграции:
  * релизные бинарники собираются локально (Xmake), а не CI;
  * GitHub Actions — только валидация;
  * релизы на GitHub/GitVerse/hub.mos создаёт tools/release_publish.py;
  * сайт не раздаёт бинарники.

Запуск: python3 tests/release_ownership_test.py
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILURES = []


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


def tracked(*suffixes):
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
    names = out.stdout.splitlines() if out.returncode == 0 else []
    return [n for n in names if n.endswith(suffixes) and exists(n)]


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILURES.append(msg)


def test_single_publisher():
    print("\n== один локальный публикатор, CI не релизит ==")
    check(not exists(".github/workflows/release.yml"),
          "в .github/workflows нет релизного workflow")
    for wf in (".github/workflows/ci.yml", ".github/workflows/quality.yml"):
        text = read(wf)
        check("gh release" not in text and "create-release" not in text,
              "%s не публикует релиз" % wf)
        check("tags:" not in text, "%s не запускается по тегам" % wf)
    publisher = read("tools/release_publish.py")
    for provider in ("GitHub", "GitVerse", "hub.mos"):
        check(provider in publisher, "release_publish.py умеет %s" % provider)
    check('"gh"' in publisher and '"release"' in publisher,
          "GitHub публикуется через gh CLI")
    check("api.gitverse.ru" in publisher, "GitVerse публикуется через его API")
    check("/releases" in publisher and "uploads" in publisher,
          "hub.mos публикуется через GitLab API")

    offenders = []
    for name in tracked(".sh", ".py", ".yml", ".yaml"):
        if name in ("tools/release_publish.py", "tests/release_ownership_test.py"):
            continue
        text = read(name)
        if re.search(r"gh release (create|upload)|create-release@", text):
            offenders.append(name)
    check(not offenders, "других публикаторов релиза нет (%s)" % (", ".join(offenders) or "чисто"))


def test_local_release_scripts():
    print("\n== локальные релизные скрипты ==")
    for name in ("build_and_push", "build_and_push.command", "build_and_push.sh",
                 "push_and_deploy.sh", "site/"):
        in_git = subprocess.run(["git", "ls-files", "--error-unmatch", name],
                                cwd=ROOT, capture_output=True).returncode == 0
        check(not in_git, "%s не отслеживается git" % name)

    build = read("tools/release_build.sh")
    check("xmake" in build.lower(), "release_build.sh использует Xmake")
    check("zig" in build.lower() and "zigcc" in build, "Linux/Windows собираются Zig")
    check("docker" not in build.lower(), "release_build.sh не использует Docker")
    for platform in ("macos-arm64", "macos-x86_64", "linux-x86_64", "windows-x86_64"):
        check(platform in build, "release_build.sh знает %s" % platform)

    tests = read("tools/release_tests.sh")
    check("xmake test" in tests or "ctest" in tests, "release_tests.sh запускает Unity")
    check("python" not in tests.lower(), "release_tests.sh не использует Python-тесты")


def test_dist_contract():
    print("\n== dist и валидация пакетов ==")
    check("def archive_name(" in read("tools/release.py"), "имя архива — release.archive_name()")
    validator = read("tools/ci_package_check.py")
    check("VERSION" in validator and '"editor/main.js"' in validator,
          "валидатор пакета проверяет VERSION и единый Editor")
    check('"r2d",' in validator and '"r2d.exe",' in validator,
          "валидатор пакета требует единственный движковый executable")
    check("__pycache__" in validator and ".DS_Store" in validator,
          "валидатор пакета ловит мусор")


def test_website():
    print("\n== сайт не раздаёт бинарники ==")
    if not exists("site"):
        print("  skip  site/ отсутствует (локальный каталог)")
        return
    index = read("site/index.html")
    check("github.com/Nikide/russiano2d/releases" in index,
          "кнопка скачивания ведёт на GitHub Releases")
    check('href="download/' not in index, "нет локальных ссылок download/")
    sync = read("site/sync-downloads.sh")
    check("ln -sfn" not in sync, "sync-downloads больше не создаёт ссылки на dist")
    build = read("site/build-site.sh")
    check("sync-downloads" in build and "dist" not in build.split("sync-downloads")[-1][:80],
          "сборка сайта не копирует архивы")


def test_publication_boundary():
    print("\n== внутренние доки не публикуются ==")
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import public_docs as pd
    for entry in pd.INTERNAL_DOCS:
        check(not pd.is_site_doc(entry), "внутренний документ не в SITE_DOCS: %s" % entry)
    tracked_names = subprocess.run(["git", "ls-files"], cwd=ROOT,
                                   capture_output=True, text=True).stdout.splitlines()
    prompts = [n for n in tracked_names if re.search(r"prompt[^/]*\.md$", n, re.I)]
    check(not prompts, "промпты не отслеживаются git (%s)" % (", ".join(prompts) or "чисто"))


def main():
    test_single_publisher()
    test_local_release_scripts()
    test_dist_contract()
    test_website()
    test_publication_boundary()
    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for item in FAILURES:
            print("  -", item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
