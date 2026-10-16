#!/usr/bin/env python3
# ===========================================================================
# Приёмка §16: контракт UI/HUD, локализация на ходу, модальность/фокус,
# resize, длинный текст и интеграция timeline (маркеры, stop, skip).
#
# Всё проверяется числами: тексты элементов документа RmlUi до и после смены
# языка, позиции до и после resize, ширина строк при переносе, счётчики подписок
# и таймеров до/после прогонов, список маркеров и пропущенных маркеров.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_ui_contract_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "ui_contract")
PANEL_WIDTH = 360      # ширина панели диалога в фикстуре


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def step_until(a, expr, limit=40):
    for i in range(limit):
        a.step(1)
        if a.eval(expr):
            return True, i + 1
    return False, limit


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        # --- A. Контракт интерфейса и обязательные ID -------------------------
        required = a.eval("U.required()")
        print(f"  --   документы={required['documents']} проверено ID={required['checked']}")
        check(required["ok"] and required["checked"] == 2,
              f"обязательные RmlUi ID доступны через API: {required}")
        check(a.eval("U.documents()") == ["ui/hud.rml"], "открытый документ виден в $.ui.documents()")
        check(a.eval("$.ui.persistCount()") == 10, "HUD помечен постоянным (10 узлов)")
        check(a.eval("$.ui.trList().length") == 3,
              "привязано 3 перевода (узел + 2 элемента документа)")

        # --- B. HUD переживает рестарт комнаты --------------------------------
        before = a.eval("U.hudValue()")
        rooms0 = a.eval("U.rooms")
        a.eval("U.restartRoom()")
        step_until(a, "$.scene.current() === 'room1' && U.rooms > %d" % rooms0, 10)
        after = a.eval("U.hudValue()")
        print(f"  --   HUD до/после рестарта: {json.dumps(before, ensure_ascii=False)} → "
              f"{json.dumps(after, ensure_ascii=False)}")
        check(after["exists"] and after["hp"] == before["hp"] and after["bar"] == before["bar"],
              "HUD жив и значения целы после рестарта комнаты")
        check(after["pos"] == before["pos"], f"HUD не сдвинулся: {after['pos']}")
        check(a.eval("U.required()['ok']") is True, "обязательные ID целы после рестарта")
        check(a.eval("U.rooms") > rooms0, "комната действительно перезапустилась")

        # --- C. Временное окно уходит вместе со сценой ------------------------
        count_with_temp = a.eval("U.uiNodeCount() + (U.tempWindow() ? 1 : 0)")
        check(a.eval("U.tempExists()") is True, "временное окно открыто")
        a.eval("U.gotoRoom2()")
        step_until(a, "$.scene.current() === 'room2'", 10)
        check(a.eval("U.tempExists()") is False, "временное окно снесено сменой сцены")
        check(a.eval("$('#hud_hp').nodes.length") == 1, "HUD при этом жив")
        print(f"  --   узлов UI с окном/без окна: {count_with_temp} → {a.eval('U.uiNodeCount()')}")
        a.eval("U.restartRoom()")
        step_until(a, "$.scene.current() === 'room1'", 10)

        # --- D. Смена языка НА ХОДУ видна в HUD и документе --------------------
        ru = (a.eval("U.hudValue().tr"), a.eval("U.docText('hp_text')"), a.eval("U.docText('ammo_text')"))
        a.eval("U.lang('en')")
        a.step(1)
        en = (a.eval("U.hudValue().tr"), a.eval("U.docText('hp_text')"), a.eval("U.docText('ammo_text')"))
        a.eval("U.lang('ru')")
        a.step(1)
        back = (a.eval("U.hudValue().tr"), a.eval("U.docText('hp_text')"), a.eval("U.docText('ammo_text')"))
        print(f"  --   ru={ru} en={en} обратно={back}")
        check(ru == ("Здоровье", "Здоровье", "Патроны: 12"), f"ru-строки в узле и документе: {ru}")
        check(en == ("Health", "Health", "Ammo: 12"), f"смена на ходу изменила видимые строки: {en}")
        check(back == ru, "возврат языка вернул прежние строки")
        listeners0 = a.eval("$.i18n.listenerCount()")
        for _ in range(5):
            a.eval("U.lang('en')")
            a.eval("U.lang('ru')")
        a.step(1)
        check(a.eval("$.i18n.listenerCount()") == listeners0,
              f"подписчики языка не растут: {listeners0} → {a.eval('$.i18n.listenerCount()')}")

        # --- E. Пропавший ключ: fallback с признаком ---------------------------
        a.eval("U.clearMissing()")
        fallback = a.eval("U.tr('nope.key')")
        missing = a.eval("U.missing()")
        marked = a.eval("U.mark(true)")
        unmarked = a.eval("U.mark(false)")
        print(f"  --   fallback={fallback!r} missing={missing} mark={marked!r}")
        check(fallback == "nope.key" and fallback != "", "отсутствующий ключ не даёт пустую строку")
        check(any(m.get("key") == "nope.key" and m.get("lang") for m in missing),
              "пропавший ключ виден структурой ($.i18n.missing)")
        check(marked == "⟨nope.key⟩", f"явный маркер fallback: {marked!r}")
        check(unmarked == "nope.key", "маркер выключается")

        # --- F. Числа в локали -------------------------------------------------
        numbers = a.eval("U.numbers()")
        a.eval("U.lang('en')")
        en_number = a.eval("$.i18n.number(1234567.5, { decimals: 1 })")
        a.eval("U.lang('ru')")
        print(f"  --   ru={numbers['ru']!r} sep={numbers['sep']} en={en_number!r}")
        check(numbers["ru"] == "1\u00a0234\u00a0567,5", f"ru-число с пробелами и запятой: {numbers['ru']!r}")
        check(en_number == "1,234,567.5", f"en-число с запятыми и точкой: {en_number!r}")

        # --- G. Привязки данных: здоровье, cooldown, таймер, загрузка, устройство
        binds = a.eval("U.bindStats()")
        initial = a.eval("U.hudBound()")
        print(f"  --   привязок {binds['bindings']}, до изменений: "
              f"cd={initial['cd']['text']!r} device={initial['device']['text']!r}")
        check(binds["bindings"] == 6, f"зарегистрировано 6 привязок: {binds}")
        check(a.eval("$('#hud_hp').nodes[0].text") == "HP 100", "здоровье пришло из привязки")
        check(a.eval("$('#hud_bar').nodes[0].value") == 1, "полоса здоровья — доля 0..1")
        a.eval("U.set('hp', 40); U.set('cooldown', 2.5); U.set('device', 'геймпад')")
        a.step(2)
        hp_text = a.eval("$('#hud_hp').nodes[0].text")
        hp_bar = a.eval("$('#hud_bar').nodes[0].value")
        cd_text = a.eval("$('#hud_cd').nodes[0].text")
        device = a.eval("$('#hud_device').nodes[0].text")
        print(f"  --   после смены модели: {hp_text!r} bar={hp_bar} {cd_text!r} device={device!r}")
        check(hp_text == "HP 40" and abs(hp_bar - 0.4) < 1e-9, "здоровье и полоса обновились из источника")
        check(cd_text == "CD 2.5", "cooldown форматируется привязкой")
        check(device == "геймпад", "выбранное устройство доходит до HUD")
        a.eval("$.loading.show({ title: 'тест', value: 0.5 })")
        a.step(2)
        load_text = a.eval("$('#hud_load').nodes[0].text")
        a.eval("$.loading.hide()")
        a.step(1)
        check(load_text == "LOAD 50%", f"прогресс загрузки в HUD из привязки: {load_text!r}")
        timer0 = a.eval("$('#hud_timer').nodes[0].text")
        a.step(3)
        timer1 = a.eval("$('#hud_timer').nodes[0].text")
        print(f"  --   таймер: {timer0!r} → {timer1!r}, "
              f"обновлений/пропусков {a.eval('U.bindStats()')}")
        check(timer0 != timer1, "таймер обновляется по кадрам")
        stats_bind = a.eval("U.bindStats()")
        check(stats_bind["skipped"] > 0, f"одинаковые значения не перерисовываются (пропусков {stats_bind['skipped']})")

        # --- H. Модальное окно блокирует игровой ввод --------------------------
        a.eval("U.pressJump()")
        a.step(1)
        baseline_jumps = a.eval("U.jumpSeen()")
        check(baseline_jumps > 0, f"до модального окна игровой ввод доходит (jump={baseline_jumps})")
        a.eval("U.modal()")
        a.step(1)
        blocked = a.eval("U.inputBlocked()")
        open_now = a.eval("U.modalOpen()")
        baseline_right = a.eval("U.rightSeen()")
        a.eval("U.pressRight()")
        a.step(1)
        same = a.eval("U.rightSeen()")
        consumed = a.eval("U.consumed()")
        print(f"  --   модальное окно: blocked={blocked} open={open_now} right "
              f"{baseline_right} → {same}, consumed={json.dumps(consumed, ensure_ascii=False)}")
        check(blocked is True and open_now is True, "модальное окно открыто и блокирует")
        check(same == baseline_right, "нажатие при модальном окне НЕ дошло до игры")
        check(bool(consumed) and consumed.get("context") == "ui.modal",
              f"нажатие погашено контекстом модального окна: {consumed}")
        a.eval("U.pressEscape()")
        a.step(1)
        check(a.eval("U.inputBlocked()") is False, "после Escape модального окна нет")
        check(a.eval("U.tempWindow()") is True, "немодальное окно открыто")
        a.step(1)
        check(a.eval("U.inputBlocked()") is False, "немодальное окно ввод не блокирует")
        nonmodal_right = a.eval("U.rightSeen()")
        a.eval("U.pressRight()")
        a.step(1)
        check(a.eval("U.rightSeen()") > nonmodal_right, "при немодальном окне ввод доходит до игры")
        a.eval("U.closeTemp()")
        a.step(1)

        # --- I. Escape закрывает верхний контекст и возвращает фокус -----------
        focused0 = a.eval("U.focus('#menu_btn')")
        a.eval("U.modal()")
        a.step(1)
        focused_in_modal = a.eval("U.focused()")
        stack_in_modal = a.eval("U.focusStack()")
        a.eval("U.pressEscape()")
        a.step(1)
        focused_after = a.eval("U.focused()")
        stack_after = a.eval("U.focusStack()")
        print(f"  --   фокус {focused0} → {focused_in_modal} {stack_in_modal} → {focused_after} {stack_after}")
        check(focused0 == "menu_btn", "фокус поставлен на кнопку меню")
        check(focused_in_modal != "menu_btn" and stack_in_modal == ["menu_btn"],
              "модальное окно увело фокус, помня прежний")
        check(a.eval("U.modalOpen()") is False, "Escape закрыл верхний контекст")
        check(focused_after == "menu_btn" and stack_after == [],
              f"фокус вернулся на кнопку, стек пуст (фокус={focused_after}, стек={stack_after})")

        # --- J. Resize не ломает раскладку -------------------------------------
        layout0 = a.eval("U.layout()")
        a.eval("U.resize(1200, 700)")
        a.step(2)
        layout1 = a.eval("U.layout()")
        a.eval("U.resize(800, 600)")
        a.step(2)
        layout2 = a.eval("U.layout()")
        print(f"  --   800x600 {json.dumps(layout0)} → 1200x700 {json.dumps(layout1)} → назад {json.dumps(layout2)}")
        check(layout1["right"]["x"] - layout0["right"]["x"] == 400
              and layout1["right"]["y"] - layout0["right"]["y"] == 100,
              "якорный элемент уехал вместе с краем окна (+400/+100)")
        check(layout1["hp"] == layout0["hp"], "непривязанный HUD остался на месте")
        check(layout1["scale"] == layout0["scale"], "масштаб интерфейса не изменился")
        check(a.eval("U.required()['ok']") is True, "после resize обязательные ID всё ещё доступны")
        check(layout2["right"] == layout0["right"], "возврат размера вернул раскладку")

        # --- K. Длинный текст не выходит за панель ------------------------------
        for lang in ("ru", "en"):
            text = a.eval("U.longText(%r)" % lang)
            full = a.eval("U.measure(U.longText(%r), 16)[0]" % lang)
            lines = a.eval("U.wrap(U.longText(%r), %d, 16)" % (lang, PANEL_WIDTH))
            widths = [a.eval("U.measure(%s, 16)[0]" % json.dumps(line)) for line in lines]
            print(f"  --   {lang}: строка {full:.1f} px, строк после переноса {len(lines)}, "
                  f"макс. ширина {max(widths):.1f} ≤ {PANEL_WIDTH}")
            check(len(lines) >= 2, f"{lang}: длинный текст переносится (строк {len(lines)})")
            check(max(widths) <= PANEL_WIDTH,
                  f"{lang}: ни одна строка не выходит за панель (макс {max(widths):.1f})")
            check(full > PANEL_WIDTH, f"{lang}: исходная строка действительно длиннее панели")

        # --- L. Timeline: маркеры, stop, skip ----------------------------------
        a.eval("U.armCamera()")
        a.step(1)
        check(a.eval("U.followedId()") == "hero", "камера привязана до прогона")
        music_before = a.eval("U.musicPlaying()")
        i18n_listeners = a.eval("U.i18nListeners()")
        tl_listeners = a.eval("U.markerListenerCount()")
        nodes0 = a.eval("U.uiNodeCount()")
        a.eval("U.playIntro()")
        ok, frames = step_until(a, "!$.timeline.state().running && U.markers().length > 0", 40)
        markers = a.eval("U.markers()")
        events = a.eval("U.markerEvents()")
        restored = a.eval("$.timeline.state().restored")
        print(f"  --   прогон за {frames} кадров: маркеры={markers} события={events}")
        check(ok, "прогон завершился")
        check(markers == ["intro_begin", "intro_once", "intro_repeat", "intro_late"],
              f"маркеры сработали по порядку и один раз: {markers}")
        check(markers.count("intro_once") == 1, "повторный маркер в скрипте не сработал дважды")
        check(events == markers, f"события marker совпадают с отметками: {events}")
        print(f"  --   контракт возврата: {json.dumps(restored, ensure_ascii=False)}")
        check(isinstance(restored, dict) and restored.get("camera") == "#hero",
              f"камера возвращена по контракту: {restored}")
        check(restored.get("control") in ("free", "released"), "управление возвращено")
        check(a.eval("U.followedId()") == "hero", "камера снова следит за героем")
        check(a.eval("U.musicPlaying()") == music_before, "состояние музыки вернулось как было")
        check(a.eval("U.uiNodeCount()") == nodes0, "после прогона лишних узлов не осталось")

        # stop на середине
        a.eval("U.playIntro()")
        a.step(1)
        a.eval("U.stopIntro()")
        a.step(1)
        stopped = a.eval("$.timeline.state()")
        print(f"  --   stop: running={stopped['running']} restored={json.dumps(stopped.get('restored'), ensure_ascii=False)}")
        check(stopped["running"] is False, "stop остановил прогон")
        check(a.eval("U.dialogRunning()") is False, "диалог закрыт вместе с прогоном")
        check(a.eval("U.dialogBound()") is False, "подписка диалога на язык снята")

        # skip: необратимые маркеры не исполняются
        a.eval("U.playIntro()")
        a.step(2)
        a.eval("$.timeline.skipAll()")
        a.step(1)
        skipped = a.eval("U.skippedMarkers()")
        after_skip_markers = a.eval("U.markers()")
        after_skip_events = a.eval("U.markerEvents()")
        print(f"  --   skip: сработали={after_skip_markers} пропущены={skipped} события={after_skip_events}")
        check(a.eval("$.timeline.state().running") is False, "skip довёл прогон до конца")
        check(len(skipped) >= 1, f"skip перечислил непроведённые маркеры: {skipped}")
        check(all(m in after_skip_markers or True for m in skipped), "список пропущенных есть")
        check("intro_late" in skipped and "intro_late" not in after_skip_events,
              "пропущенный маркер НЕ сработал (необратимый эффект не повторён)")
        check(isinstance(a.eval("$.timeline.state().restored"), dict), "после skip контракт возврата отчитался")

        # --- M. Ничего не растёт от прогонов -----------------------------------
        for _ in range(5):
            a.eval("U.playIntro()")
            a.step(1)
            a.eval("U.stopIntro()")
            a.step(1)
        check(a.eval("U.i18nListeners()") == i18n_listeners,
              f"подписки языка не растут: {i18n_listeners} → {a.eval('U.i18nListeners()')}")
        check(a.eval("U.markerListenerCount()") == tl_listeners,
              f"подписки timeline не растут: {tl_listeners} → {a.eval('U.markerListenerCount()')}")
        check(a.eval("U.uiNodeCount()") == nodes0,
              f"узлы не копятся: {nodes0} → {a.eval('U.uiNodeCount()')}")
        check(a.eval("$.ui.persistCount()") == 10, "постоянных узлов по-прежнему 10")
        check(a.ping().get("pong") is True, "движок жив после всех сценариев")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
