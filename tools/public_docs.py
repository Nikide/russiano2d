#!/usr/bin/env python3
"""Что из документации движка публично, а что — внутренние рабочие документы.

Одно правило на все публикующие места: поставку SDK (`tools/release.py`,
`tools/agents_doc.py`) и сайт документации (`site/build-doc.py`, файл вне
репозитория, поэтому импортирует ЭТОТ модуль). Иначе документ, убранный из
пакета, спокойно уезжает на сайт — так и случилось с `docs/internal/NATIVE.md`.

Принцип разделения (решение владельца проекта):
  * ВНУТРЕННЕЕ — то, что описывает НАШ процесс: журналы, аудиты, бэклоги,
    отчёты о прогонах на нашей машине, чужие транскрипты, справочники для
    разработчика движка.
  * ПУБЛИЧНОЕ — то, что является контрактом или руководством для того, кто
    берёт SDK: API, архитектура, гайды, форматы, ограничения, план развития.

Использование::

    import public_docs
    public_docs.is_internal_doc("docs/internal/NATIVE.md")   # True
    public_docs.glob_public("docs", "highlevel")             # публичные страницы
    shutil.copytree(src, dst, ignore=public_docs.public_docs_ignore)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, List, Sequence, Set

#: ВНУТРЕННИЕ рабочие документы: остаются в репозитории и НЕ публикуются — ни в
#: пакете SDK (каталог `docs/` в архиве), ни в склейке `AGENTS.md`, ни на сайте
#: документации. Пути — относительно корня репозитория; каталог исключает всё
#: своё поддерево.
#:
#: Почему каждый:
#:   * `docs/internal/` — справочник C-биндингов `engine.*`: уровень разработчика
#:     движка, а не пользователя SDK;
#:   * `docs/EXTERNAL_FEEDBACK.md` — транскрипт отчёта внешней команды BASHNYA
#:     (их пути и числа) и наши решения по нему;
#:   * `docs/PRODUCTION_POLISH.md` — рабочее ТЗ и журнал приёмки с владельцами
#:     файлов и галочками по §-ам;
#:   * `docs/PRODUCTION_PLAN.md` — журнал порядка работ и состояния пунктов;
#:   * `docs/SDK_IMPLEMENTATION_GAPS.md` — наш бэклог SDK с условиями приёмки для
#:     нас же (публичная часть возможностей — в `docs/SDK.md`);
#:   * `docs/SDK_VERIFICATION.md` — журнал прогона проверок на нашей машине;
#:   * `docs/re2d/…AUDIT/…PLAN/…HISTORY` и `GZDOOM_*` — аудит приёмки документов,
#:     план реализации, история замеров и заметки по чужому движку. Публичная
#:     часть `docs/re2d/` (форматы, миграция, поведение рендера) публикуется;
#:   * `docs/ci-archive/` — архив отчётов CI: наш процесс. Сейчас каталога нет,
#:     но правило стоит заранее: если он появится, публиковать его не нужно;
#:   * журналы и планы работ — `docs/NEXT_SESSION.md`,
#:     `docs/HANDOFF_VN_RENDER_ROADMAP.md`, `docs/ROADMAP_COVERAGE.md`,
#:     `docs/TASKS.md`, `docs/TESTING.md`, `docs/ENGINE_GAPS.md`,
#:     `docs/PRODUCTION_READINESS.md`, `docs/SDK_TOOLING_PHASE0_REPORT.md`,
#:     `docs/re2d/P0_EXECUTION_PLAN.md`,
#:     `docs/re2d/RE2D_WORLD_GZDOOM_RENDERER_PLAN.md` — наш рабочий процесс;
#:   * `SDK_HANDOFF.md` (корень) — журнал работы над SDK: что делали, чем
#:     проверяли, что осталось; едет в пакет отдельно от `docs/`.
INTERNAL_DOCS = (
    "docs/internal",
    "docs/EXTERNAL_FEEDBACK.md",
    "docs/PRODUCTION_POLISH.md",
    "docs/PRODUCTION_PLAN.md",
    "docs/PRODUCTION_READINESS.md",
    "docs/ROADMAP_COVERAGE.md",
    "docs/SDK_IMPLEMENTATION_GAPS.md",
    "docs/SDK_TOOLING_PHASE0_REPORT.md",
    "docs/SDK_VERIFICATION.md",
    "docs/TASKS.md",
    "docs/TESTING.md",
    "docs/ENGINE_GAPS.md",
    "docs/NEXT_SESSION.md",
    "docs/HANDOFF_VN_RENDER_ROADMAP.md",
    "docs/ci-archive",
    "docs/re2d/P0_EXECUTION_PLAN.md",
    "docs/re2d/RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md",
    "docs/re2d/RE2D_RENDERER_IMPLEMENTATION_PLAN.md",
    "docs/re2d/RE2D_WORLD_CPU_HISTORY.md",
    "docs/re2d/RE2D_WORLD_GZDOOM_RENDERER_PLAN.md",
    "docs/re2d/GZDOOM_REFERENCE_RULES.md",
    "docs/re2d/GZDOOM_VISUAL_OBSERVATIONS.md",
    "SDK_HANDOFF.md",
)

#: Что публикуется на САЙТЕ документации (r2d.nikiniki.ru/doc/). Это ALLOW-LIST,
#: а не «всё минус внутреннее»: запрос пользователя — «на сайте только дженжлоги
#: и дока по `$`». Сайт — витрина API, пакет SDK — рабочий комплект для того, кто
#: делает игру, поэтому правила у них разные и это осознанно.
#:
#:   * `CHANGELOG.md` — история релизов;
#:   * `docs/highlevel/**` — справочники подсистем `$` (audio, render, input, ui,
#:     world, physics, save, scene, tilemap, devtools, net, proc, replay, noise …);
#:   * `docs/AGENT_API.md` — протокол агентского режима: им пользуются те, кто
#:     пишет автопроверки игры;
#:   * `docs/HIGH_LEVEL_API.md` — общий контракт `$`;
#:   * `docs/tutorial-first-game.md`, `docs/BUILD.md`, `docs/demos.md` — вход для
#:     того, кто впервые скачал движок: «первая игра», «как собрать её в один
#:     файл» и разбор демо. Возвращены на сайт решением владельца проекта:
#:     страницей сайта их читать лучше, чем markdown'ом в репозитории, — но
#:     именно эти три, а не «все туториалы сразу»: список остаётся allow-list.
#:
#: Всё прочее на сайт не идёт: архитектура, философия, законы UI, задачи и
#: роадмап, туториалы, демо, RE2D, внутренние журналы и отчёты,
#: TESTING, лицензии и кодексы; SDK/API reference публикуется отдельным запросом. Если понадобится вернуть что-то из этого —
#: это решение владельца проекта, а не правка списка по ходу.
SITE_DOCS = (
    "CHANGELOG.md",
    "docs/AGENT_API.md",
    "docs/HIGH_LEVEL_API.md",
    "docs/highlevel",
    "docs/tutorial-first-game.md",
    "docs/tutorial-settings.md",
    "docs/BUILD.md",
    "docs/demos.md",
    # SDK tooling docs: explicit owner request to publish SDK/API reference and
    # recipes on the documentation site (previously SDK docs were repo-only).
    "docs/SDK.md",
    "docs/SDK_AGENT_TOOLING.md",
    "docs/api",
    "docs/recipes",
    # Roadmap VN/Re2D docs (2026-10-17): published with the engine docs.
    "docs/VN_NARRATIVE.md",
    "docs/RE2D_RENDER_FEATURES.md",
    "docs/RE2D_BRUSH_AUTHORING.md",
    "docs/RE2D_HUGE_WORLD.md",
    "docs/RE2D_SKY_BOUNDARY.md",
    "docs/RE2D_VFX.md",
    "docs/RE2D_DEBUG_VIEWS.md",
)



def is_site_doc(relpath: str) -> bool:
    """Публикуется ли документ на сайте (allow-list SITE_DOCS)."""
    normalized = str(relpath).replace(os.sep, "/").lstrip("./")
    for entry in SITE_DOCS:
        if normalized == entry or normalized.startswith(entry.rstrip("/") + "/"):
            return True
    return False


def glob_site(*parts: str, pattern: str = "*.md", skip_underscore: bool = False,
              root: Path | None = None) -> List[str]:
    """Файлы для сайта: из каталога репозитория, только по allow-list SITE_DOCS."""
    return [path for path in glob_public(*parts, pattern=pattern,
                                         skip_underscore=skip_underscore, root=root)
            if is_site_doc(path)]


#: Что выкидывать из копируемых каталогов (мусор ОС и рабочие файлы).
PACKAGE_IGNORE = (".DS_Store", "__pycache__", "*.pyc", "*.pyo",
                  "state.local.json", "native")


def repo_root() -> Path:
    """Корень репозитория (родитель каталога tools/)."""
    return Path(__file__).resolve().parent.parent


def is_internal_doc(relpath: str) -> bool:
    """Внутренний ли это документ (путь относительно корня репозитория)."""
    normalized = str(relpath).replace(os.sep, "/").lstrip("./")
    for entry in INTERNAL_DOCS:
        if normalized == entry or normalized.startswith(entry.rstrip("/") + "/"):
            return True
    return False


def internal_files(root: Path | None = None) -> List[str]:
    """Существующие внутренние документы (файлы, а не каталоги)."""
    root = root or repo_root()
    found: List[str] = []
    for entry in INTERNAL_DOCS:
        path = root / entry
        if path.is_dir():
            found += sorted(str(p.relative_to(root)).replace(os.sep, "/")
                            for p in path.rglob("*.md"))
        elif path.is_file():
            found.append(entry)
    return found


def public_docs_ignore(directory: str, names: Sequence[str]) -> Set[str]:
    """`ignore=` для `shutil.copytree`: не публиковать внутренние документы.

    Работает и для каталога `docs/` целиком, и для его подкаталогов: путь
    считается относительно корня репозитория.
    """
    skipped: Set[str] = set()
    root = str(repo_root())
    for name in names:
        full = os.path.relpath(os.path.join(directory, name), root)
        if is_internal_doc(full):
            skipped.add(name)
    return skipped


def package_ignore(directory: str, names: Sequence[str]) -> Set[str]:
    """`ignore=` для копирования в пакет: мусор ОС + внутренние документы."""
    import fnmatch

    skipped = {name for name in names
               if any(fnmatch.fnmatch(name, pattern) for pattern in PACKAGE_IGNORE)}
    skipped |= public_docs_ignore(directory, names)
    return skipped


def glob_public(*parts: str, pattern: str = "*.md", skip_underscore: bool = False,
                root: Path | None = None) -> List[str]:
    """Публичные файлы из каталога репозитория: пути от корня, по алфавиту.

    `parts` — сегменты каталога (`glob_public("docs", "highlevel")`).
    Файлы, начинающиеся с `_`, пропускаются по `skip_underscore=True`
    (черновики и служебные страницы вроде `_sidebar.md`).
    """
    root = root or repo_root()
    directory = root.joinpath(*parts)
    if not directory.is_dir():
        return []
    found = []
    for path in sorted(directory.glob(pattern)):
        if skip_underscore and path.name.startswith("_"):
            continue
        relative = str(path.relative_to(root)).replace(os.sep, "/")
        if is_internal_doc(relative):
            continue
        found.append(relative)
    return found


def filter_public(paths: Iterable[str]) -> List[str]:
    """Оставить только публичные пути (для меню, индексов, карт сайта)."""
    return [path for path in paths if not is_internal_doc(path)]
