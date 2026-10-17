#!/usr/bin/env python3
# ===========================================================================
# DevTools §M4: вкладка VFX — список эффектов, предпросмотр с прогрессом,
# перемотка и экспорт спеки в JSON.
#
# Проверяется живым прогоном настоящей панели RmlUi:
#   * вкладка VFX открывается кликом, строки списка = реестр $.vfx.list()
#     (22 встроенных эффекта), клик по строке выбирает эффект;
#   * «Плей» запускает эффект в центре камеры, прогресс/время видны в
#     состоянии и растут кадрами, «−0.1 с»/«+0.1 с» перематывают handle;
#   * «Стоп» снимает все эффекты (stats().effects = 0);
#   * «Экспорт JSON» пишет спеку через $.fs.write; файл на диске совпадает
#     с $.vfx.get(name), а импорт этого файла даёт ИДЕНТИЧНЫЙ эффект;
#   * в панели видны статус и путь экспорта (не только в тесте).
#
# Запуск: python3 tests/agent/devtools_vfx_test.py
# ===========================================================================

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
EXPORT_DIR = os.path.join("vfx-export")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ui(a, doc, element_id):
    raw = a.eval("engine.ui.getText(%s,%r)" % (doc, element_id)) or ""
    return (raw.replace("&quot;", '"').replace("&lt;", "<")
               .replace("&gt;", ">").replace("&amp;", "&"))


def click(a, doc, element_id):
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def main():
    shutil.rmtree(EXPORT_DIR, ignore_errors=True)
    try:
        with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
            a.step(5)
            check(a.eval("$.devtools.openRuntime()") is True,
                  "панель F1 открылась документом RmlUi")
            doc = a.eval("$.devtools.runtimePanel().doc")

            click(a, doc, "rt-tab-vfx")
            check(a.eval("$.devtools.tabName()") == "vfx", "клик открыл вкладку VFX")

            names = a.eval("JSON.stringify($.devtools.vfx().names)") or "[]"
            names = json.loads(names)
            check(len(names) == 22, f"в списке 22 встроенных эффекта: {len(names)}")
            check("campfire" in ui(a, doc, "rt-vfx-row-0"),
                  f"строка 1 показывает первый эффект: {ui(a, doc, 'rt-vfx-row-0')!r}")
            check("warning" in ui(a, doc, "rt-vfx-row-21"),
                  f"строка 22 показывает последний эффект: {ui(a, doc, 'rt-vfx-row-21')!r}")

            # Строка списка — div внутри прокручиваемого контейнера; клик
            # ведём тем же путём событий документа (engine.ui.click), что и
            # мышиный, — hit-test прокрутки тут не предмет проверки.
            check(a.eval("engine.ui.click(%s,'rt-vfx-row-3')" % doc) is True,
                  "клик по строке списка доставлен документу")
            a.step(2)
            st = json.loads(a.eval("JSON.stringify($.devtools.vfx())"))
            check(st["selected"] == "explosion",
                  f"клик по строке выбрал explosion: {st['selected']}")
            # hit.spark ниже видимой области списка: выбираем публичным API
            # (это тот же путь, что у клика, и он же нужен командам DevTools).
            check(a.eval("$.devtools.vfxSelect(9)") == "hit.spark",
                  "vfxSelect(9) выбрал hit.spark")
            st = json.loads(a.eval("JSON.stringify($.devtools.vfx())"))
            check(st["selected"] == "hit.spark",
                  f"выбор hit.spark в состоянии: {st['selected']}")
            status = ui(a, doc, "rt-vfx-status")
            check("hit.spark" in status and "длительность" in status,
                  f"статус показывает эффект и длительность: {status[:60]!r}")
            check("примитивы:" in status, "статус перечисляет примитивы спеки")

            click(a, doc, "rt-vfx-play")
            a.step(6)
            playing = a.eval("JSON.stringify($.devtools.vfx().playing)")
            playing = json.loads(playing) if playing and playing != "null" else None
            check(playing is not None and playing.get("name") == "hit.spark",
                  f"«Плей» запустил hit.spark: {playing and playing.get('name')}")
            check(playing and playing.get("time", 0) > 0,
                  f"время эффекта идёт кадрами: {playing and playing.get('time')}")
            t0 = playing.get("time", 0)
            # Пауза: время эффекта не идёт, поэтому перемотка проверяется точно.
            a.eval("$.time.pause()")
            click(a, doc, "rt-vfx-back")
            q = a.eval("JSON.stringify($.devtools.vfx().playing)")
            q = json.loads(q) if q and q != "null" else {}
            check(q.get("time", 99) < t0,
                  f"«−0.1 с» перемотал назад: {t0} → {q.get('time')}")
            t1 = q.get("time", 0)
            click(a, doc, "rt-vfx-fwd")
            q = a.eval("JSON.stringify($.devtools.vfx().playing)")
            q = json.loads(q) if q and q != "null" else {}
            check(q.get("time", 0) > t1,
                  f"«+0.1 с» перемотал вперёд: {t1} → {q.get('time')}")
            a.eval("$.time.resume()")

            path = "vfx-export/hit.spark.json"
            a.eval("engine.ui.setValue(%s,'rt-vfx-path',%r)" % (doc, path))
            click(a, doc, "rt-vfx-export")
            check(os.path.isfile(path), f"экспорт создал файл {path}")
            spec_disk = json.load(open(path, encoding="utf-8"))
            spec_api = json.loads(a.eval("JSON.stringify($.vfx.get('hit.spark'))"))
            check(set(spec_disk.keys()) == {"effects"}
                  and spec_disk["effects"].get("hit.spark") == spec_api,
                  "файл {effects:{hit.spark}} совпадает со $.vfx.get('hit.spark')")
            status = ui(a, doc, "rt-vfx-status")
            check("экспортировано" in status and path in status,
                  f"панель показывает путь экспорта: {status[-60:]!r}")

            # Экспорт → импорт: убираем эффект из реестра и грузим файл.
            check(a.eval("$.vfx.remove('hit.spark')") is True, "hit.spark снят из реестра")
            loaded = a.eval("JSON.stringify($.vfx.load(%r))" % path)
            check("hit.spark" in (loaded or ""), f"импорт вернул эффект: {loaded}")
            spec_again = json.loads(a.eval("JSON.stringify($.vfx.get('hit.spark'))"))
            check(spec_again == spec_disk["effects"]["hit.spark"],
                  "экспорт→импорт даёт идентичную спеку")

            click(a, doc, "rt-vfx-stop")
            effects = a.eval("$.vfx.stats().effects")
            check(effects == 0, f"«Стоп» снял все эффекты: effects={effects}")
            check(a.eval("$.devtools.vfx().playing") is None,
                  "состояние панели: плей не запущен")

            errors = a.eval("JSON.stringify($.debug.errors())")
            check(errors in ("[]", "null"), f"ошибок игрового кода нет: {errors[:200]}")
    finally:
        shutil.rmtree(EXPORT_DIR, ignore_errors=True)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
