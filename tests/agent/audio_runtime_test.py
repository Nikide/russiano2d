#!/usr/bin/env python3
# ===========================================================================
# §47. Аудио-рантайм: голоса, шины, 3D и выгрузка области.
#
# Проверяется по РЕАЛЬНОМУ движку (фикстура tests/fixtures/audiobus):
#   * пул голосов: сколько каналов у движка, что происходит при переполнении;
#   * вытеснение по priority — и через $.sound.play, и через $.audio.play
#     (у шин приоритет обязан доезжать до канала, иначе важная реплика
#     вытесняется первым же шагом по траве);
#   * освобождение: stop, остановка канала движком (трек доиграл) и 100 циклов
#     play/stop — живые голоса и handle'ы не растут;
#   * шины: вложенность, mute/solo, remove/clear — группы микшера движка
#     освобождаются, а не выгорают (их всего R2D_AUDIO_MAX_GROUPS = 8);
#   * 3D: панорама и затухание по расстоянию, совпадение с $.sound.playAt;
#   * §8.2: звук, взятый областью сцены, глохнет при её закрытии, а `keep: true`
#     — явная политика «жить дольше области».
#
# Запуск (после сборки движка):
#   python3 tests/agent/audio_runtime_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "audiobus")
SFX = "assets/audio/sfx/pickup_01.ogg"
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(3)
        total = a.eval("engine.audio.channelCount()")
        print("  --   каналов у движка: %s" % total)
        check(isinstance(total, int) and total > 0, "движок называет число эффект-каналов: %s" % total)

        # --- Голоса: пул и его переполнение ------------------------------------
        a.eval("$.audio.clear(); $.sound.stopAll(0); 'ok'")
        a.step(2)
        pool = a.eval("""(() => {
            const chans = [];
            for (let i = 0; i < %d; i++) {
                const h = $.audio.play('%s', { bus: 'sfx', loop: true, priority: 1 });
                chans.push(h.channel);
            }
            return { chans, active: $.sound.activeChannels(), handles: $.audio.handles().length };
        })()""" % (total, SFX))
        print("  --   пул: active=%s handles=%s" % (pool["active"], pool["handles"]))
        check(all(c >= 0 for c in pool["chans"]) and len(set(pool["chans"])) == total,
              "все %d каналов заняты разными голосами" % total)
        check(pool["active"] == total, "движок видит занятыми ровно %d голосов" % total)

        # --- Вытеснение по priority (через $.audio) ----------------------------
        # Раньше priority не доезжал до канала: $.audio.play терял его, и звук
        # играл с приоритетом 0 — то есть так, как будто приоритета нет.
        evict = a.eval("""(() => {
            const h = $.audio.play('%s', { bus: 'sfx', loop: true, priority: 9 });
            return { channel: h.channel, requested: h.priority,
                     engine: h.channel >= 0 ? $.sound.priorityOf(h.channel) : -1 };
        })()""" % SFX)
        print("  --   priority: %s" % evict)
        check(evict["channel"] >= 0, "звук с высоким приоритетом получил голос при полном пуле")
        check(evict["engine"] == 9,
              "$.audio.play доносит priority до канала (просили 9, у канала %s)" % evict["engine"])

        # Обратная сторона политики: менее важный звук НЕ вытесняет важный.
        weak = a.eval("""(() => {
            const keep = $.audio.handles().filter(h => h.channel >= 0 && $.sound.priorityOf(h.channel) === 9);
            const h = $.audio.play('%s', { bus: 'sfx', loop: true, priority: 0 });
            const still = $.audio.handles().filter(x => x.channel >= 0 && $.sound.priorityOf(x.channel) === 9);
            return { channel: h.channel, before: keep.length, after: still.length,
                     active: $.sound.activeChannels() };
        })()""" % SFX)
        print("  --   отказ слабому: %s" % weak)
        check(weak["channel"] < 0, "менее важный звук при полном пуле не играет (channel=-1)")
        check(weak["after"] >= weak["before"] and weak["after"] >= 1,
              "важный голос не вытеснен слабым (важных было %s, стало %s)" % (weak["before"], weak["after"]))
        a.step(2)
        check(a.eval("$.audio.handles().every(h => h.channel >= 0)"),
              "незапустившийся звук убран из живых handle'ов на следующем тике")

        # --- Освобождение голосов ---------------------------------------------
        a.eval("$.audio.stopAll(0); 'ok'")
        a.step(2)
        check(a.eval("$.sound.activeChannels()") == 0 and a.eval("$.audio.handles().length") == 0,
              "stopAll освобождает все голоса и handle'ы")

        # Трек доиграл — канал освободил САМ движок: handle обязан уйти из
        # списка на следующем тике (иначе долгая игра копит мёртвые обёртки).
        freed = a.eval("""(() => {
            const h = $.audio.play('%s', { bus: 'sfx', loop: true });
            engine.audio.stop(h.channel, 0);
            return { channel: h.channel, playing: $.sound.playing(h.channel), handles: $.audio.handles().length };
        })()""" % SFX)
        a.step(2)
        after = a.eval("[$.sound.playing(%d), $.audio.handles().length, $.sound.activeChannels()]" % freed["channel"])
        print("  --   движок освободил канал: %s → %s" % (freed, after))
        check(freed["playing"] is False and after[0] is False and after[1] == 0 and after[2] == 0,
              "handle исчезает, когда канал освободил движок (не только stop игрока)")

        # --- 100 циклов play/stop: голоса не растут ---------------------------
        a.eval("""(() => {
            $.audio.play('%s', { bus: 'sfx', loop: true });
            for (let i = 0; i < 100; i++) {
                const h = $.audio.play('%s', { bus: 'sfx', loop: true, priority: 2 });
                h.stop(0);
            }
            return 'ok';
        })()""" % (SFX, SFX))
        a.step(3)
        cycles = a.eval("[$.sound.activeChannels(), $.audio.handles().length]")
        print("  --   после 100 циклов: active=%s handles=%s" % (cycles[0], cycles[1]))
        check(cycles == [1, 1], "100 циклов play/stop оставляют один живой голос и один handle: %s" % cycles)
        a.eval("$.audio.stopAll(0); 'ok'")
        a.step(1)

        # --- Шины: вложенность, mute, solo ------------------------------------
        a.eval("$.audio.clear();"
               "$.audio.bus('a', { volume: 0.5 });"
               "$.audio.bus('b', { volume: 0.5, parent: 'a' });"
               "$.audio.bus('c', { volume: 0.5, parent: 'b' }); 'ok'")
        check(abs(a.eval("$.audio.gain('c')") - 0.125) < 1e-6,
              "gain трёхуровневой цепочки = 0.5³ (%s)" % a.eval("$.audio.gain('c')"))
        a.eval("$.audio.mute('a', true); 'ok'")
        check(a.eval("$.audio.gain('c')") == 0, "mute корня гасит всю ветку")
        a.eval("$.audio.mute('a', false); $.audio.solo('b', true); 'ok'")
        solo = a.eval("[$.audio.gain('a'), $.audio.gain('b'), $.audio.gain('c')]")
        print("  --   solo(b): %s" % solo)
        check(solo[0] > 0 and solo[1] > 0 and solo[2] > 0 and solo[1] == 0.25,
              "solo слышен вместе с предками и потомками: %s" % solo)
        a.eval("$.audio.solo('b', false); 'ok'")

        # --- Группы микшера: remove и clear их освобождают --------------------
        # Групп у движка всего 8. Если шина их не возвращает, следующая шина
        # остаётся без группы — и её эффект молча не применяется вовсе.
        groups = a.eval("""(() => {
            $.audio.clear();
            const slots = [];
            for (let cycle = 0; cycle < 4; cycle++) {
                const names = [];
                for (let i = 0; i < 3; i++) {
                    const n = 'cyc' + cycle + '_' + i;
                    names.push(n);
                    $.audio.bus(n, { volume: 0.5 });
                }
                const routes = $.audio.routes().buses;
                slots.push(names.map(n => (routes.find(b => b.name === n) || {}).group));
                $.audio.clear();
            }
            return slots;
        })()""")
        print("  --   группы шин по циклам (8 групп у движка): %s" % groups)
        check(all(isinstance(g, int) and g >= 0 for cycle in groups for g in cycle),
              "шина всегда получает группу микшера — clear() их освобождает: %s" % groups)

        # remove(): дети уходят к родителю, группа возвращается движку.
        moved = a.eval("""(() => {
            $.audio.clear();
            $.audio.bus('grp', { volume: 0.5 });
            $.audio.bus('kid', { volume: 0.5, parent: 'grp' });
            const g = $.audio.routes().buses.find(b => b.name === 'grp').group;
            $.audio.remove('grp');
            const after = $.audio.routes().buses.find(b => b.name === 'kid');
            return { group: g, parent: after.parent, gain: $.audio.gain('kid') };
        })()""")
        print("  --   remove: %s" % moved)
        check(moved["parent"] == "master" and abs(moved["gain"] - 0.5) < 1e-6,
              "после remove потомок слушается от master: %s" % moved)

        # --- 3D: панорама и затухание ----------------------------------------
        a.eval("$.audio.clear(); $.audio.listener(0, 0); 'ok'")
        near = a.eval("""(() => {
            const h = $.audio.playAt('%s', 350, 0, { bus: 'sfx', volume: 1, falloff: { max: 700 } });
            return { channel: h.channel, pan: h.pan(), volume: h.volume(),
                     enginePan: engine.audio.channelPan(h.channel),
                     engineVolume: engine.audio.channelVolume(h.channel) };
        })()""" % SFX)
        print("  --   playAt(350, max=700): %s" % near)
        check(abs(near["pan"] - 1) < 1e-6, "источник справа даёт pan = 1")
        check(abs(near["volume"] - 0.5) < 1e-6, "на середине радиуса громкость 0.5")
        check(abs(near["enginePan"] - 1) < 1e-6 and abs(near["engineVolume"] - 0.5) < 1e-3,
              "то же видно на канале движка (pan=%s, volume=%s)" % (near["enginePan"], near["engineVolume"]))
        a.eval("$.audio.stopAll(0); 'ok'")

        far = a.eval("""(() => {
            const h = $.audio.playAt('%s', 0, 900, { bus: 'sfx', volume: 1, falloff: { max: 700 } });
            return { volume: h.volume(), engineVolume: engine.audio.channelVolume(h.channel) };
        })()""" % SFX)
        check(far["volume"] == 0 and far["engineVolume"] == 0,
              "за границей слышимости громкость 0 у handle и у канала: %s" % far)
        a.eval("$.audio.stopAll(0); 'ok'")

        # Слушатель едет вместе с узлом: панорама считается от него.
        tracked = a.eval("""(() => {
            const node = $('<rect>', { id: 'listener_node' }).at(120, 40).size(8, 8).appendTo($.world);
            $.audio.listener(node);
            const p = $.audio.listener();
            node.at(300, 40);
            return { first: [p.x, p.y], moved: [$.audio.listener().x, $.audio.listener().y] };
        })()""")
        print("  --   слушатель-узел: %s" % tracked)
        check(tracked["first"] == [120, 40] and tracked["moved"] == [300, 40],
              "слушатель-узел читается по текущей позиции узла: %s" % tracked)
        a.eval("$.audio.listener(0, 0); $('#listener_node').remove(); 'ok'")

        # --- §8.2: выгрузка области глушит её звук ----------------------------
        # Сначала закрываем АНОНИМНУЮ область (владелец звуков верхнего уровня) —
        # звук, взятый настоящей областью, обязан это пережить. Иначе он
        # записан не в свою область и выгрузка комнаты его не снимет.
        a.eval("$.sound.stopAll(0); $.scene.scope().close(); 'ok'")
        a.step(2)
        area = a.eval("""(() => {
            let ch = -1;
            $.scene.scope('area_snd', () => {
                ch = $.sound.play('%s', { loop: true });
            });
            return { channel: ch, playing: $.sound.playing(ch), scopes: $.scene.scopes() };
        })()""" % SFX)
        print("  --   звук области: %s" % area)
        check(area["channel"] >= 0 and area["playing"] is True, "звук области играет")
        check("area_snd" in area["scopes"], "область звука открыта: %s" % area["scopes"])
        a.eval("$.scene.scope().close(); 'ok'")
        a.step(2)
        check(a.eval("$.sound.playing(%d)" % area["channel"]) is True,
              "звук принадлежит ИМЕНОВАНОЙ области, а не анонимной: закрытие анонимной его не трогает")
        a.eval("$.scene.closeScope('area_snd'); 'ok'")
        a.step(2)
        closed = a.eval("[$.sound.playing(%d), $.sound.activeChannels()]" % area["channel"])
        print("  --   после закрытия области: %s" % closed)
        check(closed[0] is False and closed[1] == 0,
              "§8.2: закрытие области снимает её звук (playing=%s, active=%s)" % (closed[0], closed[1]))

        # `keep: true` — явная политика «звук живёт дольше области».
        kept = a.eval("""(() => {
            let ch = -1;
            $.scene.scope('area_keep', () => { ch = $.sound.play('%s', { loop: true, keep: true }); });
            return ch;
        })()""" % SFX)
        a.eval("$.scene.closeScope('area_keep'); 'ok'")
        a.step(2)
        check(a.eval("$.sound.playing(%d)" % kept) is True,
              "keep: true оставляет звук жить после закрытия области (канал %d)" % kept)
        a.eval("$.sound.stop(globalThis.__kept === undefined ? %d : globalThis.__kept, 0); $.audio.stopAll(0); 'ok'" % kept)
        a.step(1)

        # Анонимный владелец верхнего уровня: прежнее поведение не сломано —
        # так играет звук вне области, и его снимает область загрузчика.
        anon = a.eval("$.sound.play('%s', { loop: true })" % SFX)
        check(a.eval("$.sound.playing(%d)" % anon) is True, "звук вне области играет (канал %d)" % anon)
        a.eval("$.scene.scope().close(); 'ok'")
        a.step(2)
        check(a.eval("$.sound.playing(%d)" % anon) is False,
              "звук верхнего уровня снимается анонимной областью (как в §8.2-тесте выгрузки)")
        a.eval("$.audio.stopAll(0); $.audio.clear(); 'ok'")

        # --- Движок жив --------------------------------------------------------
        frames = a.eval("engine.frame")
        a.step(3)
        check(a.eval("engine.frame") > frames, "кадры идут после всех операций со звуком")
        check(a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
