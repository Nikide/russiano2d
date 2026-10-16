#!/usr/bin/env python3
# ===========================================================================
# §43. Честность материалов: capability-ответы не «да по умолчанию».
#
# Контракт §43: у материала может быть metadata (normal-карта и т.п.), но
# движок обязан говорить правду о том, что РЕАЛЬНО рисует. Проверяется по
# живому движку (фикстура tests/fixtures/normal_map — материалы, свет, спрайты):
#
#   * бэкенд назван движком (Metal/Vulkan/…) — ответы о возможностях
#     привязаны к этому запуску, а не выдуманы;
#   * каждый объявленный материал либо реально рисуется (кадр меняется,
#     счётчики растут, ошибок рендера нет), либо честно помечен
#     неподдержанным с причиной и объявленным fallback;
#   * запрос неподдержанной возможности (`perPixelNormal: true`) не становится
#     «истиной» в ответе API и оставляет строку с фактической причиной в
#     журнале движка;
#   * `$.gfx.normalPath()` сообщает supported/reason/fallback/required, а
#     документ, на который он ссылается, описывает ТОТ ЖЕ fallback;
#   * поддержанные поля материала (tint, emissive) проверяются пикселями:
#     если поле не применено и не помечено неподдержанным — это провал.
#
# Запуск (после сборки движка):
#   python3 tests/agent/materials_capability_test.py
# ===========================================================================

