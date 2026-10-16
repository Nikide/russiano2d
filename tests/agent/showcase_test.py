#!/usr/bin/env python3
# ===========================================================================
# Пример §31-6 Спецификации: «Runtime integration» (demos/showcase).
#
# Проверяется законченный сценарий, а не наличие методов:
#   * RmlUi HUD показывает значение, которое игра реально меняет (в т.ч. из
#     маркера вставки), и переживает смену сцены;
#   * переключение языка на ходу меняет строки HUD и диалога;
#   * вставка `$.timeline` доходит до конца и прерывается `stop()`;
#   * переход комнаты (prepare → commit) держит persistent HUD и заменяет мир;
#   * отменённый prepare не публикует сцену (число узлов до/после);
#   * музыкальные слои живут на своих шинах, громкость меняется по слою.
#
# Запуск:
#   python3 tools/run_tests.py showcase_test
#   R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py showcase_test
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "showcase")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    return [line.strip() for line in a.stderr_text().splitlines()
            if "$: ошибка" in line or "[error]" in line]


def step_until(a, expr, limit=80, frames=10):
    """Крутить кадры, пока условие не станет истинным (для авто-режима)."""
    for _ in range(limit):
        a.step(frames)
        if a.eval(expr):
            return True
    return False


def full_line(a, limit=80):
    """Дождаться открытой реплики, допечатать её и вернуть текст целиком."""
    for _ in range(limit):
        a.step(2)
        if a.eval("$.dialog.isOpen()"):
            a.eval("$.dialog.skip(); 'ok'")
            text = a.eval("$.dialog.text()")
            if text and len(text) > 3:
                return text
    return ""


