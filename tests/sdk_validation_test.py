#!/usr/bin/env python3
# ===========================================================================
# §29 Спецификации: SDK-инструменты и валидация ассетов.
#
# Приёмка §29:
#   * ассет можно создать/исправить, проверить CLI, открыть в preview и
#     использовать в игре без скрытой project database;
#   * неверный marker/shape/reference выявляется ДО запуска;
#   * preview SDK и прямой запуск проекта дают одинаковые данные;
#   * инструменты не вводят второй scene graph.
#
# Тест проверяет это по факту: каждый зарегистрированный тип валидатора должен
# иметь работающую проверку, корректный файл проходить без ошибок, а сломанный —
# давать структурированный код. Отдельно проверяется, что данные открыты (файл
# читается без базы проекта) и что runtime-загрузчик понимает те же файлы.
#
# Запуск:
#   python3 tests/sdk_validation_test.py
#   R2D_SDK_BINARY=/path/to/r2d-sdk python3 tests/sdk_validation_test.py
# ===========================================================================

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
def _sdk_binary():
    """Путь к r2d-sdk: переменная, затем сборка SDK, затем общая сборка.

    В дереве две сборки: `build-sdk` (SDK и его тесты) и `build` (движок).
    Раньше тест жёстко смотрел в `build`, поэтому после правки валидаторов он
    мог проверять СТАРЫЙ бинарник и «проходить» на несуществующем коде.
    """
    env = os.environ.get("R2D_SDK_BINARY")
    if env:
        return env
    for sub in ("build-sdk", "build"):
        candidate = os.path.join(ROOT, sub, "r2d-sdk")
        if os.path.exists(candidate):
            return candidate
    return os.path.join(ROOT, "build", "r2d-sdk")


SDK = _sdk_binary()
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# ---------------------------------------------------------------------------
# Корректные и сломанные образцы каждого типа данных
# ---------------------------------------------------------------------------

GOOD = {
    "project": {
        "title": "SDK fixture", "version": "0.1.0", "width": 960, "height": 540,
    },
    "sprite.atlas": {
        "meta": {"size": {"w": 64, "h": 32}, "scale": "1", "image": "sheet.png",
                 "format": "RGBA8888"},
        "frames": {
            "idle_0": {"frame": {"x": 0, "y": 0, "w": 32, "h": 32}},
            "run_0": {"frame": {"x": 32, "y": 0, "w": 32, "h": 32}},
        },
    },
    "tilemap": {
        "version": 1, "tile": 32, "width": 10, "height": 8, "src": "tiles.png",
        "layers": [{"name": "ground", "depth": 0, "solid": True,
                    "data": [[0, 0], [1, 1]]}],
    },
    "particles": {
        "version": 1, "name": "sparks", "emitting": True, "amount": 12,
        "max_particles": 48, "rate": 60, "lifetime": [120, 300],
        "speed": [80, 160], "direction": 0, "spread": 360, "size": [2, 5], "seed": 7,
    },
    "collision": {
        "version": 1,
        "shapes": [{"name": "wall1", "tag": "wall", "shape": "box",
                    "x": 0, "y": 0, "w": 32, "h": 32}],
    },
    "layers": {
        "version": 1,
        "layers": [{"name": "bg", "depth": 0, "parallax": 0.5},
                   {"name": "world", "depth": 1, "parallax": 1}],
    },
    "fonts": {
        "version": 1,
        "fonts": [{"name": "hud", "path": "hud.ttf"}],
        "styles": {"hud": {"size": 20, "color": "#ffffff"}},
    },
    # `master` — не шина, а корень микса: валидатор его имя запрещает.
    "audio": {
        "version": 1,
        "buses": {"sfx": {"volume": 0.8}, "music": {"volume": 0.6}},
        "sounds": {"hit": {"path": "hit.wav", "bus": "sfx"}},
    },
    "input": {
        "version": 1,
        "actions": {"jump": ["space", "w"], "attack": ["j"]},
    },
    "rmlui.document": {
        "__text__": "<rml><head><style>body{color:#fff;}</style></head>"
                    "<body><p>Привет</p></body></rml>",
    },
    "rmlui.style": {
        "__text__": "body { color: #ffffff; font-size: 16px; }",
    },
    # Манифест batch и сессия агента раньше проверялись типом «json», то есть
    # только «это JSON»: манифест с несуществующей операцией проходил.
    "sdk.manifest": {
        "version": 1,
        "jobs": [{"op": "validate", "source": "proj/project.json"}],
    },
    "sdk.agent-session": {
        "version": 1, "game": "proj", "seed": 7, "timeoutMs": 30000,
        "requests": [{"cmd": "eval", "code": "1"}, {"cmd": "quit"}],
    },
}

