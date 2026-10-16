#!/usr/bin/env python3
# ===========================================================================
# §48: частицы — детерминизм по seed, лимиты пула, жизненный цикл и счётчики.
#
# Что проверяется на живом движке:
#   * один seed — одна и та же эволюция, и не только в первом кадре: позиции,
#     скорости, размер и угол совпадают через 60 кадров и совпадают между
#     ДВУМЯ ЗАПУСКАМИ движка (детерминизм не «внутри сессии»);
#   * restart()/reset() возвращают эмиттер ровно в начало последовательности;
#   * разные seed — разные траектории (иначе seed ничего не значит);
#   * max_particles держит пул при непрерывной эмиссии и при залпе больше пула;
#   * stop() не убивает уже рождённые частицы: они доживают свой срок, а новых
#     не появляется; узел-эмиттер уносит свои частицы с собой (выгрузка
#     поддерева/области), и состояние не остаётся висеть;
#   * create/remove эмиттеров не растит счётчики (текстуры, спрайты, тела);
#   * частицы не трогают презентационный поток случайных чисел ($.fx/тряска):
#     последовательность тряски камеры одинакова с эмиттерами и без них.
#
# Запуск (после сборки):
#   python3 tests/agent/particles_runtime_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "particles")

#: Поля частицы, по которым сравнивается детерминизм (числа, не ссылки).
FIELDS = ("x", "y", "vx", "vy", "size", "angle", "age")


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


def snapshot(a, sel):
    """Все частицы эмиттера как список кортежей чисел (устойчиво к порядку полей)."""
    row = ev(a, "JSON.stringify($('#%s').count() ? "
                "(function(){var out=[];for(var i=0;i<$('#%s').count();i++)"
                "{var p=$('#%s').particleAt(i);out.push([p.x,p.y,p.vx,p.vy,p.size,p.angle,p.age]);}"
                "return out;})() : [])" % (sel, sel, sel))
    return json.loads(row) if row else []


def burst_emitter(sel, seed, spec=""):
    return ("$('<particles>', { id: '%s', amount: 6, one_shot: true, lifetime: 3000,"
            " speed: [120, 120], direction: 30, spread: 40, gravity: 200,"
            " size: [4, 10], angular_velocity: [-90, 90], seed: %s,"
            " max_particles: 64, emitting: false%s }).at(200, 150).appendTo($.world); 'ok'"
            % (sel, seed, spec))


def run_pair(seed_a, seed_b, frames=60):
    """Свежий движок: два эмиттера с заданными seed, снимки через `frames` кадров."""
    with Agent(game=GAME, seed=99) as a:
        a.step(3)
        a.eval("$('#fx').stop(); $('#fx').clear(); $('#target').stop(); $('#target').clear()")
        a.eval(burst_emitter("det_a", seed_a))
        a.eval(burst_emitter("det_b", seed_b))
        a.step(frames)
        return snapshot(a, "det_a"), snapshot(a, "det_b")