import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "normal_map")
SPRITE = "tests/fixtures/normal_map/assets/convex.png"
NORMAL_MAP = "tests/fixtures/normal_map/assets/flat_n.png"
SHOTS = os.path.join(ROOT, "build")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, name):
    path = os.path.join(SHOTS, "materials_cap_%s.png" % name)
    a.screenshot(path)
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def main():
    with Agent(game=GAME, seed=9) as a:
        a.step(3)

        # --- Бэкенд назван честно ---------------------------------------------
        gpu_lines = [l for l in a.stderr_text().splitlines() if "GPU-бэкенд" in l]
        backend = gpu_lines[-1].split("GPU-бэкенд:")[-1].strip() if gpu_lines else None
        print("  --   бэкенд: %s" % backend)
        check(bool(backend), "движок называет GPU-бэкенд этого запуска: %s" % backend)

        errors_before = a.eval("$.debug.errors().length")

        # --- Материалы фикстуры объявлены и описаны ---------------------------
        fixture_materials = a.eval("$.gfx.materials()")
        check(isinstance(fixture_materials, list) and len(fixture_materials) >= 2,
              "объявленные материалы перечислены: %s" % fixture_materials)
        described = a.eval("$.gfx.materials().map(n => ({ name: n, spec: $.gfx.material(n) }))")
        check(all(isinstance(m.get("spec"), dict) and "perPixelNormal" in m["spec"] for m in described),
              "у каждого материала читается spec с полем perPixelNormal")

        # --- Нет «да по умолчанию» --------------------------------------------
        path = a.eval("$.gfx.normalPath()")
        print("  --   normalPath: %s" % path)
        check(path.get("supported") is False,
              "попиксельный путь нормалей объявлен неподдержанным (supported=%s)" % path.get("supported"))
        check(bool(path.get("reason")) and bool(path.get("fallback")) and isinstance(path.get("required"), list),
              "причина, fallback и список требований названы: %s" % path)
        check(a.eval("$.gfx.perPixelNormal()") is False, "perPixelNormal() по умолчанию false")
        check(a.eval("$.gfx.perPixelNormal(true)") is False,
              "запрос расширенного режима возвращает false, а не «включено»")
        check(a.eval("$.gfx.perPixelNormal()") is False,
              "после запроса режим остаётся выключенным (обещание не подменено флагом)")

        log_note = [l for l in a.stderr_text().splitlines()
                    if path.get("reason") and path["reason"] in l]
        print("  --   строка журнала: %s" % (log_note[-1][:120] if log_note else "нет"))
        check(bool(log_note),
              "фактическая причина отказа оставлена в журнале движка (не молчание)")

        # Материал с normal-картой не обещает попиксельного света.
        probe = a.eval("""$.gfx.material('cap_normal', { normal: %s, perPixelNormal: true,
                                                        response: { diffuse: 1, ambient: 0.35 } })""" % repr(NORMAL_MAP).replace("'", '"'))
        check(probe.get("perPixelNormal") is False,
              "материал с normal-картой отвечает perPixelNormal=false (не эхо запроса)")
        check(probe.get("normal") == NORMAL_MAP, "normal-карта сохранена как metadata: %s" % probe.get("normal"))

        # Документ, на который ссылается API, описывает тот же fallback.
        doc_path = os.path.join(ROOT, str(path.get("doc") or ""))
        doc_text = ""
        if os.path.isfile(doc_path):
            with open(doc_path, encoding="utf-8") as handle:
                doc_text = handle.read()
        check(bool(doc_text), "документ из normalPath() существует: %s" % path.get("doc"))
        check(path.get("fallback") in doc_text and path.get("reason") in doc_text,
              "документ называет ТОТ ЖЕ fallback и причину (%s)" % path.get("fallback"))

        # --- Материал либо рисуется, либо помечен неподдержанным --------------
        # Две пробы: в тени от лампы (880,480) цветовой множитель видно, а под
        # лампой (280,220) видно именно освещённость — свет там выбеливает цвет,
        # поэтому tint и lit проверяются на своих позициях, а не «как получится».
        a.eval("""$('<sprite>', { id: 'cap_probe' })
                    .at(880, 480).size(96, 96).sprite(%s).appendTo($.world);
                  $('<sprite>', { id: 'cap_probe_lit' })
                    .at(280, 220).size(96, 96).sprite(%s).appendTo($.world); 'ok'"""
               % (repr(SPRITE).replace("'", '"'), repr(SPRITE).replace("'", '"')))
        a.step(2)
        base_errors = a.eval("$.debug.errors().length")
        shots = {}

        cases = [
            ("plain", "$.gfx.material('cap_plain', {})", "пустой материал"),
            ("tint", "$.gfx.material('cap_tint', { tint: '#ff3040' })", "tint"),
            ("emissive", "$.gfx.material('cap_emissive', { emissive: '#ffd080', emissiveStrength: 1 })", "emissive"),
            ("normal", "$.gfx.material('cap_normal')", "normal-карта"),
        ]
        # Материал по умолчанию: без него узел рисуется базовым путём.
        a.eval("$('#cap_probe').material(null); $('#cap_probe_lit').material(null); 'ok'")
        a.step(2)
        shots["none"] = shot(a, "none")
        shots["none_lit"] = shots["none"]

        for key, make, title in cases:
            a.eval(make + "; $('#cap_probe').material('%s'); 'ok'" % ("cap_" + key))
            a.step(2)
            shots[key] = shot(a, key)
            stats = a.eval("$.gfx.stats()")
            errs = a.eval("$.debug.errors().length")
            lit = a.eval("$('#cap_probe').nodes[0].attrs.lit")
            print("  --   %-10s кадр=%s спрайтов=%s ошибок=%s attrs.lit=%s"
                  % (title, shots[key][:8], stats.get("sprites"), errs, lit))
            check(stats.get("sprites", 0) > 0 and errs <= base_errors,
                  "материал %s: кадр нарисован без новых ошибок" % title)

        # tint и emissive — поддержанные поля: они обязаны менять пиксели.
        check(shots["tint"] != shots["plain"],
              "поддержанное поле tint реально применено (кадр отличается)")
        check(shots["emissive"] != shots["plain"],
              "поддержанное поле emissive реально применено (кадр отличается)")
        # normal-карта: объявленный fallback — картинка как у базового материала,
        # и это ровно то, что обещает normalPath().
        check(shots["normal"] == shots["plain"],
              "normal-карта рисуется объявленным fallback 'flat_normal' (пиксели базового материала)")
        a.eval("$('#cap_probe').material(null); 'ok'")

        # --- lit материала: применяется и у материала ПО ИМЕНИ ------------------
        # Раньше `lit` доезжал только у материала-объекта: у именованного он
        # молча терялся (проверено числом — attrs.lit оставался прежним).
        a.eval("$.gfx.material('cap_lit_off', { lit: false }); $('#cap_probe_lit').material('cap_lit_off'); 'ok'")
        a.step(2)
        shots["lit_off"] = shot(a, "lit_off")
        lit_off_value = a.eval("$('#cap_probe_lit').nodes[0].attrs.lit")
        print("  --   lit: false по имени: кадр=%s attrs.lit=%s" % (shots["lit_off"][:8], lit_off_value))
        check(lit_off_value is False,
              "материал по имени применил lit:false (attrs.lit=%s)" % lit_off_value)
        check(shots["lit_off"] != shots["none_lit"],
              "lit:false реально меняет освещённость пробы (кадр отличается от базового)")
        # Возврат к lit:true восстанавливает освещённость — обратимость как факт.
        a.eval("$.gfx.material('cap_lit_on', { lit: true }); $('#cap_probe_lit').material('cap_lit_on'); 'ok'")
        a.step(2)
        shots["lit_on"] = shot(a, "lit_on")
        check(a.eval("$('#cap_probe_lit').nodes[0].attrs.lit") is True,
              "материал по имени вернул lit:true")
        check(shots["lit_on"] == shots["none_lit"],
              "lit:true возвращает прежнюю освещённость (кадр совпал с базовым)")
        a.eval("$('#cap_probe_lit').material(null); 'ok'")

        # Удаление материала возвращает базовый вид — обратимость как факт.
        a.eval("$('#cap_probe').material(null); 'ok'")
        a.step(2)
        check(shot(a, "removed") == shots["none"], "снятие материала возвращает базовый вид")
        check(a.eval("$.gfx.material('cap_plain')") is not None and
              a.eval("$.gfx.material('cap_plain', null)") is None and
              a.eval("$.gfx.material('cap_plain')") is None,
              "материал удаляется по null и больше не числится объявленным")

        # --- Ошибок рендера не появилось ---------------------------------------
        new_errors = a.eval("$.debug.errors().slice(%d).map(e => e.code)" % errors_before)
        print("  --   ошибки за прогон: %s" % new_errors)
        check(not new_errors, "за прогон не появилось ошибок: %s" % new_errors)

        frames = a.eval("engine.frame")
        a.step(2)
        check(a.eval("engine.frame") > frames, "кадры идут после проверок §43")
        check(a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
