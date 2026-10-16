#!/usr/bin/env python3
# ===========================================================================
# §45. Атласы: сборка, переиспользование, освобождение, диагностика данных.
#
# Проверяется по живому движку (фикстура tests/fixtures/render_atlas — три
# атласа: две страницы, мультистраничный, с padding/extrusion):
#   * сборка: кадры и страницы принадлежат своим регионам, size() отвечает;
#   * переиспользование: повторный load тем же именем возвращает тот же лист,
#     а load после unload НЕ создаёт новых спрайтов (в движке нет freeSprite,
#     поэтому цикл unload → load раньше растил счётчик спрайтов);
#   * освобождение: unload убирает атлас из реестра, { drop: true } выбрасывает
#     и сборку; 100 циклов не растят ни спрайты, ни текстуры;
#   * отсутствие картинки: отказ со структурной ошибкой, без утечки спрайтов;
#   * invalid frame / duplicate frame / duplicate tag: не молчат, а называют
#     себя кодами в $.atlas.errors()/verify();
#   * повёрнутый кадр: отклоняется целиком, allowRotated: true берёт как есть.
#
# Запуск (после сборки движка):
#   python3 tests/agent/atlas_runtime_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "render_atlas")
FAILURES = []
PAGES = "assets/pages.json"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=23) as a:
        a.step(3)

        # --- Сборка -----------------------------------------------------------
        limits = a.eval("$.debug.limits()")
        print("  --   старт: текстур %s, спрайтов %s" % (limits["textures"], limits["sprites"]))
        check(limits["sprites"] > 0 and limits["textures"] > 0, "атласы фикстуры собраны")
        check(a.eval("atlasSheets.hero.frames().length") == 2, "у hero два кадра")
        check(a.eval("atlasSheets.hero.frame('run_0')") >= 0
              and a.eval("atlasSheets.hero.frame('run_0')") != a.eval("atlasSheets.hero.frame('run_1')"),
              "кадры атласа — разные спрайты движка")
        check(a.eval("JSON.stringify(atlasSheets.hero.size())") == "[64,32]",
              "size() называет размер страницы: %s" % a.eval("JSON.stringify(atlasSheets.hero.size())"))

        # --- Переиспользование по имени ---------------------------------------
        same = a.eval("$.atlas.load('hero', {path: %s, data: atlasData()}) === atlasSheets.hero" % repr(PAGES).replace("'", '"'))
        check(same is True, "повторный load тем же именем возвращает тот же лист")

        # --- unload → load не растит спрайты ----------------------------------
        # Первая сборка имя занимает (спрайты создаются один раз) — её и берём
        # точкой отсчёта: дальше 100 циклов unload → load обязаны не расти.
        a.eval("""(() => {
            const data = atlasData();
            $.atlas.load('cycle', { path: 'assets/pages.json', data });
            return 'ok';
        })()""")
        before = a.eval("[$.debug.limits().sprites, $.debug.limits().textures]")
        cycle = a.eval("""(() => {
            const data = atlasData();
            for (let i = 0; i < 100; i++) {
                $.atlas.unload('cycle');
                $.atlas.load('cycle', { path: 'assets/pages.json', data });
            }
            return [$.debug.limits().sprites, $.debug.limits().textures];
        })()""")
        print("  --   100 циклов unload→load: спрайты/текстуры %s → %s" % (before, cycle))
        check(cycle == before,
              "100 циклов unload→load не создают ресурсов: было %s, стало %s" % (before, cycle))
        check(a.eval("$.atlas.builds()").count("cycle") == 1,
              "сборка атласа переиспользуется и видна в $.atlas.builds(): %s" % a.eval("$.atlas.builds()"))

        # --- Освобождение ------------------------------------------------------
        check(a.eval("$.atlas.unload('cycle')") is True and a.eval("$.atlas.get('cycle')") is None,
              "unload убирает атлас из реестра")
        check(a.eval("$.atlas.names()").count("cycle") == 0, "атласа нет в $.atlas.names()")
        check(a.eval("$.atlas.unload('cycle', { drop: true })") is False
              and a.eval("$.atlas.builds()").count("cycle") == 0,
              "unload { drop: true } выбрасывает и сборку (повторный unload — false)")

        # Забытая сборка: после drop новая загрузка снова создаёт спрайты —
        # это честная цена явного освобождения, и она видна числом.
        dropped = a.eval("""(() => {
            const s0 = $.debug.limits().sprites;
            $.atlas.load('again', { path: 'assets/pages.json', data: atlasData() });
            const s1 = $.debug.limits().sprites;
            $.atlas.unload('again', { drop: true });
            $.atlas.load('again', { path: 'assets/pages.json', data: atlasData() });
            return [s1 - s0, $.debug.limits().sprites - s0];
        })()""")
        print("  --   после drop новая сборка: +%s спрайтов, всего +%s" % (dropped[0], dropped[1]))
        check(dropped[0] > 0 and dropped[1] == dropped[0] * 2,
              "после drop сборка действительно пересобирается (первая сборка +%s, всего +%s)"
              % (dropped[0], dropped[1]))
        a.eval("$.atlas.unload('again', { drop: true }); 'ok'")

        # --- Отсутствие картинки ----------------------------------------------
        a.eval("$.atlas.clearErrors(); $.debug.clearErrors(); 'ok'")
        missing = a.eval("""(() => {
            const s0 = $.debug.limits().sprites;
            const sheet = $.atlas.load('missing', { data: {
                meta: { image: 'assets/no_such_page.png' },
                frames: { a: { x: 0, y: 0, w: 8, h: 8 }, b: { x: 8, y: 0, w: 8, h: 8 } },
            } });
            return { failed: sheet === null, sprites: $.debug.limits().sprites - s0,
                     codes: $.atlas.errors().map(e => e.code) };
        })()""")
        print("  --   нет картинки: %s" % missing)
        check(missing["failed"] is True, "атлас без картинки не загружается")
        check("atlas_page_missing" in missing["codes"], "код atlas_page_missing: %s" % missing["codes"])
        check(missing["sprites"] == 0, "неудачная сборка не создала ни одного спрайта")
        check(a.eval("$.atlas.get('missing')") is None, "неудачный атлас не попал в реестр")
        check(not any(e.get("code") == "atlas_page_missing" for e in a.eval("$.debug.errors()")) is False,
              "ошибка видна и в $.debug.errors()")

        # --- Invalid frame -----------------------------------------------------
        a.eval("$.atlas.clearErrors(); 'ok'")
        invalid = a.eval("""(() => {
            const sheet = $.atlas.load('invalid', { data: {
                meta: { image: 'assets/pages.png' },
                frames: { ok_0: { x: 0, y: 0, w: 32, h: 32 },
                          broken: { x: 0, y: 0, w: 0, h: 32 } },
            } });
            return { loaded: sheet !== null, frames: sheet ? sheet.frames() : [],
                     invalid: sheet ? sheet.invalidFrames() : [],
                     codes: $.atlas.errors().map(e => e.code) };
        })()""")
        print("  --   invalid frame: %s" % invalid)
        check(invalid["loaded"] is True and invalid["frames"] == ["ok_0"],
              "рабочие кадры собраны, битый пропущен: %s" % invalid["frames"])
        check(invalid["invalid"] == ["broken"], "битый кадр назван в invalidFrames(): %s" % invalid["invalid"])
        check("atlas_frame_invalid" in invalid["codes"],
              "код atlas_frame_invalid в $.atlas.errors(): %s" % invalid["codes"])
        verify = a.eval("""JSON.stringify($.atlas.verify({ meta: { image: 'a.png' },
            frames: { ok_0: { x: 0, y: 0, w: 8, h: 8 }, broken: { x: 0, y: 0, w: 0, h: 0 } } }))""")
        check('atlas_frame_invalid' in verify and '"ok":false' in verify,
              "verify() считает битый кадр ошибкой: %s" % verify[:150])

        # --- Duplicate frame ---------------------------------------------------
        a.eval("$.atlas.clearErrors(); 'ok'")
        dup = a.eval("""(() => {
            const s0 = $.debug.limits().sprites;
            const sheet = $.atlas.load('dup', { data: {
                meta: { image: 'assets/pages.png' },
                frames: [ { filename: 'twin', frame: { x: 0, y: 0, w: 8, h: 8 } },
                          { filename: 'twin', frame: { x: 8, y: 0, w: 8, h: 8 } } ],
            } });
            return { failed: sheet === null, sprites: $.debug.limits().sprites - s0,
                     codes: $.atlas.errors().map(e => e.code) };
        })()""")
        print("  --   duplicate frame: %s" % dup)
        check(dup["failed"] is True and "atlas_duplicate_frame" in dup["codes"],
              "два кадра с одним именем отклоняют атлас с кодом atlas_duplicate_frame: %s" % dup["codes"])
        check(dup["sprites"] == 0, "отклонённый атлас не оставил бесхозных спрайтов")

        # --- Duplicate tag -----------------------------------------------------
        a.eval("$.atlas.clearErrors(); 'ok'")
        tag = a.eval("""JSON.stringify($.atlas.verify({
            meta: { image: 'a.png', size: { w: 32, h: 32 }, padding: 1, extrusion: 1,
                    frameTags: [ { name: 'run', from: 0, to: 0 }, { name: 'run', from: 1, to: 1 } ] },
            frames: { f0: { x: 0, y: 0, w: 8, h: 8 }, f1: { x: 16, y: 0, w: 8, h: 8 } } }))""")
        check('atlas_duplicate_tag' in tag, "дубль тега назван предупреждением: %s" % tag[:180])

        # --- Повёрнутый кадр ---------------------------------------------------
        a.eval("$.atlas.clearErrors(); 'ok'")
        rot = a.eval("""(() => {
            const data = { meta: { image: 'assets/pages.png' },
                           frames: { r0: { frame: { x: 0, y: 0, w: 32, h: 32, rotated: true } } } };
            const rejected = $.atlas.load('rot', { data }) === null;
            const allowed = $.atlas.load('rot_ok', { data, allowRotated: true }) !== null;
            return { rejected, allowed, codes: $.atlas.errors().map(e => e.code) };
        })()""")
        check(rot["rejected"] is True and "atlas_rotated_frame" in rot["codes"],
              "поворот отклоняет атлас с кодом atlas_rotated_frame: %s" % rot["codes"])
        check(rot["allowed"] is True, "allowRotated: true берёт регионы как есть")

        # --- Мультистраничность и padding -------------------------------------
        pages = a.eval("JSON.stringify(atlasSheets.paged.pages())")
        check('"name":"body"' in pages and '"name":"props"' in pages, "обе страницы описаны: %s" % pages[:120])
        check(a.eval("atlasSheets.paged.page('prop_0')") == 1, "кадр второй страницы знает свой индекс")
        check(a.eval("atlasSheets.hero.frame('nope')") == -1, "неизвестный кадр — -1, а не чужой спрайт")

        # --- Движок жив --------------------------------------------------------
        frames = a.eval("engine.frame")
        a.step(2)
        check(a.eval("engine.frame") > frames and a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
