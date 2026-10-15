#!/usr/bin/env python3
# ===========================================================================
# Пропуск 3D-тестов в сборке без RE2D.
#
# Движок собирается в двух конфигурациях (см. src/CMakeLists.txt и
# docs/BUILD.md): по умолчанию `R2D_ENABLE_RE2D=ON` (с 3D-авторингом спрайтов)
# и `-DR2D_ENABLE_RE2D=OFF` (сборка 2D-платформера: ни RE2D, ни Real2D, ни
# RotSprite, ни Re2D World).
#
# Тесты RE2D-подсистем бессмысленны во второй сборке: их предмета в бинарнике
# нет. Но и «зелёными» они быть не могут — падение вместо пропуска прячет
# настоящие регрессии. Поэтому тест должен:
#
#   1. спросить у движка, есть ли RE2D (`$.re2dEnabled` — факт сборки, а не
#      догадка по имени каталога);
#   2. если нет — напечатать причину и выйти с кодом 0 БЕЗ проверок. Раннер
#      (tools/run_tests.py) считает такой прогон `skip` и печатает
#      предупреждение, то есть «зелёным» он не притворяется.
#
# Использование (одна строка после создания агента):
#
#   from re2d_skip import skip_without_re2d
#   with Agent(game=GAME, seed=1) as a:
#       if skip_without_re2d(a):
#           return
#
# Часть тестов проверяет 3D-авторинг раньше, чем создаёт агента (например,
# внешним CLI `r2d-sdk`). Для них есть статические пробы ниже — они читают
# сборку, а не гадают.
# ===========================================================================

import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

#: Маркер, который есть ТОЛЬКО в сборке с RE2D: имя нативной подсистемы
#: Re2D World (`src/re2d_world.c`) — в выключенной сборке этих исходников нет
#: вовсе, поэтому ни имён функций, ни текстов исключений оттуда не остаётся.
#: (Строка отказа камеры для этого не годится: JS-модули встраиваются в
#: бинарник в обеих конфигурациях, и она есть всегда.)
#: Гадать по имени каталога нельзя, читаем сам файл.
_ON_MARKER = b"re2d_world"


def re2d_enabled(agent):
    """Есть ли в текущей сборке RE2D. Ошибку чтения считаем «есть»:

    тест, который не смог спросить движок, не должен молча пропускаться —
    это скрыло бы поломку самого `$`.
    """
    try:
        return bool(agent.eval("typeof $.re2dEnabled === 'boolean' ? $.re2dEnabled : true"))
    except Exception:                     # noqa: BLE001 — намеренно широкий
        return True


def skip_without_re2d(agent, what=""):
    """Напечатать причину и вернуть True, если RE2D в сборке нет."""
    if re2d_enabled(agent):
        return False
    _report(what)
    return True


def binary_has_re2d(path=None):
    """Статически: собран ли бинарник движка с RE2D.

    Нужно тестам, которые ходят во внешний CLI (r2d-sdk) ДО создания агента.
    """
    binary = path or os.environ.get("R2D_BINARY") or os.path.join(ROOT, "build", "russiano2d")
    if not os.path.exists(binary):
        return True                       # нечего проверять — пусть тест упадёт явно
    try:
        with open(binary, "rb") as f:
            return _ON_MARKER in f.read()
    except OSError:
        return True


def skip_without_re2d_binary(path=None, what=""):
    """Пропуск до создания агента. True — RE2D в сборке нет."""
    if binary_has_re2d(path):
        return False
    _report(what)
    return True


def sdk_has_command(name, path=None):
    """Есть ли у собранного CLI команда `name`.

    Команды 3D-авторинга (`world-compile`, `convert-re2d3`, `bake-re2d`)
    вырезаны вместе с SDK-частью RE2D — это решение владельца, а не регрессия
    движка. Тест, которому нужна такая команда, обязан пропуститься с причиной,
    иначе «удалено осознанно» выглядит как «сломано».
    """
    import json as _json
    binary = path or os.environ.get("R2D_SDK_BINARY") or os.path.join(ROOT, "build", "r2d-sdk")
    if not os.path.exists(binary):
        return False
    try:
        out = subprocess.run([binary, "commands"], capture_output=True, text=True, timeout=60)
        data = _json.loads(out.stdout or "{}")
        return any(c.get("name") == name for c in data.get("commands", []))
    except Exception:                     # noqa: BLE001 — CLI может быть старым/битым
        return False


def skip_without_sdk_command(name, what="", path=None):
    """Пропуск теста, которому нужна команда CLI, вырезанная вместе с 3D-SDK.

    Возвращает True (и печатает причину), если команды нет: это осознанное
    удаление авторинга, а не поломка движка.
    """
    if sdk_has_command(name, path):
        return False
    detail = (" (%s)" % what) if what else ""
    print("  пропуск: у r2d-sdk нет команды «%s» — 3D-авторинг вырезан из SDK%s"
          % (name, detail))
    sys.stdout.flush()
    return True


def sdk_available(path=None):
    """Собран ли CLI SDK (`r2d-sdk`) — внешний инструмент тестов.

    Движок его не требует: это отдельный бинарник (см. sdk/native/CMakeLists.txt),
    и в дереве после `--target russiano2d` его может не быть.
    """
    binary = path or os.environ.get("R2D_SDK_BINARY") or os.path.join(ROOT, "build", "r2d-sdk")
    if os.path.exists(binary):
        return True
    print("  пропуск: не собран r2d-sdk (%s) — проверять внешний CLI нечем" % binary)
    sys.stdout.flush()
    return False


def _report(what):
    detail = (" (%s)" % what) if what else ""
    print("  пропуск: сборка без RE2D (R2D_ENABLE_RE2D=OFF)%s — проверять нечего" % detail)
    sys.stdout.flush()