def main():
    # --- 1. Детерминизм: одна и две сессии движка, один seed --------------
    first_a, first_b = run_pair(4242, 4242)
    same_len = len(first_a) == len(first_b) == 6
    check(same_len, "оба эмиттера выдали залп из 6 частиц (%d и %d)" % (len(first_a), len(first_b)))
    check(all(len(row) == len(FIELDS) for row in first_a),
          "снимок частицы полный: %s" % (FIELDS,))
    check(same_len and first_a == first_b,
          "один seed — одинаковая эволюция через 60 кадров")
    check(all(abs(x - y) == 0 for ra, rb in zip(first_a, first_b) for x, y in zip(ra, rb)),
          "детерминизм покомпонентный, а не «примерно»")

    # Разные seed — разные траектории (иначе seed не влияет ни на что).
    other_a, _ = run_pair(777, 4242)
    check(not same_len or other_a != first_a, "разные seed — разные траектории")

    # Полная воспроизводимость между ЗАПУСКАМИ движка: тот же seed, тот же
    # результат. Внутрисессионного совпадения для этого мало.
    second_a, _ = run_pair(4242, 4242)
    check(second_a == first_a, "тот же seed в другом запуске движка — та же эволюция")

    with Agent(game=GAME, seed=99) as a:
        a.step(3)
        # Свои эмиттеры фикстуры гасим: иначе их частицы попадают в те же
        # счётчики батча, по которым ниже меряется «не растёт».
        a.eval("$('#fx').stop(); $('#fx').clear(); $('#target').stop(); $('#target').clear()")
        a.eval(burst_emitter("det_a", 4242))
        a.step(60)
        long_run = snapshot(a, "det_a")

        # --- restart() возвращает последовательность в начало --------------
        a.eval("$('#det_a').restart()")
        a.step(60)
        check(snapshot(a, "det_a") == long_run,
              "restart() повторяет ту же последовательность с начала")

        # --- 2. Лимиты пула ------------------------------------------------
        a.eval("$('#det_a').remove()")
        a.eval("$('<particles>', { id: 'cap', amount: 100, max_particles: 8, lifetime: 4000,"
               " rate: 100000, speed: 0, seed: 3, emitting: true }).at(200, 300)"
               ".appendTo($.world); 'ok'")
        a.step(1)
        cap1 = ev(a, "$('#cap').count()", -1)
        a.step(120)
        cap2 = ev(a, "$('#cap').count()", -1)
        check(cap1 == 8, "max_particles=8 держит поток эмиссии в первом же кадре (%s)" % cap1)
        check(cap2 <= 8, "пул не переполняется и через 120 кадров (%s)" % cap2)
        over = ev(a, "$('#cap').burst(1000); $('#cap').count()", -1)
        check(over == 8, "burst(1000) при пуле 8 не превышает пул (%s)" % over)

        # Пул возвращается: после смерти всех частиц счётчик нулевой.
        a.eval("$('#cap').stop(); $('#cap').clear(); 'ok'")
        a.step(2)
        check(ev(a, "$('#cap').count()", -1) == 0, "clear() обнуляет пул")
        a.eval("$('#cap').remove()")

        # --- 3. stop(): рождённые доживают свой срок -----------------------
        # lifetime 300..900 мс (18..54 кадра) при rate 120/с: за 12 кадров
        # набирается десяток частиц, и умирают они вразнобой — видно, что
        # после stop() пул именно «доживает», а не чистится и не замирает.
        a.eval("$('<particles>', { id: 'stopfx', amount: 30, lifetime: [300, 900], rate: 120,"
               " speed: 0, max_particles: 64, seed: 8, emitting: true }).at(100, 100)"
               ".appendTo($.world); 'ok'")
        a.step(12)
        born = ev(a, "$('#stopfx').count()", -1)
        a.eval("$('#stopfx').stop()")
        a.step(1)
        after_stop = ev(a, "$('#stopfx').count()", -1)
        counts = []
        for _ in range(12):
            a.step(6)
            counts.append(ev(a, "$('#stopfx').count()", -1))
        print("  --   stop(): рождено %s, сразу после stop %s, дальше по 6 кадров: %s"
              % (born, after_stop, counts))
        check(born > 1 and after_stop == born,
              "stop() не убивает уже рождённые частицы (%s → %s)" % (born, after_stop))
        check(all(counts[i] <= counts[i - 1] for i in range(1, len(counts))),
              "после stop() пул только убывает: %s" % counts)
        check(any(0 < c < born for c in counts),
              "рождённые частицы уходят постепенно, а не все разом: %s" % counts)
        check(counts[-1] == 0, "через срок жизни пул пуст (%s)" % counts[-1])

        # --- 4. Выгрузка поддерева: эмиттер уносит частицы с собой ---------
        a.eval("$('#stopfx').remove()")
        a.step(2)
        base_sprites = ev(a, "$.gfx.stats().sprites", -1)
        base_limits = ev(a, "$.debug.limits()", {})
        a.eval("$('<group>', { id: 'holder' }).at(300, 300).appendTo($.world); 'ok'")
        a.eval("$('<particles>', { id: 'scoped', amount: 12, lifetime: 9000, rate: 500,"
               " speed: 0, max_particles: 32, seed: 12, emitting: true }).at(0, 0)"
               ".appendTo($('#holder')); 'ok'")
        a.step(3)
        alive = ev(a, "$('#scoped').count()", -1)
        with_particles = ev(a, "$.gfx.stats().sprites", -1)
        a.eval("$('#holder').remove(); 'ok'")
        a.step(3)
        gone = ev(a, "$('#scoped').length", -1)
        after_sprites = ev(a, "$.gfx.stats().sprites", -1)
        after_limits = ev(a, "$.debug.limits()", {})
        check(alive > 0, "эмиттер внутри группы эмитит (%s частиц)" % alive)
        check(with_particles > base_sprites, "частицы попадают в батч спрайтов")
        check(gone == 0, "выгрузка группы уносит узел-эмиттер (%s)" % gone)
        check(after_sprites == base_sprites,
              "после выгрузки спрайты вернулись к базе (%s == %s)"
              % (after_sprites, base_sprites))
        check(all(after_limits.get(k, 0) <= base_limits.get(k, 0) for k in
                  ("textures", "bodies", "sprites", "contact_events")),
              "счётчики движка не выросли после выгрузки: %s"
              % {k: (base_limits.get(k), after_limits.get(k))
                 for k in ("textures", "bodies", "sprites")})

        # Тот же id после выгрузки — чистый эмиттер, а не «призрак» прошлого.
        a.eval(burst_emitter("scoped", 12))
        check(ev(a, "$('#scoped').count()", -1) == 0,
              "новый эмиттер с тем же id начинает с пустого пула")

        # --- 5. Циклы create/remove не растят счётчики ---------------------
        a.eval("$('#scoped').remove(); 'ok'")
        a.step(2)
        before_cycle = ev(a, "$.debug.limits()", {})
        before_sprites = ev(a, "$.gfx.stats().sprites", -1)
        a.eval("(function(){for(var i=0;i<200;i++){"
               "var n=$('<particles>',{id:'cyc_'+i,amount:4,one_shot:true,lifetime:100,"
               "speed:10,seed:i+1,max_particles:8,emitting:false}).at(0,0).appendTo($.world);"
               "n.burst(4);} return 'ok';})()")
        a.step(2)
        a.eval("(function(){for(var i=0;i<200;i++){$('#cyc_'+i).remove();} return 'ok';})()")
        a.step(60)   # 100 мс жизни = 6 кадров, с запасом
        after_cycle = ev(a, "$.debug.limits()", {})
        after_sprites2 = ev(a, "$.gfx.stats().sprites", -1)
        print("  --   цикл 200 эмиттеров: текстуры %s→%s, тела %s→%s, спрайты %s→%s"
              % (before_cycle.get("textures"), after_cycle.get("textures"),
                 before_cycle.get("bodies"), after_cycle.get("bodies"),
                 before_sprites, after_sprites2))
        check(after_cycle.get("textures") == before_cycle.get("textures"),
              "200 create/remove не растят таблицу текстур")
        check(after_cycle.get("bodies") == before_cycle.get("bodies"),
              "200 create/remove не растят тела")
        check(after_cycle.get("sprites") == before_cycle.get("sprites"),
              "200 create/remove не растят спрайты")
        check(after_sprites2 == before_sprites,
              "после циклов батч спрайтов вернулся к базе (%s == %s)"
              % (after_sprites2, before_sprites))

    # --- 6. Частицы не трогают презентационный поток случайных чисел -------
    # Тряска камеры берёт числа из $.fx-потока (fxRandom). Если бы частицы
    # черпали из него же, последовательность сдвинулась бы.
    def shake_trace(with_particles):
        with Agent(game=GAME, seed=5) as b:
            b.step(3)
            b.eval("$('#fx').stop(); $('#fx').clear(); $('#target').clear()")
            b.eval("$.camera.shake(6, 400)")
            if with_particles:
                b.eval("$('<particles>', { id: 'rngfx', amount: 30, lifetime: 2000,"
                       " speed: [50, 200], spread: 360, seed: 31337, max_particles: 64,"
                       " emitting: true }).at(0, 0).appendTo($.world)")
            trace = []
            for _ in range(20):
                b.step(1)
                trace.append(b.eval("$.camera._state.shake_x"))
            return trace

    without = shake_trace(False)
    withp = shake_trace(True)
    check(len(without) == 20 and any(v != 0 for v in without), "тряска камеры даёт числа")
    check(without == withp,
          "поток тряски не сдвигается частицами (первые: %s / %s)"
          % (without[:3], withp[:3]))

    # --- 7. Живость ---------------------------------------------------------
    with Agent(game=GAME, seed=7) as b:
        b.step(5)
        check(b.ping().get("pong") is True, "движок отвечает после работы частиц")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
