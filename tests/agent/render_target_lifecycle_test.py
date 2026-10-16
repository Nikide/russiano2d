#!/usr/bin/env python3
# ===========================================================================
# §40/§40.1: жизненный цикл render target'а игры ($.viewport).
#
# Контракт, который здесь проверяется на живом движке:
#   * create → use → release: размеры, счётчики текстур/вьюпортов и список
#     целей кадра (engine.renderInfo().targets) сходятся на каждом шаге;
#   * связывание живёт КАДР: bind() действует в том кадре, где вызван, и
#     движок сам сообщает об этом (renderInfo().viewport.bound). Проверяется
#     изнутри кадра — иначе связывание уже сброшено началом следующего;
#   * release освобождает всё: id переиспользуется, в таблицах текстур и
#     спрайтов не остаётся мёртвых слотов, повторный destroy() возвращает
#     false, а bind() на уничтоженный id — false (никаких stale handles);
#   * 100 циклов create/use/release возвращают ВСЕ счётчики к базовым
#     (текстуры, вьюпорты и таблица спрайтов): слот спрайта переиспользуется
#     (src/render.c, r2d_sprite_create — ищет мёртвую строку);
#   * потолок вьюпортов соблюдается, а не «сколько получится»;
#   * resize окна не ломает уже созданную цель и не растит счётчики.
#
# Запуск (после сборки):
#   python3 tests/agent/render_target_lifecycle_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")

#: Сколько циклов create/use/release гоняем в стресс-проверке §40.1.
CYCLES = 100


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def counters(a):
    """Живые счётчики: таблица текстур, вьюпорты, спрайты — из движка."""
    lim = ev(a, "$.debug.limits()", {}) or {}
    info = ev(a, "$.debug.render()", None) or {}
    tex = (info.get("info") or {}).get("textures") or {}
    return {
        "textures": lim.get("textures"),
        "viewports": lim.get("viewports"),
        "sprites": lim.get("sprites"),
        "tex_count": tex.get("count"),
    }


#: Счётчики-«занятость»: обязаны возвращаться к базе ТОЧНО.
STABLE = ("textures", "viewports", "tex_count")


def same_resources(before, after):
    return all(before.get(k) == after.get(k) for k in STABLE)


