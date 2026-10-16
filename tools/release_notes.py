#!/usr/bin/env python3
# ===========================================================================
# Релизные заметки из коммитов диапазона (запрос пользователя: «пусть build and
# push формирует ченжлог из сборника коммитов для релиза»).
#
# Зачем: коммиты уже содержат подробные сообщения с числами, а CHANGELOG
# приходилось писать руками — и он расходился с историей. Здесь заметки
# собираются из `git log <предыдущий тег>..HEAD` и вставляются секцией в
# CHANGELOG; рукописные разделы «Не выпущено» при этом НЕ теряются — они
# переезжают под «### Подробности (написано вручную)» внутрь той же секции.
#
# Использование:
#   python3 tools/release_notes.py --dry-run            # показать, ничего не писать
#   python3 tools/release_notes.py                      # dist/RELEASE_NOTES_<версия>.md
#   python3 tools/release_notes.py --write-changelog    # + секция в CHANGELOG.md
#   python3 tools/release_notes.py --from v0.1.35 --version 1.2.0 --date 2026-10-16
#
# Гарантии (их проверяет tests/release_notes_test.py):
#   * ни один коммит диапазона не теряется: каждый попадает ровно в одну группу,
#     а число буллетов в заметках равно числу коммитов (check_commit_coverage);
#   * повторный прогон идемпотентен: сгенерированная часть секции лежит между
#     маркерами и перезаписывается, рукописная — не трогается;
#   * `--dry-run` не пишет ничего.
# ===========================================================================

import argparse
import datetime
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Заголовок CHANGELOG, под которым вставляется секция версии.
CHANGELOG_TITLE = "# История изменений"

#: Маркеры сгенерированной части. Всё, что между ними, — машинное; всё, что вне
#: (в том числе «Подробности (написано вручную)»), генератор не трогает.
BEGIN_MARK = "<!-- release-notes:begin — генерируется tools/release_notes.py, правьте текст вне маркеров -->"
END_MARK = "<!-- release-notes:end -->"

#: Правила группировки: ПЕРВОЕ совпадение выигрывает, поэтому каждый коммит
#: попадает ровно в одну группу (ни потерь, ни дублей). Порядок правил — часть
#: решения: «Исправления» важнее «Добавлено» (фикс с числом — это фикс), а
#: «Прочее» забирает остаток и должен оставаться последним.
#:
#: Ключевые слова — НАЧАЛО слова (не подстрока в любом месте): иначе «нов»
#: ловил бы «обновлять», а «ci» — «precision». Сопоставление идёт сначала по
#: ТЕМЕ коммита и только потом по телу: в теле живёт фон («попутно исправлена
#: устаревшая строка»), из-за которого коммит про целую новую подсистему уезжал
#: в «Исправления».
GROUP_RULES = (
    ("Исправления", ("исправ", "фикс", "регресс", "краш", "падал", "ломал")),
    ("Добавлено", ("добав", "нов", "подключ", "внедр", "комплект", "реализ", "появил")),
    ("Удалено и изменено", ("удал", "выпил", "deprecat", "ломающ", "убрано из")),
    ("Документация", ("док", "changelog", "readme", "справочник")),
    ("Тесты и гейты", ("тест", "гейт", "ci", "заморозк")),
    ("Сборка и версии", ("версия", "сборк", "release", "cmake", "скрипт",
                         "пайплайн", "workflow", "упаков", "архив")),
    ("Прочее", ()),
)

#: Группа-приёмник для коммитов, не подошедших ни под одно правило.
FALLBACK_GROUP = GROUP_RULES[-1][0]

#: Сколько строк тела коммита попадает в ПОДРОБНУЮ форму (заметки — не простыня).
BODY_LIMIT = 12

#: Группы, у которых тело коммита вообще уместно в секции CHANGELOG. Для файла
#: заметок тела не выводятся никогда: это витрина для страницы релиза, её читают
#: глазами, а не ищут в ней подробности.
BODY_GROUPS = ("Исправления", "Добавлено")

