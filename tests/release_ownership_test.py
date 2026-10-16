#!/usr/bin/env python3
# ===========================================================================
# Владение сборками и релизами — проверяется по скриптам, а не по обещаниям.
#
# RUSSIANO2D_PRODUCTION_POLISH.md §4.6–§4.9 и §66 требуют жёсткого разделения:
#
#   * Windows и Linux собирает только GitHub Actions;
#   * macOS собирается только локально на рабочем Mac;
#   * GitHub Release создаёт ровно один владелец — CI по тегу vX.Y.Z;
#   * локальный deployment-скрипт не собирает Linux, не дублирует CI и не
#     создаёт релизы;
#   * имя артефакта релиза собирается в одном месте (release.archive_name) и
#     содержит версию.
#
# Проверка читает сами скрипты: если кто-то снова добавит в build_and_push.sh
# сборку Linux «на всякий случай» или `gh release create` в shell-скрипт,
# прогон станет красным.
#
# Запуск:
#   python3 tests/release_ownership_test.py
# ===========================================================================

import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW = ".github/workflows/build.yml"
LOCAL_SCRIPTS = ("build_and_push.sh", "push_and_deploy.sh")

#: Платформы, сборка которых — ответственность CI, а не локальной машины.
CI_ONLY_PLATFORMS = ("linux-x86_64", "linux-aarch64", "windows-x86_64")

#: Файл самой проверки: искомая строка встречается в нём по необходимости —
#: он её и ищет. Из сканирования исключается, иначе гейт краснеет на себе.
SELF = "tests/release_ownership_test.py"

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8", errors="replace") as handle:
        return handle.read()


def exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


def tracked(*suffixes):
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines()
    return [n for n in out if n.endswith(suffixes)]


def test_single_release_owner():
    print("\n== §4.8: единственный владелец GitHub Release ==")
    offenders = []
    for name in tracked(".sh", ".py", ".yml", ".yaml", ".js", ".mjs"):
        if name.startswith("dist/") or name == SELF:
            continue
        text = read(name)
        for num, line in enumerate(text.splitlines(), 1):
            if re.search(r"\bgh\s+release\s+create\b", line):
                offenders.append("%s:%d" % (name, num))
    check(bool(offenders) and all(o.startswith(WORKFLOW) for o in offenders),
          "релиз создаёт только %s (найдено: %s)" % (WORKFLOW, ", ".join(offenders) or "ничего"))
    check(bool(offenders), "workflow действительно создаёт релиз (иначе релиза не будет вовсе)")

    workflow = read(WORKFLOW)
    check("--verify-tag" in workflow,
          "релиз создаётся с --verify-tag (тег обязан существовать)")
    check(re.search(r"gh release view[^\n]*>\s*/dev/null", workflow) is not None,
          "повторный прогон не создаёт второй релиз (сначала проверяется наличие)")


def test_workflow_ownership():
    print("\n== §4.5–4.6: что собирает GitHub Actions ==")
    workflow = read(WORKFLOW)
    runners = re.findall(r"runner:\s*([\w\-.]+)", workflow)
    platforms = re.findall(r"platform:\s*([\w\-.]+)", workflow)
    # Windows-артефакт приходит из hosted-раннера кросс-сборкой MinGW: MSVC
    # 14.44 падает внутренней ошибкой CL.exe, а платформа нужна (подробности —
    # в комментарии у матрицы и в docs/RELEASING.md). Родная MSVC-сборка
    # остаётся в workflow необязательной задачей-наблюдением, иначе про ошибку
    # тулчейна никто не вспомнит.
    check("windows-x86_64" in platforms and bool(runners),
          "Windows x86_64 собирается hosted-раннером (платформы %s, раннеры %s)"
          % (platforms, runners))
    check("x86_64-w64-mingw32-gcc" in workflow,
          "Windows собирается кросс-сборкой MinGW (тулчейн назван в workflow)")
    check("windows-msvc-diagnostic" in workflow and "continue-on-error: true" in workflow,
          "наблюдение за MSVC осталось, но не блокирует релиз")
    check(not any("windows-" in r for r in runners),
          "Windows не занимает hosted Windows-раннер в обязательных задачах (%s)" % runners)
    check("linux-x86_64" in platforms and "linux-aarch64" in platforms,
          "Linux x86_64 и aarch64 оба в матрице (%s)" % platforms)
    check(not any("macos" in r.lower() for r in runners + platforms),
          "macOS не дублируется hosted-раннером (%s)" % (runners + platforms))

    # Тег обязан совпадать с версией проекта — гейт стоит один раз, в static.
    check("read_version()" in workflow and "GITHUB_REF_NAME" in workflow,
          "workflow сверяет тег с версией проекта")
    check(re.search(r"release:[\s\S]{0,400}?needs:\s*\[[^\]]*build", workflow) is not None,
          "релиз зависит от успешной сборки (провал gate не публикует релиз)")

    # Суммы считаются по явному списку: `sha256sum *` захватил бы сам файл сумм.
    check(re.search(r"sha256sum\s+\.?/?\*?\.?/?\*\.tar\.gz", workflow) is not None
          or "sha256sum ./*.tar.gz" in workflow,
          "SHA256SUMS.txt считается по архивам, а не по маске `*`")
    check("SHA256SUMS.txt" in workflow, "workflow публикует SHA256SUMS.txt")