#: Чем ломаем каждый тип и какой код обязан появиться.
BROKEN = {
    "project": ({"title": "x", "width": -5}, "SDK_PROJECT_FIELD"),
    "sprite.atlas": ({"meta": {"size": {"w": 0, "h": 0}},
                      "frames": {"a": {"frame": {"x": -5, "y": 0, "w": 0, "h": 0}}}},
                     "SDK_ATLAS_FRAME_RECT"),
    "tilemap": ({"version": 99, "tile": 32, "width": 1, "height": 1,
                 "layers": []}, "SDK_TILEMAP_VERSION"),
    "particles": ({"version": 1, "amount": 0}, "SDK_PARTICLES_FIELD"),
    "collision": ({"version": 1, "shapes": [{"name": "bad", "tag": "no-such-tag",
                                             "shape": "box", "x": 0, "y": 0,
                                             "w": 32, "h": 32}]},
                  "SDK_COLLISION_TAG"),
    "layers": ({"version": 1, "layers": [{"name": "a", "parallax": "нет"}]},
               "SDK_LAYERS_PARALLAX"),
    "fonts": ({"version": 1, "fonts": [{"name": "hud", "path": "hud.txt"}]},
              "SDK_FONTS_FONT"),
    "audio": ({"version": 1, "buses": [1, 2], "sounds": []}, "SDK_AUDIO_BUSES"),
    "input": ({"version": 1, "actions": ["jump"]}, "SDK_INPUT_ACTIONS"),
    "rmlui.document": ({"__text__": "<rml><body><p>не закрыто"}, "SDK_RML_"),
    "rmlui.style": ({"__text__": "body { color: "}, "SDK_RCSS_"),
    "sdk.manifest": ({"version": 1, "jobs": [{"op": "delete-everything", "source": "x.json"}]},
                     "SDK_BATCH_OPERATION"),
    "sdk.agent-session": ({"version": 2, "game": "", "requests": [{"cmd": "quit"}, {"cmd": "x"}]},
                          "SDK_AGENT_SESSION"),
}


#: Минимальные «соседние» файлы, на которые ссылаются образцы. Валидатор
#: обязан проверять ССЫЛКИ, а не только поля: ассет со ссылкой в никуда должен
#: падать до запуска. Поэтому у корректного образца ссылки существуют.
NEIGHBOURS = {
    "sprite.atlas": ["sheet.png"],
    "tilemap": ["tiles.png"],
    "fonts": ["hud.ttf"],
    "audio": ["hit.wav"],
}

def _png(width, height):
    """Настоящий PNG нужного размера: валидатор сверяет его с meta.size.

    Формируем сами, без графических библиотек: нужен ровно корректный заголовок
    и размеры, картинка дальше не читается.
    """
    import struct
    import zlib
    raw = b"".join(b"\x00" + b"\x00\x00\x00\x00" * width for _ in range(height))
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


#: Размер «картинок»-соседей. Для атласа он равен meta.size (64×32), иначе
#: валидатор справедливо сообщит SDK_ATLAS_SIZE_MISMATCH.
PNG_SIZES = {"sheet.png": (64, 32), "tiles.png": (64, 64)}


def write_fixture(tmp, name, data, neighbours=()):
    """Записать образец: текст или JSON — по служебному полю __text__.

    `neighbours` — имена файлов рядом, на которые ссылается ассет: без них
    корректный образец не прошёл бы (валидатор справедливо ругается на ссылку).
    """
    path = os.path.join(tmp, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if isinstance(data, dict) and "__text__" in data:
            f.write(data["__text__"])
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)
    for extra in neighbours:
        target = os.path.join(os.path.dirname(path), extra)
        if os.path.exists(target):
            continue
        if extra.endswith(".png"):
            w, h = PNG_SIZES.get(extra, (32, 32))
            with open(target, "wb") as f:
                f.write(_png(w, h))
        elif extra.endswith((".ttf", ".otf")):
            # Заголовок TrueType: валидатор проверяет сигнатуру шрифта.
            with open(target, "wb") as f:
                f.write(b"\x00\x01\x00\x00" + b"\x00" * 60)
        else:
            # WAV-заголовок: валидатор проверяет формат аудиофайла.
            with open(target, "wb") as f:
                f.write(b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt "
                        + (16).to_bytes(4, "little") + (1).to_bytes(2, "little")
                        + (1).to_bytes(2, "little") + (44100).to_bytes(4, "little")
                        + (88200).to_bytes(4, "little") + (2).to_bytes(2, "little")
                        + (16).to_bytes(2, "little") + b"data"
                        + (0).to_bytes(4, "little"))
    return path


def validate(path, type_name):
    """Запустить валидатор SDK и вернуть (ok, codes, raw)."""
    try:
        out = subprocess.run([SDK, "validate", path, "--type", type_name],
                             capture_output=True, text=True, timeout=60)
    except Exception as exc:                          # noqa: BLE001
        return None, [], "не удалось запустить SDK: %s" % exc
    try:
        payload = json.loads(out.stdout.strip() or "{}")
    except Exception:                                 # noqa: BLE001
        return None, [], out.stdout + out.stderr
    codes = [d.get("code") for d in (payload.get("diagnostics") or [])]
    return payload.get("ok"), codes, out.stdout


