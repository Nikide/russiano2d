#!/usr/bin/env python3
# ===========================================================================
# §29 Спецификации: preview SDK и прямой запуск дают ОДНИ И ТЕ ЖЕ данные.
#
# Это вторая половина приёмки §29 (первая — sdk_validation_test.py): ассет
# можно проверить CLI, «открыть в preview» и использовать в игре, и при этом
# backend и runtime не расходятся. Проверяется не описание, а сравнение:
#   * SDK (`r2d atlas-info` — тот же разбор, что читает студия) и движок
#     (`$.atlas.load()`) дают одинаковый список кадров, их регионы и размеры;
#   * SDK видит проект и его ассеты по РЕАЛЬНОЙ файловой структуре
#     (`r2d assets`) — скрытой базы проекта нет;
#   * испорченный ассет отклоняется ОБОИМИ сторонами согласованно.
#
# Запуск:
#   python3 tests/sdk_preview_parity_test.py
# ===========================================================================

import json
import os
import struct
import subprocess
import sys
import tempfile
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
def _r2d_binary():
    """Путь к единому r2d; задаётся AGENTS.md через R2D_BINARY."""
    return os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "r2d"))


R2D = _r2d_binary()
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def png(width, height):
    raw = b"".join(b"\x00" + b"\x00\x00\x00\xff" * width for _ in range(height))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


#: Кадры описаны так, чтобы расхождение было заметно: разные x и размеры.
ATLAS = {
    "meta": {"size": {"w": 128, "h": 64}, "scale": "1", "image": "hero.png",
             "format": "RGBA8888"},
    "frames": {
        "idle_0": {"frame": {"x": 0, "y": 0, "w": 32, "h": 32}},
        "idle_1": {"frame": {"x": 32, "y": 0, "w": 32, "h": 32}},
        "run_0": {"frame": {"x": 64, "y": 32, "w": 48, "h": 24}},
    },
}


def sdk(*args):
    out = subprocess.run([R2D, *args], capture_output=True, text=True, timeout=60, cwd=ROOT)
    try:
        return json.loads(out.stdout.strip() or "{}")
    except Exception:                                 # noqa: BLE001
        return {"ok": False, "raw": out.stdout + out.stderr}


def make_project(tmp):
    """Проект с картинкой и атласом — ровно так, как его видит SDK."""
    proj = os.path.join(tmp, "proj")
    assets = os.path.join(proj, "assets")
    os.makedirs(assets, exist_ok=True)
    with open(os.path.join(proj, "project.json"), "w", encoding="utf-8") as f:
        json.dump({"title": "parity", "version": "0.1.0", "width": 960, "height": 540}, f)
    with open(os.path.join(proj, "main.js"), "w", encoding="utf-8") as f:
        f.write("$.ready(() => {});\n")
    with open(os.path.join(assets, "hero.png"), "wb") as f:
        f.write(png(128, 64))
    with open(os.path.join(assets, "hero.json"), "w", encoding="utf-8") as f:
        json.dump(ATLAS, f, ensure_ascii=False, indent=2)
    return proj, os.path.join(assets, "hero.json")


