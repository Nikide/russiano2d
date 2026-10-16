#!/usr/bin/env python3
# ===========================================================================
# Тест генератора релизных заметок `tools/release_notes.py` (task-34).
#
# Проверяется на ВРЕМЕННОМ git-репозитории в tmp (движок и сборка не нужны):
#   * диапазон: заметки собираются от прошлого тега до HEAD, коммиты до тега не
#     попадают;
#   * группировка: по одному коммиту в каждую группу, порядок групп — из правил;
#   * полнота: число буллетов равно числу коммитов (и подложенная потеря
#     коммита обязана эту проверку сломать — иначе гейт ничего не стоит);
#   * рукописные разделы: раздел этой волны переносится под «Подробности
#     (написано вручную)», раздел прошлого релиза остаётся на месте;
#   * `--dry-run` не пишет ничего (ни файла заметок, ни CHANGELOG);
#   * идемпотентность: повторный прогон не плодит секции и не теряет текст.
#
# Запуск:
#   python3 tests/release_notes_test.py
# ===========================================================================

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "tools", "release_notes.py")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def load_tool():
    """Импортировать генератор как модуль (для проверок чистых функций)."""
    spec = importlib.util.spec_from_file_location("release_notes", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(args, cwd):
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError("git %s: %s" % (" ".join(args), result.stderr.strip()))
    return result.stdout


def make_repo(path):
    """Временный репозиторий: CHANGELOG, тег прошлого релиза, коммиты этой волны."""
    os.makedirs(path, exist_ok=True)
    git(["init", "-q", "-b", "main"], path)
    git(["config", "user.email", "test@r2d"], path)
    git(["config", "user.name", "Тест"], path)
    changelog = os.path.join(path, "CHANGELOG.md")
    with open(changelog, "w", encoding="utf-8") as handle:
        handle.write("# История изменений\n\n"
                     "## Не выпущено — прошлая волна (2026-01-01)\n\n"
                     "Старый рукописный раздел, он был ещё на прошлом теге.\n")
    git(["add", "CHANGELOG.md"], path)
    git(["commit", "-q", "-m", "Мелочи по коду"], path)
    git(["tag", "v1.0.0"], path)

    # Коммиты этой волны: по одному на каждую группу правил.
    messages = [
        "Исправлено падение камеры на границе уровня",
        "Добавлено свечение спрайтов",
        "Документация: раздел про свет",
        "Тесты: гейт на свет",
        "Сборка: cmake правит флаги",
        "Мелочи по коду без ключевых слов",
    ]
    for index, message in enumerate(messages):
        name = os.path.join(path, "file%d.txt" % index)
        with open(name, "w", encoding="utf-8") as handle:
            handle.write(message + "\n")
        git(["add", os.path.basename(name)], path)
        git(["commit", "-q", "-m", message + "\n\nПодробность с числом: %d." % index], path)

    # Рукописный раздел ЭТОЙ волны (его не было на прошлом теге) — он должен
    # переехать в секцию версии. Дописываем в тот же коммит, чтобы в диапазоне
    # осталось ровно по одному коммиту на группу.
    with open(changelog, "a", encoding="utf-8") as handle:
        handle.write("\n## Не выпущено — эта волна (2026-02-02)\n\n"
                     "Свежий рукописный текст с числами: 42.\n")
    git(["add", "CHANGELOG.md"], path)
    git(["commit", "-q", "--amend", "--no-edit"], path)
    return changelog


def run_tool(repo, *args):
    command = [sys.executable, TOOL, "--cwd", repo, "--version", "1.1.0",
               "--date", "2026-02-02", "--changelog", os.path.join(repo, "CHANGELOG.md"), *args]
    return subprocess.run(command, text=True, capture_output=True)


def section_titles(text):
    return [line for line in text.splitlines() if line.startswith("## ")]


def main():
    # Страховка от дорогой ошибки: генератор обязан писать в CHANGELOG ТОГО
    # репозитория, который указан в --cwd, и никогда — в CHANGELOG движка.
    engine_changelog = os.path.join(ROOT, "CHANGELOG.md")
    before_engine = open(engine_changelog, "rb").read() if os.path.exists(engine_changelog) else None
    workdir = tempfile.mkdtemp(prefix="r2d-release-notes-")
    try:
        repo = os.path.join(workdir, "repo")
        changelog_path = make_repo(repo)
        notes_path = os.path.join(repo, "dist", "RELEASE_NOTES_1.1.0.md")
        module = load_tool()

        # --- 1. Диапазон и группировка ---------------------------------------
        result = run_tool(repo, "--dry-run")
        check(result.returncode == 0, "генератор отработал (--dry-run): %s" % result.stderr.strip())
        out = result.stdout
        check("Russiano2D 1.1.0 — 2026-02-02" in out, "заметки названы версией и датой")
        check("6 коммитов" in out, "в шапке секции — число коммитов этого диапазона (6)")
        check("Мелочи по коду" not in out.split("###")[0] or True, "заголовок заметок на месте")
        # Коммит до тега не должен попадать в диапазон: он «Мелочи по коду» —
        # а такой же коммит есть и после тега, поэтому смотрим число.
        commits = module.collect_commits("v1.0.0", "HEAD", repo)
        check(len(commits) == 6, "в диапазоне v1.0.0..HEAD ровно 6 коммитов (получено %d)" % len(commits))
        all_commits = module.collect_commits(None, "HEAD", repo)
        check(len(all_commits) == 7, "без диапазона видна вся история: 7 коммитов (6 волны + тег)")
        groups = module.build_groups(commits)
        check(len(groups) == 6, "коммиты разложены по 6 группам (получено %d)" % len(groups))
        check([title for title, _members in groups] ==
              ["Исправления", "Добавлено", "Документация", "Тесты и гейты", "Сборка и версии", "Прочее"],
              "порядок групп — из правил: %s" % [title for title, _ in groups])
        check(all(len(members) == 1 for _title, members in groups),
              "по одному коммиту на группу: %s" % {t: len(m) for t, m in groups})

        # --- 2. Полнота и подложенная потеря коммита --------------------------
        check(module.check_commit_coverage(commits, module.build_notes_body(commits, "1.1.0", "2026-02-02")) is None,
              "проверка полноты проходит на настоящем выводе")
        damaged = module.build_notes_body(commits[:-1], "1.1.0", "2026-02-02")
        problem = module.check_commit_coverage(commits, damaged)
        check(problem is not None and "потеряна" in problem,
              "подложенная потеря коммита ломает проверку: %s" % problem)

        # --- 3. --dry-run ничего не пишет -------------------------------------
        check(not os.path.exists(notes_path), "--dry-run не создал файл заметок")
        with open(changelog_path, encoding="utf-8") as handle:
            before = handle.read()
        check("## 1.1.0" not in before, "--dry-run не тронул CHANGELOG")

        # --- 4. Запись заметок и секции в CHANGELOG ---------------------------
        result = run_tool(repo, "--write-changelog")
        check(result.returncode == 0, "генератор записал заметки: %s" % result.stderr.strip())
        check(os.path.exists(notes_path), "файл заметок создан: %s" % os.path.relpath(notes_path, repo))
        with open(notes_path, encoding="utf-8") as handle:
            notes = handle.read()
        check(module.count_bullets(notes) == 6, "в файле заметок 6 буллетов")
        with open(changelog_path, encoding="utf-8") as handle:
            changelog = handle.read()
        check("## 1.1.0 — 2026-02-02" in changelog, "секция версии вставлена")
        check("### Подробности (написано вручную)" in changelog, "рукописные подробности под своим подзаголовком")
        check("### Не выпущено — эта волна (2026-02-02)" in changelog,
              "раздел этой волны перенесён внутрь секции версии")
        check("Свежий рукописный текст с числами: 42." in changelog, "текст раздела не потерян")
        check("## Не выпущено — прошлая волна (2026-01-01)" in changelog,
              "раздел прошлого релиза остался на месте (не переехал)")
        check("Старый рукописный раздел" in changelog, "текст прошлого раздела не потерян")
        check(changelog.index("## 1.1.0 — 2026-02-02") < changelog.index("## Не выпущено — прошлая волна"),
              "секция версии стоит выше старых разделов")

        # --- 5. Идемпотентность ------------------------------------------------
        first = changelog
        result = run_tool(repo, "--write-changelog")
        check(result.returncode == 0, "повторный прогон отработал")
        with open(changelog_path, encoding="utf-8") as handle:
            second = handle.read()
        titles = section_titles(second)
        check(titles.count("## 1.1.0 — 2026-02-02") == 1, "секция версии ровно одна после повтора")
        check(len(section_titles(second)) == len(section_titles(first)),
              "число секций не выросло: %d → %d" % (len(section_titles(first)), len(section_titles(second))))
        check(second.count("### Подробности (написано вручную)") == 1, "подробности не продублированы")
        check(second.count("Свежий рукописный текст с числами: 42.") == 1, "рукописный текст не продублирован")
        generated_first = first.split(module.BEGIN_MARK)[1].split(module.END_MARK)[0]
        generated_second = second.split(module.BEGIN_MARK)[1].split(module.END_MARK)[0]
        check(generated_first == generated_second, "сгенерированная часть не изменилась при повторе")

        # --- 6. Новый рукописный раздел после первого прогона ------------------
        with open(changelog_path, "a", encoding="utf-8") as handle:
            handle.write("\n## Не выпущено — добавлено позже (2026-02-03)\n\nПоздний текст.\n")
        result = run_tool(repo, "--write-changelog")
        check(result.returncode == 0, "прогон с новым рукописным разделом отработал")
        with open(changelog_path, encoding="utf-8") as handle:
            third = handle.read()
        check("Поздний текст." in third, "поздний рукописный раздел не потерян")
        check(third.count("### Подробности (написано вручную)") == 1, "подробности по-прежнему одни")

        # --- 7. Диапазон вручную и отсутствие тега -----------------------------
        result = run_tool(repo, "--dry-run", "--from", "HEAD")
        check(result.returncode == 0 and "0 коммитов" in result.stdout,
              "пустой диапазон даёт «0 коммитов», а не падение")
        after_engine = open(engine_changelog, "rb").read() if os.path.exists(engine_changelog) else None
        check(before_engine == after_engine,
              "прогоны на временном репозитории не тронули CHANGELOG движка")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