#: Режимы вывода:
#:   compact   — только тема и короткий хеш, одна строка на коммит (файл заметок);
#:   changelog — тела у BODY_GROUPS, у остальных групп только тема и хеш (CHANGELOG);
#:   full      — тела у всех (флаг --full: «как было», для разбора полётов).
MODE_COMPACT = "compact"
MODE_CHANGELOG = "changelog"
MODE_FULL = "full"

#: Длина строки тела в заметках: длинные абзацы подрезаются.
BODY_LINE_LIMIT = 220


def git(args, cwd=None):
    """Вызов git с проверкой кода возврата — молчаливых ошибок быть не должно."""
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError("git %s: %s" % (" ".join(args), (result.stderr or "").strip()))
    return result.stdout


def project_version():
    """Версия из tools/release.py (единственный источник правды о номере)."""
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import release  # noqa: E402  (локальный импорт: нужен ROOT)
    return release.read_version()


def previous_tag(cwd=None):
    """Предыдущий релизный тег (vX.Y.Z), достижимый из HEAD, или None."""
    try:
        return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"], cwd).strip() or None
    except RuntimeError:
        return None


def collect_commits(from_ref=None, to_ref="HEAD", cwd=None):
    """Коммиты диапазона: `[{hash, subject, body}]`, без merge-коммитов.

    Без `from_ref` диапазон начинается от предыдущего тега; если тегов нет —
    берётся вся история (первый выпуск).
    """
    span = "%s..%s" % (from_ref, to_ref) if from_ref else to_ref
    raw = git(["log", span, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e"], cwd)
    commits = []
    for record in raw.split("\x1e"):
        record = record.strip("\n")
        if not record.strip():
            continue
        parts = record.split("\x1f")
        commit_hash = parts[0].strip()
        subject = parts[1].strip() if len(parts) > 1 else ""
        body = parts[2].strip() if len(parts) > 2 else ""
        commits.append({"hash": commit_hash, "subject": subject, "body": body})
    return commits


def keyword_matches(keyword, text):
    """Ключевое слово ищется с НАЧАЛА слова: «нов» не должен ловить «обновлять»."""
    return re.search(r"(?<![0-9A-Za-zА-Яа-яЁё])" + re.escape(keyword), text) is not None


def group_of(commit):
    """Группа коммита: сначала ТОЛЬКО тема, тело — лишь если тема не совпала.

    Тема — это то, о чём коммит; тело — подробности, где рядом с делом лежит фон
    («попутно исправлена устаревшая строка»). Поэтому «Комплект шумов: $.noise»
    — это «Добавлено», а не «Исправления», хотя слово «исправлена» в теле есть.
    """
    subject = commit["subject"].lower()
    for title, keywords in GROUP_RULES:
        if keywords and any(keyword_matches(keyword, subject) for keyword in keywords):
            return title
    body = commit["body"].lower()
    for title, keywords in GROUP_RULES:
        if not keywords:
            return title
        if any(keyword_matches(keyword, body) for keyword in keywords):
            return title
    return FALLBACK_GROUP


def body_lines(commit):
    """Строки тела для заметок: непустые, подрезанные, не больше BODY_LIMIT."""
    lines = []
    for line in commit["body"].splitlines():
        text = line.strip()
        if not text:
            continue
        if len(text) > BODY_LINE_LIMIT:
            text = text[:BODY_LINE_LIMIT - 1].rstrip() + "…"
        lines.append(text)
        if len(lines) >= BODY_LIMIT:
            lines.append("…")
            break
    return lines


def build_groups(commits):
    """Сгруппированные коммиты в порядке GROUP_RULES (пустые группы не выводятся)."""
    groups = []
    for title, _keywords in GROUP_RULES:
        members = [commit for commit in commits if group_of(commit) == title]
        if members:
            groups.append((title, members))
    return groups


def show_body(title, mode):
    """Нужно ли печатать тело коммита в этой группе при таком режиме."""
    if mode == MODE_FULL:
        return True
    if mode == MODE_CHANGELOG:
        return title in BODY_GROUPS
    return False


def build_notes_body(commits, version, date, mode=MODE_COMPACT, indent=""):
    """Тело секции: «<N> коммитов» + группы с буллетами (без заголовка версии).

    Один буллет на коммит — в любом режиме: это и есть проверка «ничего не
    потерялось» (tests/release_notes_test.py).
    """
    groups = build_groups(commits)
    lines = ["%s%d %s в релизе." % (indent, len(commits), plural(len(commits), "коммит", "коммита", "коммитов")),
             ""]
    for title, members in groups:
        lines.append("%s### %s" % (indent, title))
        lines.append("")
        for commit in members:
            lines.append("%s- %s (`%s`)" % (indent, commit["subject"], commit["hash"][:9]))
            if show_body(title, mode):
                for line in body_lines(commit):
                    lines.append("%s  %s" % (indent, line))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_notes(commits, version, date, mode=MODE_COMPACT):
    """Полный текст файла заметок (он же прикладывается к релизу).

    По умолчанию — компактная форма: страница релиза это витрина, а не зеркало
    `git log`. Подробности — флагом `--full` или в секции CHANGELOG.
    """
    header = "# Russiano2D %s — %s\n\n" % (version, date)
    return header + build_notes_body(commits, version, date, mode)


def count_bullets(text):
    """Сколько буллетов верхнего уровня в сгенерированном тексте."""
    return sum(1 for line in text.splitlines() if line.startswith("- "))


def check_commit_coverage(commits, generated_text):
    """Проверка «ни один коммит не потерян и не продублирован».

    Возвращает текст ошибки или None. Тест зовёт её и на здоровом выводе, и на
    намеренно испорченном (подложенная потеря коммита обязана ломать проверку).
    """
    bullets = count_bullets(generated_text)
    if bullets != len(commits):
        return ("в заметках %d буллетов, а коммитов в диапазоне %d — "
                "часть коммитов потеряна или продублирована" % (bullets, len(commits)))
    grouped = sum(len(members) for _title, members in build_groups(commits))
    if grouped != len(commits):
        return "группировка потеряла коммиты: разложено %d из %d" % (grouped, len(commits))
    return None


def demote_headings(text):
    """Опустить заголовки рукописного раздела на уровень: `## X` → `### X`.

    Нужно, чтобы рукописные разделы «Не выпущено» оказались ВНУТРИ секции
    версии, а не рядом с ней. Текст при этом не переписывается — меняется
    только уровень заголовка.
    """
    return re.sub(r"(?m)^##(?!#)", "###", text)


def split_changelog(text):
    """CHANGELOG → (шапка, список секций `## ...`, хвост без секций).

    Секция — от строки `## ` до следующей `## ` (или конца файла).
    """
    lines = text.splitlines(True)
    head = []
    index = 0
    while index < len(lines) and not lines[index].startswith("## "):
        head.append(lines[index])
        index += 1
    sections = []
    current = None
    for line in lines[index:]:
        if line.startswith("## "):
            current = {"title": line.rstrip("\n"), "lines": [line]}
            sections.append(current)
        elif current is not None:
            current["lines"].append(line)
    return "".join(head), sections


def manual_sections(sections):
    """Рукописные разделы «Не выпущено …» в порядке следования."""
    return [section for section in sections if section["title"].startswith("## Не выпущено")]


def sections_at_ref(changelog_path, ref, cwd):
    """Заголовки секций CHANGELOG на прошлом релизе (`git show <ref>:CHANGELOG.md`).

    Нужно, чтобы переносить в новую секцию только разделы ЭТОЙ волны: разделы,
    которые уже были на прошлом теге, остаются на месте — иначе в секцию версии
    уехала бы вся история «Не выпущено» за месяцы.
    """
    if not ref:
        return set()
    try:
        relative = os.path.relpath(os.path.abspath(changelog_path), cwd)
        old_text = git(["show", "%s:%s" % (ref, relative)], cwd)
    except RuntimeError:
        return set()
    _head, sections = split_changelog(old_text)
    return {section["title"] for section in sections}


def details_block(manual):
    """Блок «Подробности (написано вручную)» из рукописных разделов."""
    parts = ["### Подробности (написано вручную)", "",
             "Текст ниже перенесён генератором из разделов «Не выпущено» без изменений "
             "(опущен только уровень заголовков).", ""]
    for section in manual:
        parts.append(demote_headings("".join(section["lines"]).rstrip() + "\n"))
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def append_manual(section_text, manual):
    """Дописать рукописные разделы в конец секции версии (не переписывая её)."""
    if not manual:
        return section_text
    block = details_block(manual)
    heading = "### Подробности (написано вручную)"
    if heading in section_text:
        return section_text.rstrip() + "\n\n" + block.split("\n", 3)[3].strip() + "\n"
    return section_text.rstrip() + "\n\n" + block


def generated_between(commits, version, date, mode=MODE_CHANGELOG):
    """Ровно то, что лежит МЕЖДУ маркерами (одна каноническая форма).

    Общая функция для первичной вставки и для повторного прогона: иначе
    «сгенерированная часть» менялась бы сама по себе (лишняя пустая строка) и
    идемпотентность ломалась бы на ровном месте.
    """
    return "\n" + build_notes_body(commits, version, date, mode) + "\n"


def render_section(version, date, commits, manual, mode=MODE_CHANGELOG):
    """Секция версии: заголовок, маркеры со сгенерированными группами, подробности."""
    parts = ["## %s — %s\n" % (version, date), "\n", BEGIN_MARK + "\n",
             generated_between(commits, version, date, mode), END_MARK + "\n"]
    text = "".join(parts)
    return append_manual(text, manual)


def insert_into_changelog(changelog_text, version, date, commits, manual, mode=MODE_CHANGELOG):
    """Вставить/обновить секцию версии, сохранив рукописные разделы.

    Идемпотентность: у существующей секции перезаписывается только то, что
    лежит между маркерами (машинная часть). Всё остальное — в том числе блок
    «Подробности (написано вручную)» — остаётся как есть; новые рукописные
    разделы (которых не было на прошлом теге) дописываются в конец.
    """
    head, sections = split_changelog(changelog_text)
    existing = None
    for section in sections:
        if section["title"].startswith("## %s —" % version) or section["title"] == "## %s" % version:
            existing = section
            break

    if existing is not None:
        body = "".join(existing["lines"])
        # Середина берётся ЖАДНО: между маркерами лежит ровно одна каноническая
        # форма (см. generated_between), поэтому повторный прогон не добавляет
        # лишних пустых строк.
        pattern = re.compile(r"(.*?%s\n)(.*)(%s.*)" % (re.escape(BEGIN_MARK), re.escape(END_MARK)), re.S)
        match = pattern.match(body)
        if match:
            before, _generated, after = match.groups()
            new_body = before + generated_between(commits, version, date, mode) + after
        else:
            # Секцию этой версии написал человек (маркеров нет) — сгенерированную
            # часть не изобретаем, только дописываем новые рукописные разделы.
            new_body = body
        new_body = append_manual(new_body, manual)
        existing["lines"] = [new_body if new_body.endswith("\n") else new_body + "\n"]
        return head + "".join("".join(section["lines"]) for section in sections)

    # Секции сравниваются по ЗАГОЛОВКУ, а не по объекту: список manual пришёл из
    # другого разбора того же текста, и совпадение по id() не находится — тогда
    # перенесённые разделы остались бы ещё и на старом месте (дубль).
    moved = {section["title"] for section in manual}
    new_text = head + render_section(version, date, commits, manual, mode)
    for section in sections:
        if section["title"] in moved:
            continue
        new_text += "".join(section["lines"])
    return new_text


def plural(count, one, few, many):
    """Русская форма слова для числа (11–14 — всегда «many»)."""
    if 10 <= count % 100 <= 20:
        return many
    if count % 10 == 1:
        return one
    if 2 <= count % 10 <= 4:
        return few
    return many


def write_notes_file(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description="Релизные заметки из коммитов диапазона")
    parser.add_argument("--from", dest="from_ref", default=None,
                        help="начало диапазона (по умолчанию — предыдущий тег; без тегов — вся история)")
    parser.add_argument("--to", dest="to_ref", default="HEAD", help="конец диапазона (по умолчанию HEAD)")
    parser.add_argument("--version", default=None, help="версия для заголовка (по умолчанию из release.py)")
    parser.add_argument("--date", default=None, help="дата версии YYYY-MM-DD (по умолчанию сегодня)")
    parser.add_argument("--out", default=None,
                        help="файл заметок (по умолчанию dist/RELEASE_NOTES_<версия>.md внутри --cwd)")
    parser.add_argument("--changelog", default=None,
                        help="файл CHANGELOG для --write-changelog (по умолчанию <cwd>/CHANGELOG.md)")
    parser.add_argument("--dry-run", action="store_true", help="напечатать заметки и ничего не писать")
    parser.add_argument("--write-changelog", action="store_true",
                        help="вставить секцию версии в CHANGELOG (по умолчанию пишется только файл заметок)")
    parser.add_argument("--full", action="store_true",
                        help="подробная форма: тела коммитов у всех групп (по умолчанию "
                             "файл заметок — компактный, а в CHANGELOG тела только у "
                             "«Исправлений» и «Добавлено»)")
    parser.add_argument("--manual", choices=("new", "all", "none"), default="new",
                        help="какие рукописные разделы «Не выпущено» переносить в секцию версии: "
                             "new — появившиеся после прошлого тега (по умолчанию), all — все, none — ни одного")
    parser.add_argument("--cwd", default=None, help="каталог репозитория (для тестов)")
    args = parser.parse_args(argv)

    cwd = args.cwd or ROOT
    # Пути по умолчанию считаются от --cwd, а не от каталога скрипта: иначе прогон
    # с --cwd <временный репозиторий> писал бы секцию в CHANGELOG движка
    # (проверено на себе: тест однажды так и сделал).
    changelog_path = args.changelog or os.path.join(cwd, "CHANGELOG.md")
    if args.changelog is not None and not os.path.abspath(changelog_path).startswith(
            os.path.abspath(cwd) + os.sep):
        print("!! --changelog %s лежит вне --cwd %s: писать в чужой CHANGELOG нельзя"
              % (changelog_path, cwd), file=sys.stderr)
        return 1
    version = args.version or project_version()
    date = args.date or datetime.date.today().isoformat()
    from_ref = args.from_ref if args.from_ref is not None else previous_tag(cwd)

    commits = collect_commits(from_ref, args.to_ref, cwd)
    notes_mode = MODE_FULL if args.full else MODE_COMPACT
    changelog_mode = MODE_FULL if args.full else MODE_CHANGELOG
    notes = build_notes(commits, version, date, notes_mode)

    problem = check_commit_coverage(commits, build_notes_body(commits, version, date, notes_mode))
    if problem:
        print("!! %s" % problem, file=sys.stderr)
        return 1

    if args.dry_run:
        print(notes, end="")
        print("# диапазон: %s..%s, коммитов %d, групп %d"
              % (from_ref or "<начало истории>", args.to_ref, len(commits), len(build_groups(commits))),
              file=sys.stderr)
        return 0

    out_path = args.out or os.path.join(cwd, "dist", "RELEASE_NOTES_%s.md" % version)
    write_notes_file(out_path, notes)
    print("заметки: %s (%d коммитов, %d групп)"
          % (out_path, len(commits), len(build_groups(commits))))

    if args.write_changelog:
        with open(changelog_path, encoding="utf-8") as handle:
            changelog = handle.read()
        if CHANGELOG_TITLE not in changelog:
            print("!! в %s нет строки «%s» — секцию вставлять некуда" % (changelog_path, CHANGELOG_TITLE),
                  file=sys.stderr)
            return 1
        _head, sections = split_changelog(changelog)
        manual = manual_sections(sections)
        if args.manual == "none":
            manual = []
        elif args.manual == "new":
            old_titles = sections_at_ref(changelog_path, from_ref, cwd)
            manual = [section for section in manual if section["title"] not in old_titles]
        updated = insert_into_changelog(changelog, version, date, commits, manual, changelog_mode)
        with open(changelog_path, "w", encoding="utf-8") as handle:
            handle.write(updated)
        print("CHANGELOG: секция %s обновлена (перенесено рукописных разделов: %d)"
              % (version, len(manual)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
