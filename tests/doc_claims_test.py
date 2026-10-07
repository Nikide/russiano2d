#!/usr/bin/env python3
# ===========================================================================
# Страж документации: утверждения «чего нет» сверяются с кодом.
#
# Причина существования: доки отставали системно — закрытые пункты описывались
# как заглушки (см. docs/TASKS.md §11). Эта проверка читает КОД и убеждается,
# что для каждой реализованной возможности в документации нет утверждения
# «этого нет».
#
# Проверка намеренно текстовая: она не понимает смысла, но ловит ровно тот
# класс ошибок, что был — «в доке написано, что не сделано, а в коде сделано».
#
# Запуск:
#   python3 tests/doc_claims_test.py
# ===========================================================================

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def read(path):
    full = os.path.join(ROOT, path)
    if not os.path.isfile(full):
        return ""
    return open(full, encoding="utf-8", errors="replace").read()


def code_has(path, pattern):
    return re.search(pattern, read(path)) is not None


def doc_lacks(path, pattern):
    return re.search(pattern, read(path)) is None


# (что, где в коде доказывает, файл доки, чего в доке быть НЕ должно)
CLAIMS = [
    ("пользовательские шейдеры",
     "src/highlevel/render.js", r"defineShader",
     "docs/HIGH_LEVEL_API.md", r"Пользовательские шейдеры\s+движок не поддерживает"),
    ("шейдеры в PERF",
     "src/highlevel/render.js", r"defineShader",
     "docs/HIGH_LEVEL_API_PERF.md", r"шейдеры.*— заглушк|\.shader\(\).*заглушк"),
    ("render target",
     "src/render.c", r"r2d_render_viewport_target",
     "docs/highlevel/render.md", r"render target не поддержан"),
    ("render target в PERF",
     "src/render.c", r"r2d_render_viewport_target",
     "docs/HIGH_LEVEL_API_PERF.md", r"viewport.*\(заглушка\)"),
    ("render target в GAP",
     "src/render.c", r"r2d_render_viewport_target",
     "docs/GAP_ANALYSIS.md", r"render target.*остаётся заглушкой|Render target.*заглушкой"),
    ("render target в VFX",
     "src/render.c", r"r2d_render_viewport_target",
     "docs/VFX_PLAN.md", r"render target не поддержан"),
    ("режим треугольника",
     "src/highlevel/render.js", r"triangle\(x1, y1, x2, y2, x3, y3, color, blend\)",
     "docs/highlevel/render.md", r"отдаёт треугольники без режима"),
    ("имена клавиш",
     "src/highlevel/input.js", r"engine\.keyName\(",
     "docs/HIGH_LEVEL_API_PERF.md", r"KEY_NAMES.*никем не заполняется"),
    ("мультиплеер",
     "src/highlevel/net.js", r"createAuthority",
     "docs/GAP_ANALYSIS.md", r"сетевая игра.*не мультиплеер"),
    ("фигурный свип",
     "src/script.c", r"castShape",
     "docs/GAP_ANALYSIS.md", r"нет фигурного свипа"),
    # --- добавлено после аудита §12.16: эти враки страж не ловил ---
    ("слои коллизий в PERF",
     "src/highlevel/world.js", r"layerBits",
     "docs/HIGH_LEVEL_API_PERF.md", r"слои коллизий.*пустышк"),
    ("фигурный свип в PERF",
     "src/script.c", r"castShape",
     "docs/HIGH_LEVEL_API_PERF.md", r"фигурный свип/CastShape.*в биндингах нет"),
    ("Curve/Gradient как ресурсы",
     "src/highlevel/resource.js", r"loadGradient",
     "docs/HIGH_LEVEL_API_PERF.md", r"Curve.*Gradient.*рампы зашиты"),
    ("Curve/Gradient в списке дыр",
     "src/highlevel/resource.js", r"loadCurve",
     "docs/HIGH_LEVEL_API_PERF.md", r"Настоящие дыры[^\n]*Curve"),
    ("мипмапы",
     "src/render.c", r"SDL_GenerateMipmapsForGPUTexture",
     "docs/API.md", r"мипмап[^\n]*не поддержан"),
    ("обрезка (scissor)",
     "src/render.c", r"SDL_SetGPUScissor",
     "docs/highlevel/render.md", r"scissor/clip нет|обрезка[^\n]*не сделана"),
    ("зоны тела",
     "src/physics.c", r"r2d_physics_add_shape",
     "docs/highlevel/world.md", r"форм[^\n]*не сделаны|недостижимо"),
    ("viewport не заглушка",
     "src/render.c", r"r2d_render_viewport_target",
     "docs/VFX_PLAN.md", r"viewport\.js[^\n]*перестаёт быть\s+заглушкой"),
]

NO_CALLS = [
    ("$, который в доке описан, но не работает: $.gfx.draw.sprite",
     "src/highlevel/render.js", r"draw: \{"),
]


def main():
    for name, code_path, code_pat, doc_path, doc_pat in CLAIMS:
        in_code = code_has(code_path, code_pat)
        check(in_code, f"{name}: есть в коде ({code_path})")
        if not in_code:
            continue
        clean = doc_lacks(doc_path, doc_pat)
        check(clean, f"{name}: в {doc_path} нет устаревшего «этого нет»")

    for name, path, pattern in NO_CALLS:
        check(code_has(path, pattern), name)

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