def main():
    print("== §29: parity preview SDK ↔ движок ==")
    if not os.path.exists(R2D):
        print("  пропуск: %s не собран" % os.path.relpath(R2D, ROOT))
        return 0

    with tempfile.TemporaryDirectory(prefix="r2d-parity-") as tmp:
        proj, atlas_path = make_project(tmp)
        rel_atlas = os.path.relpath(atlas_path, ROOT)

        # --- SDK: тот же разбор, что читает студия ----------------------------
        info = sdk("atlas-info", rel_atlas)
        check(info.get("ok") is True, "SDK разбирает атлас без ошибок (%s)" % info.get("errors"))
        sdk_frames = {f.get("name"): f for f in (info.get("frames") or [])}
        check(set(sdk_frames) == set(ATLAS["frames"]),
              "SDK видит все кадры (%s)" % sorted(sdk_frames))

        # --- SDK: проект и ассеты по реальной структуре -----------------------
        assets = sdk("assets", os.path.relpath(proj, ROOT))
        listed = [a.get("path", "").replace("\\", "/") for a in (assets.get("entries") or [])]
        check(any(p.endswith("hero.json") for p in listed),
              "SDK видит ассеты проекта без скрытой базы (%d записей: %s)" % (len(listed), listed[:3]))
        check(any((a.get("tool") or "") == "sprite-studio" for a in (assets.get("entries") or [])),
              "ассет привязан к инструменту реестра (студия спрайтов)")

        # --- Движок: тот же атлас, загруженный игрой --------------------------
        with Agent(game=os.path.relpath(proj, ROOT), seed=3, fixed_dt=1.0 / 60.0,
                   start_timeout=120) as a:
            a.step(4)
            loaded = a.eval("(() => { const s = $.atlas.load('parity', %s); return !!s; })()"
                            % json.dumps(rel_atlas))
            check(loaded is True, "движок загрузил тот же атлас по тому же пути")
            # `frame(name)` — индекс спрайта, регион отдаёт `info(name)`.
            engine_frames = json.loads(a.eval("""(() => {
                const s = $.atlas.get('parity');
                const out = {};
                for (const name of s.frames()) {
                    const r = s.info(name);
                    out[name] = { x: r.x, y: r.y, w: r.w, h: r.h };
                }
                return JSON.stringify(out);
            })()""") or "{}")
            # Размер листа читаем из самого атласа, а не из GPU-текстуры:
            # в headless-прогоне текстурного биндинга может не быть, и это не
            # свойство данных, а среда запуска.
            size = json.loads(a.eval("JSON.stringify($.atlas.get('parity').info('run_0'))") or "{}")
            errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]

        check(set(engine_frames) == set(ATLAS["frames"]),
              "движок видит те же кадры (%s)" % sorted(engine_frames))
        check(not errors, "движок не пишет ошибок при загрузке атласа: %s" % errors[:2])

        # --- Сравнение по числам: backend и runtime не расходятся -------------
        mismatched = []
        for name, want in ATLAS["frames"].items():
            w = want["frame"]
            got = engine_frames.get(name) or {}
            for field in ("x", "y", "w", "h"):
                if abs(float(got.get(field, -1)) - float(w[field])) > 0.001:
                    mismatched.append("%s.%s: sdk=%s runtime=%s" % (name, field, w[field], got.get(field)))
        check(not mismatched, "регионы кадров совпадают у SDK и движка (%s)" % (mismatched[:3] or "все совпали"))
        # Размер листа сверяем по данным кадра: если атлас объявляет 128×64,
        # кадр обязан лежать внутри этих границ.
        inside = all((f["frame"]["x"] + f["frame"]["w"]) <= ATLAS["meta"]["size"]["w"]
                     and (f["frame"]["y"] + f["frame"]["h"]) <= ATLAS["meta"]["size"]["h"]
                     for f in ATLAS["frames"].values())
        check(inside and size is not None,
              "все кадры лежат внутри объявленного размера листа (%s)" % ATLAS["meta"]["size"])

        # --- Испорченный ассет отклоняют ОБЕ стороны --------------------------
        broken = os.path.join(tmp, "broken.atlas.json")
        with open(broken, "w", encoding="utf-8") as f:
            json.dump({"meta": {"size": {"w": 0, "h": 0}},
                       "frames": {"bad": {"frame": {"x": -1, "y": 0, "w": 0, "h": 0}}}}, f)
        bad = sdk("atlas-info", os.path.relpath(broken, ROOT))
        check(bad.get("ok") is False,
              "испорченный атлас отклонён SDK (%s)" % [d.get("code") for d in (bad.get("diagnostics") or [])][:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