def sprites_bound(base_sprites, viewports_max):
    """Потолок таблицы спрайтов: high-water mark, а не число циклов.

    Таблица спрайтов не укорачивается: слот мёртвого спрайта переиспользуется
    (src/render.c, r2d_sprite_create), но длина массива остаётся. Поэтому рост
    допустим ровно на число ОДНОВРЕМЕННО живых целей (плюс первая строка) — и ни
    одной строки сверх этого, сколько бы циклов create/destroy ни прошло.
    """
    return (base_sprites or 0) + int(viewports_max) + 1


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(5)

        # --- 1. Поддержка и база ---------------------------------------------
        check(ev(a, "$.viewport.supported") is True, "render target поддержан сборкой")
        check(ev(a, "$.viewport.count()") == 0, "на старте живых вьюпортов нет")
        check(ev(a, "$.viewport.bound()") is None, "на старте ничего не связано")
        base = counters(a)
        max_vp = ev(a, "$.debug.limits().viewports_max", 0)
        print("  --   база: %s, потолок вьюпортов %s" % (base, max_vp))
        check(base["viewports"] == 0 and base["textures"] == base["tex_count"],
              "счётчик текстур limits() и renderInfo() сходятся")

        # Связывание — на кадр: ставим флаг, который читает рендер-хук.
        ev(a, "$.store.set('vp_bind', -1);"
               "$.render(() => { var id = $.store.get('vp_bind');"
               "  $.viewport.bind(id);"
               "  var r = $.debug.render();"
               "  $.store.set('frame_bound', String($.viewport.bound()));"
               "  $.store.set('frame_engine', r && r.info ? String(r.info.viewport.bound) : 'null');"
               "  $.store.set('frame_targets', r && r.info ? r.info.targets.length : -1); }); 'ok'")
        a.step(1)

        # --- 2. create: размеры и счётчики ------------------------------------
        vid = ev(a, "$.viewport.create(64, 48)")
        check(isinstance(vid, int) and vid >= 0, "create(64, 48) вернул id (%s)" % vid)
        check(ev(a, "$.viewport.size(%d)" % vid) == {"w": 64, "h": 48}, "size() знает размер цели")
        check(ev(a, "$.viewport.count()") == 1, "count() видит одну цель")
        made = counters(a)
        check(made["textures"] == base["textures"] + 1,
              "таблица текстур выросла на одну (%s → %s)" % (base["textures"], made["textures"]))
        check(made["viewports"] == 1, "счётчик вьюпортов вырос (%s)" % made["viewports"])
        check(made["tex_count"] == made["textures"], "renderInfo().textures.count совпал с limits()")

        # --- 3. use: кадр действительно рисуется в цель -----------------------
        ev(a, "$.store.set('vp_bind', %d)" % vid)
        a.step(1)
        bound = ev(a, "$.store.get('frame_bound')")
        engine_says = ev(a, "$.store.get('frame_engine')")
        check(bound == str(vid), "в кадре bind() связал цель (bound=%s)" % bound)
        check(engine_says == str(vid),
              "движок подтверждает связывание в этом кадре (renderInfo=%s)" % engine_says)
        check(ev(a, "$.viewport.bound()") == vid,
              "после кадра со связыванием цель видна связанной (сброс — в начале кадра)")
        sprite = ev(a, "$.viewport.sprite(%d)" % vid)
        check(isinstance(sprite, int) and sprite >= 0,
              "у цели есть спрайт прошлого кадра (%s)" % sprite)
        check(ev(a, "$.viewport.draw(%d, 10, 10, 32, 32, { alpha: 0.5 })" % vid) is True,
              "прошлый кадр цели рисуется спрайтом")
        a.step(1)
        check(ev(a, "$.viewport.count()") == 1, "цель жива после кадров отрисовки в неё")

        # --- 4. release: ничего не остаётся -----------------------------------
        check(ev(a, "$.viewport.destroy(%d)" % vid) is True, "destroy() освободил цель")
        check(ev(a, "$.viewport.destroy(%d)" % vid) is False,
              "повторный destroy() — false (нет stale handle)")
        check(ev(a, "$.viewport.size(%d)" % vid) is None, "size() уничтоженной цели — null")
        check(ev(a, "$.viewport.sprite(%d)" % vid) == -1, "sprite() уничтоженной цели — -1")
        check(ev(a, "$.viewport.bind(%d)" % vid) is False, "bind() на уничтоженный id — false")
        free = counters(a)
        check(same_resources(free, base),
              "слоты текстур и вьюпортов вернулись к базе (%s == %s)" % (free, base))
        check((free["sprites"] or 0) <= sprites_bound(base["sprites"], max_vp),
              "таблица спрайтов не выросла сверх одной строки на цель (%s ≤ %s)"
              % (free["sprites"], sprites_bound(base["sprites"], max_vp)))
        ev(a, "$.store.set('vp_bind', -1)")
        a.step(1)
        check(ev(a, "$.store.get('frame_engine')") == "-1",
              "в кадре без bind() цель не связана (renderInfo=-1)")

        # --- 5. Слот переиспользуется -----------------------------------------
        ids = []
        for _ in range(3):
            j = ev(a, "$.viewport.create(32, 32)")
            ids.append(j)
            ev(a, "$.viewport.destroy(%d)" % j)
        check(len(set(ids)) == 1 and ids[0] is not None,
              "цикл create/destroy переиспользует один слот (%s)" % ids)

        # --- 6. Стресс §40.1: 100 циклов create → use → release ---------------
        ev(a, "$.store.set('vp_bind', 0)")
        peak = base
        # Точка отсчёта роста таблицы спрайтов — прямо перед циклом: выше уже
        # были свои create/destroy, и их слоты в базу не входят.
        cycle_base = counters(a)
        for i in range(CYCLES):
            cid = ev(a, "$.viewport.create(64, 48)")
            if cid is None:
                check(False, "цикл %d: create() не дал id" % i)
                break
            ev(a, "$.store.set('vp_bind', %d)" % cid)
            a.step(1)                      # кадр, нарисованный в цель
            cur = counters(a)
            if (cur["viewports"] or 0) > (peak["viewports"] or 0):
                peak = cur
            ev(a, "$.viewport.destroy(%d)" % cid)
            ev(a, "$.store.set('vp_bind', -1)")
        a.step(2)
        after = counters(a)
        print("  --   %d циклов: пик %s, после %s, база %s" % (CYCLES, peak, after, base))
        check(same_resources(after, base), "%d циклов вернули слоты к базе" % CYCLES)
        check(ev(a, "$.viewport.count()") == 0, "после циклов живых вьюпортов нет")
        check((peak["viewports"] or 0) == 1,
              "в цикле живёт ровно одна цель, счётчик не накапливается (%s)" % peak["viewports"])
        # §40.1: счётчики возвращаются к baseline — ВСЕ, включая таблицу
        # спрайтов: слот мёртвого спрайта переиспользуется (src/render.c,
        # r2d_sprite_create), поэтому 100 циклов не оставляют 100 мёртвых строк.
        grow = (after["sprites"] or 0) - (cycle_base["sprites"] or 0)
        check(grow == 0,
              "таблица спрайтов не выросла НИ НА СТРОКУ за %d циклов (рост %s)"
              % (CYCLES, grow))
        check((after["sprites"] or 0) <= sprites_bound(base["sprites"], max_vp),
              "таблица спрайтов ограничена числом живых целей, а не циклами (%s ≤ %s)"
              % (after["sprites"], sprites_bound(base["sprites"], max_vp)))

        # --- 7. Потолок вьюпортов соблюдается ---------------------------------
        created = []
        for _ in range(int(max_vp) + 1):
            created.append(ev(a, "$.viewport.create(16, 16)"))
        ok_ids = [i for i in created if isinstance(i, int) and i >= 0]
        check(len(ok_ids) == int(max_vp),
              "создано ровно viewports_max=%s целей" % max_vp)
        check(created[-1] is None, "сверх потолка create() возвращает null")
        check(ev(a, "$.viewport.count()") == int(max_vp), "count() на потолке")
        for i in ok_ids:
            ev(a, "$.viewport.destroy(%d)" % i)
        a.step(1)
        check(ev(a, "$.viewport.count()") == 0, "все цели освобождены")
        ceiling = counters(a)
        check(same_resources(ceiling, base), "после потолка слоты снова базовые (%s)" % ceiling)
        check((ceiling["sprites"] or 0) <= sprites_bound(base["sprites"], max_vp),
              "после %s одновременных целей таблица спрайтов в потолке (%s ≤ %s)"
              % (max_vp, ceiling["sprites"], sprites_bound(base["sprites"], max_vp)))

        # --- 8. Мусорные размеры ----------------------------------------------
        tiny = ev(a, "$.viewport.create(0, 0)")
        check(ev(a, "$.viewport.size(%d)" % tiny) == {"w": 1, "h": 1},
              "create(0, 0) даёт минимальную цель 1×1")
        ev(a, "$.viewport.destroy(%d)" % tiny)
        check(ev(a, "$.viewport.create(100000, 100000)") is None,
              "create(100000, 100000) отклонён (потолок размера)")
        check(ev(a, "$.viewport.count()") == 0, "отклонённый create ничего не занял")

        # --- 9. Resize окна: цель переживает смену размера --------------------
        keep = ev(a, "$.viewport.create(96, 64)")
        ev(a, "$.store.set('vp_bind', %d)" % keep)
        a.step(1)
        before_w = ev(a, "engine.width")
        ev(a, "$.window.resize(1024, 640)")
        a.step(3)
        after_w = ev(a, "engine.width")
        check(after_w == 1024 and before_w != after_w,
              "окно изменило размер (%s → %s)" % (before_w, after_w))
        check(ev(a, "$.viewport.size(%d)" % keep) == {"w": 96, "h": 64},
              "цель сохранила свой размер после resize")
        check(ev(a, "$.store.get('frame_engine')") == str(keep),
              "после resize кадр по-прежнему рисуется в цель")
        check(counters(a)["viewports"] == 1, "resize не создал лишних вьюпортов")
        ev(a, "$.window.resize(%d, %d)" % (before_w, ev(a, "engine.height")))
        a.step(2)
        check(ev(a, "$.viewport.count()") == 1, "цель жива после возврата размера")

        # --- 10. Освобождение и живость ---------------------------------------
        ev(a, "$.store.set('vp_bind', -1)")
        a.step(1)
        check(ev(a, "$.viewport.unbind()") is True, "unbind() отвечает true")
        ev(a, "$.viewport.destroy(%d)" % keep)
        a.step(2)
        final = counters(a)
        check(same_resources(final, base),
              "после всех проверок слоты базовые (%s)" % final)
        check((final["sprites"] or 0) <= sprites_bound(base["sprites"], max_vp),
              "таблица спрайтов за весь тест не превысила потолок живых целей (%s ≤ %s)"
              % (final["sprites"], sprites_bound(base["sprites"], max_vp)))
        check(a.ping().get("pong") is True, "движок отвечает после циклов render target'а")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