def test_local_scripts_do_not_duplicate_ci():
    print("\n== §4.7: локальные скрипты не дублируют CI ==")
    # Скрипты выпуска — локальные: они собирают macOS на рабочей машине и
    # публикуют сайт, в публичные репозитории не уезжают (.gitignore). Гейт
    # поэтому проверяет две вещи: их НЕТ в git и, если файл есть на диске, он
    # не собирает чужие платформы и не создаёт релизы.
    for name in LOCAL_SCRIPTS:
        in_git = subprocess.run(["git", "ls-files", "--error-unmatch", name],
                                cwd=ROOT, capture_output=True).returncode == 0
        check(not in_git, "%s не отслеживается git (локальный выпуск)" % name)
        if not exists(name):
            continue
        text = read(name)
        check("gh release" not in text,
              "%s не создаёт и не трогает GitHub Release" % name)
        check(not re.search(r"linux|mingw|windows", text, re.I)
              or re.search(r"не собирает|отвергаются|CI\b", text) is not None,
              "%s упоминает Linux/Windows только как чужую ответственность" % name)

    # Любой вызов autobuild.py в локальных скриптах обязан быть macOS-only.
    for name in LOCAL_SCRIPTS:
        if not exists(name):
            continue
        text = read(name)
        for num, line in enumerate(text.splitlines(), 1):
            if "tools/autobuild.py" not in line:
                continue
            bad = [p for p in CI_ONLY_PLATFORMS if p in line]
            check(not bad,
                  "%s:%d собирает локально только macOS (в строке: %s)"
                  % (name, num, ", ".join(bad) or "macOS"))

    if not exists("build_and_push.sh"):
        return
    build = read("build_and_push.sh")
    check("macos-arm64,macos-x86_64" in build or "macos-arm64,macos-x86_64" in build,
          "build_and_push.sh по умолчанию собирает macOS-профили")
    check("PLATFORMS" in build and "exit 1" in build,
          "build_and_push.sh отвергает не-macOS платформу, а не собирает её")


def test_artifact_name_contract():
    print("\n== §4.9/§58: контракт имени артефакта ==")
    release_py = read("tools/release.py")
    check("def archive_name(" in release_py, "имя артефакта собирается в release.archive_name()")
    check('"russiano2d-v%s-%s.%s"' in release_py,
          "имя артефакта содержит версию проекта")
    check("def prune_stale_archives(" in release_py,
          "старые имена архивов той же платформы удаляются")

    # Никто не склеивает имя архива вручную: только через контракт.
    offenders = []
    for name in tracked(".py", ".sh"):
        if name.startswith("dist/") or name in ("tools/release.py", SELF):
            continue
        for num, line in enumerate(read(name).splitlines(), 1):
            if re.search(r"""russiano2d-['"]?\s*[%+]""", line):
                offenders.append("%s:%d" % (name, num))
    check(not offenders,
          "имя архива не собирается вручную вне release.py (%s)"
          % (", ".join(offenders) or "чисто"))
    for name in ("tools/ci_package.py", "tools/agents_doc.py",
                 "tools/attach_macos_release.py", "tools/fetch_release_assets.py"):
        check("archive_name(" in read(name), "%s использует контракт имени" % name)