def main():
    with Agent(game=GAME, seed=3) as a:
        a.step(5)

        # --- Старт: комната и persistent HUD ---------------------------------
        check(a.eval("$.scene.current()") == "lobby", "стартовая комната открылась")
        check(a.eval("$.showcase.state().hudReady") is True, "HUD-документ RmlUi загружен")
        check(a.eval("$.showcase.hudVisible()") is True, "HUD виден")
        check(a.eval("$.showcase.hudContent('hud-score')") == "Очки: 0",
              "HUD показывает начальные очки игры")
        check("лобби" in a.eval("$.showcase.hudContent('hud-room')"),
              "HUD показывает текущую комнату")

        # --- Игра меняет значение — HUD показывает ---------------------------
        a.eval("$.showcase.addScore(7); 'ok'")
        a.step(2)
        hud_score = a.eval("$.showcase.hudContent('hud-score')")
        check(hud_score == "Очки: 7", f"HUD обновился из игры ({hud_score})")

        # --- Язык переключается на ходу --------------------------------------
        a.eval("$.showcase.setLang('en'); 'ok'")
        a.step(2)
        hud_score = a.eval("$.showcase.hudContent('hud-score')")
        check(hud_score == "Score: 7", f"HUD переведён на английский ({hud_score})")
        check("lobby" in a.eval("$.showcase.hudContent('hud-room')"),
              "строка комнаты тоже переведена")
        a.eval("$.showcase.setLang('ru'); 'ok'")
        a.step(2)
        check(a.eval("$.showcase.hudContent('hud-score')") == "Очки: 7",
              "возврат на русский работает без перезапуска")

        # --- Вставка: текст диалога переводится ------------------------------
        a.eval("$.showcase.setLang('ru'); $.showcase.playIntro(); 'ok'")
        ru_line = full_line(a)
        check(ru_line.startswith("Интеграция"), f"вставка говорит по-русски ({ru_line!r})")
        a.eval("$.showcase.stopIntro(); 'ok'")
        a.step(3)

        a.eval("$.showcase.setLang('en'); $.showcase.playIntro(); 'ok'")
        en_line = full_line(a)
        check(en_line.startswith("Runtime integration"), f"вставка говорит по-английски ({en_line!r})")
        check(ru_line != en_line, "текст диалога зависит от языка")
        a.eval("$.showcase.stopIntro(); 'ok'")
        a.step(3)
        a.eval("$.showcase.setLang('ru'); 'ok'")

        # --- Вставка доходит до конца и возвращает комнату --------------------
        score_before = a.eval("$.showcase.state().score")
        a.eval("$.showcase.playIntro(); 'ok'")
        a.step(2)
        check(a.eval("$.timeline.running()") is True, "вставка запущена")
        check(a.eval("$.scene.current()") == "showcase-intro",
              "вставка играет своей сценой")
        done = step_until(a, "$.showcase.state().introDone === 1")
        check(done, "вставка дошла до конца в авто-режиме")
        a.step(5)
        st = a.eval("JSON.stringify($.showcase.state())")
        state = json.loads(st)
        check(state["lastReason"] == "end", f"вставка завершилась сама ({state['lastReason']})")
        check(state["introMarkers"] == 1, f"маркер вставки сработал один раз ({state['introMarkers']})")
        check(state["introBeats"] >= 5, f"биты вставки прошли ({state['introBeats']})")
        check(a.eval("$.timeline.ended()") is True, "таймлайн помечен завершённым")
        check(a.eval("$.scene.current()") == "lobby", "после вставки снова комната")
        score_after = a.eval("$.showcase.state().score")
        check(score_after == score_before + 5,
              f"маркер вставки изменил состояние игры ({score_before} → {score_after})")
        a.step(2)
        check(a.eval("$.showcase.hudContent('hud-score')") == "Очки: " + str(score_before + 5),
              "HUD показал значение, изменённое вставкой")
        check(a.eval("$.showcase.hudVisible()") is True,
              "persistent HUD пережил смену сцены вставки")

        # --- Вставку можно прервать -------------------------------------------
        stopped_before = a.eval("$.showcase.state().introStopped")
        a.eval("$.showcase.playIntro(); 'ok'")
        a.step(4)
        check(a.eval("$.timeline.running()") is True, "вставка идёт перед прерыванием")
        check(a.eval("$.showcase.stopIntro()") is True, "stop() принят")
        a.step(4)
        check(a.eval("$.timeline.running()") is False, "вставка остановлена")
        check(a.eval("$.showcase.state().introStopped") == stopped_before + 1,
              "прерывание отмечено отдельно от завершения")
        check(a.eval("$.showcase.state().lastReason") == "manual",
              "причина остановки — manual")
        check(a.eval("$.scene.current()") == "lobby", "прерванная вставка вернула комнату")
        check(a.eval("$.showcase.hudVisible()") is True, "HUD пережил прерывание")

        # --- Музыкальные слои --------------------------------------------------
        check(a.eval("$.showcase.startStems()") == 3, "три слоя запущены (повторно — те же)")

        def bus_volume(name):
            return a.eval("$.audio.buses().filter(b => b.name === '%s')[0].volume" % name)

        check(bus_volume("music.base") > 0, "базовый слой звучит")
        check(a.eval("$.showcase.setStem('music.mid', 0.7)") is True, "громкость слоя задана")
        mid_volume = bus_volume("music.mid")
        check(mid_volume == 0.7, f"средний слой поднят ({mid_volume})")
        check(a.eval("$.audio.gain('music.mid')") == 0.7, "эффективная громкость слоя учитывает шину")
        a.eval("$.showcase.setStem('music.mid', 0); 'ok'")
        check(bus_volume("music.base") > bus_volume("music.mid"),
              "слои независимы: базовый громче выключенного среднего")

        # --- Scoped transition: prepare → discard не публикует сцену ---------
        before_nodes = a.eval("$.scene.counts().nodes")
        check(a.eval("$.showcase.prepareArena()") is True, "prepare арены прошёл")
        staged_nodes = a.eval("$.scene.counts().nodes")
        check(staged_nodes > before_nodes,
              f"prepare построил мир во временной области ({before_nodes} → {staged_nodes})")
        check(a.eval("$.showcase.state().preparedNodes") > 0, "временная область владеет узлами")
        check(a.eval("$.showcase.discardArena()") is True, "prepare отменён")
        a.step(3)
        nodes_after_cancel = a.eval("$.scene.counts().nodes")
        check(nodes_after_cancel == before_nodes,
              f"отменённый prepare не опубликовал узлы ({before_nodes} → {nodes_after_cancel})")
        check(a.eval("$.scene.current()") == "lobby", "текущая сцена осталась прежней")
        check(a.eval("$('#arena-floor').get(0) === undefined") is True,
              "мир отменённой арены убран")

        # --- Scoped transition: prepare → commit ------------------------------
        check(a.eval("$.showcase.prepareArena()") is True, "повторный prepare прошёл")
        check(a.eval("$.showcase.commitArena()") is True, "commit принят")
        a.step(3)
        check(a.eval("$.scene.current()") == "arena", "арена опубликована")
        check(a.eval("$('#arena-floor').get(0) !== undefined") is True, "мир арены на месте")
        check(a.eval("$('#lobby-floor').get(0) === undefined") is True, "мир лобби заменён")
        check(a.eval("$.showcase.hudVisible()") is True, "persistent HUD пережил переход")
        a.step(2)
        hud_room = a.eval("$.showcase.hudContent('hud-room')")
        check("арена" in hud_room, f"HUD показывает новую комнату ({hud_room})")

        # --- Обратно в лобби ---------------------------------------------------
        a.eval("$.showcase.goLobby(); 'ok'")
        a.step(3)
        check(a.eval("$.scene.current()") == "lobby", "вернулись в лобби")
        check(a.eval("$('#lobby-floor').get(0) !== undefined") is True, "мир лобби собран")
        check(a.eval("$('#arena-floor').get(0) === undefined") is True, "мир арены убран")
        check(a.eval("$.showcase.hudVisible()") is True, "HUD жив после всех переходов")

        # --- Ошибок в журнале нет ---------------------------------------------
        errs = errors_of(a)
        check(not errs, f"журнал без ошибок ({errs[:3]})")
        check(a.ping().get("pong") is True, "движок жив")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