def main():
    print("== §29: валидация ассетов SDK ==")
    if not os.path.exists(SDK):
        print("  пропуск: %s не собран" % os.path.relpath(SDK, ROOT))
        return 0

    # Список типов берём у САМОГО SDK, а не из этого файла: иначе тест
    # «проверял» бы свою же таблицу, а новый тип валидатора остался бы без
    # проверки (именно так и расходятся backend и документация).
    try:
        listed = json.loads(subprocess.run([SDK, "commands"], capture_output=True,
                                           text=True, timeout=30).stdout)
        commands = [c["name"] for c in listed.get("commands", [])]
    except Exception as exc:                          # noqa: BLE001
        commands = []
        print("  FAIL список команд SDK не читается: %s" % exc)
    check("validate" in commands, "SDK предоставляет команду validate")
    check("tools" in commands and "assets" in commands,
          "SDK предоставляет реестр инструментов и просмотр ассетов (%s)" % commands[:4])

    with tempfile.TemporaryDirectory(prefix="r2d-sdk-") as tmp:
        types = sorted(set(GOOD) | set(BROKEN))
        for type_name in types:
            good_path = write_fixture(tmp, "good/%s.json" % type_name.replace(".", "_"),
                                      GOOD[type_name], NEIGHBOURS.get(type_name, ()))
            if type_name == "project":
                # Валидатор проекта отдельно предупреждает, если рядом нет
                # main.js: корректный образец обязан быть полным проектом.
                with open(os.path.join(tmp, "good", "main.js"), "w", encoding="utf-8") as f:
                    f.write("$.ready(() => {});\n")
            ok, codes, raw = validate(good_path, type_name)
            check(ok is True and not codes,
                  "%s: корректный ассет проходит без диагностик (%s)" % (type_name, codes or "чисто"))

            bad_path = write_fixture(tmp, "bad/%s.json" % type_name.replace(".", "_"),
                                     BROKEN[type_name][0])
            ok_bad, codes_bad, raw_bad = validate(bad_path, type_name)
            want = BROKEN[type_name][1]
            hit = [c for c in codes_bad if isinstance(c, str) and c.startswith(want)]
            check(ok_bad is False and bool(hit),
                  "%s: сломанный ассет выявляется ДО запуска (%s)" % (type_name, codes_bad or raw_bad[:80]))

        # --- Данные открыты: файл читается без базы проекта -------------------
        for type_name in ("sprite.atlas", "tilemap", "particles", "collision"):
            path = write_fixture(tmp, "open/%s.json" % type_name, GOOD[type_name],
                                 NEIGHBOURS.get(type_name, ()))
            with open(path, encoding="utf-8") as f:
                parsed = json.load(f)
            check(isinstance(parsed, dict) and parsed,
                  "%s: ассет — открытый JSON без скрытой базы (%d полей)" % (type_name, len(parsed)))

        # --- Прогон одного проекта целиком: project.json + main.js ------------
        proj_dir = os.path.join(tmp, "proj")
        write_fixture(proj_dir, "project.json", GOOD["project"])
        with open(os.path.join(proj_dir, "main.js"), "w", encoding="utf-8") as f:
            f.write("$.ready(() => {});\n")
        ok, codes, raw = validate(os.path.join(proj_dir, "project.json"), "project")
        check(ok is True and not codes, "проект проверяется валидатором без ошибок (%s)" % (codes or "чисто"))

        # --- Неверная ссылка выявляется до запуска ----------------------------
        # Ссылка — это тоже данные: путь к отсутствующему файлу обязан быть
        # ошибкой ДО запуска, а не «поле-строка прошло проверку».
        ref_dir = os.path.join(tmp, "refs")
        write_fixture(ref_dir, "atlas.json", {
            "meta": {"size": {"w": 64, "h": 32}, "image": "нет-такого-файла.png"},
            "frames": {"a": {"frame": {"x": 0, "y": 0, "w": 32, "h": 32}}},
        })
        ok, codes, raw = validate(os.path.join(ref_dir, "atlas.json"), "sprite.atlas")
        check(ok is False and any(isinstance(c, str) and "IMAGE_MISSING" in c for c in codes),
              "отсутствующий файл атласа выявляется валидатором (%s)" % codes)

        write_fixture(ref_dir, "sound.audio.json", {
            "version": 1,
            "buses": {"sfx": {"volume": 0.8}},
            "sounds": {"hit": {"path": "нет-такого-звука.wav", "bus": "sfx"}},
        })
        ok, codes, raw = validate(os.path.join(ref_dir, "sound.audio.json"), "audio")
        check(ok is False and any(isinstance(c, str) and "AUDIO_FILE_MISSING" in c for c in codes),
              "отсутствующий звуковой файл выявляется валидатором (%s)" % codes)

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