def test_other_host_pipelines():
    print("\n== Mos.Hub и GitVerse: Linux/Windows собирают они, macOS — из dist/ ==")
    gitlab = read(".gitlab-ci.yml")
    gitverse = read(".gitverse/workflows/build.yaml")

    # GitLab (Mos.Hub) — .gitlab-ci.yml.
    check("linux-x86_64:" in gitlab and "windows-x86_64:" in gitlab,
          "GitLab собирает Linux x86_64 и Windows x86_64")
    check("mingw-w64" in gitlab, "Windows на GitLab собирается кросс-сборкой MinGW")
    # Кросс-сборка не умеет собрать glslang/spirv-cross для хоста — CMake
    # останавливается с «для кросс-сборки нужны хост-инструменты». Проверено
    # запуском job'а в контейнере: без этих пакетов конфигурация не проходит.
    check("glslang-tools" in gitlab and "spirv-cross" in gitlab,
          "для кросс-сборки на GitLab ставятся хост-инструменты шейдеров")
    check("macos-artifacts:" in gitlab and "dist/russiano2d-v" in gitlab,
          "macOS на GitLab НЕ собирается, а берётся из витрины dist/")
    check(re.search(r"macos-\d|macos-latest|macos-arm64:", gitlab) is None,
          "в .gitlab-ci.yml нет сборки macOS")
    check("release:" in gitlab and "needs: [linux-x86_64, windows-x86_64, macos-artifacts]" in gitlab,
          "релиз GitLab зависит от всех трёх наборов артефактов")
    check("$CI_COMMIT_TAG =~" in gitlab, "релиз GitLab создаётся только по тегу vX.Y.Z")

    # GitVerse — свой формат (.gitverse/workflows/), .gitlab-ci.yml он не читает.
    check("runs-on: ubuntu-latest" in gitverse, "GitVerse использует облачный раннер ubuntu-latest")
    check("linux-x86_64:" in gitverse and "windows-x86_64:" in gitverse,
          "GitVerse собирает Linux x86_64 и Windows x86_64")
    check("mingw-w64" in gitverse, "Windows на GitVerse собирается кросс-сборкой MinGW")
    check("glslang-tools" in gitverse and "spirv-cross" in gitverse,
          "для кросс-сборки на GitVerse ставятся хост-инструменты шейдеров")
    check("macos-artifacts:" in gitverse and "dist/russiano2d-v" in gitverse,
          "macOS на GitVerse НЕ собирается, а берётся из витрины dist/")
    check(re.search(r"macos-\d|macos-latest", gitverse) is None,
          "в workflow GitVerse нет сборки macOS")
    check("actions/create-release@v1" in gitverse and "GITVERSE_API_KEY" in gitverse,
          "релиз GitVerse создаётся экшеном create-release (нужен секрет GITVERSE_API_KEY)")
    check("refs/tags/" in gitverse, "релиз GitVerse создаётся только по тегу")

    # Оба пайплайна обязаны собирать Windows без macOS-раннеров и с проверкой версии.
    for name, text in ((".gitlab-ci.yml", gitlab), (".gitverse/workflows/build.yaml", gitverse)):
        check("read_version()" in text, "%s сверяет версию проекта" % name)
        check("ci_package.py" in text, "%s упаковывает тем же кодом, что и остальные" % name)


def test_macos_attachment_is_documented():
    print("\n== §4.7 шаг 5: macOS прикладывается к релизу CI ==")
    attach = read("tools/attach_macos_release.py")
    check("release create" not in attach and "gh release create" not in attach,
          "шаг прикладывания macOS не создаёт релиз")
    check("SHA256SUMS.txt" in attach, "шаг прикладывания пересчитывает SHA256SUMS.txt")
    check("--clobber" in attach, "архивы заменяются в релизе, а не падают на дубликате")
    releasing = read("docs/RELEASING.md")
    check("attach_macos_release.py" in releasing, "шаг описан в docs/RELEASING.md")
    check("fetch_release_assets.py" in releasing,
          "перенос артефактов CI в dist/ тоже описан")


def main():
    test_single_release_owner()
    test_workflow_ownership()
    test_local_scripts_do_not_duplicate_ci()
    test_artifact_name_contract()
    test_other_host_pipelines()
    test_macos_attachment_is_documented()
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
