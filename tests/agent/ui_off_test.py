#!/usr/bin/env python3
# ===========================================================================
# UI: снятие подписок и учёт слотов слушателей (task-56, продолжение).
#
# До правки:
#   * engine.ui.off и doc.off не существовали (typeof undefined);
#   * слоты пула 256 не возвращались: после 256 подписок за рантайм — отказ;
#   * второй РАЗНЫЙ обработчик на ту же пару элемент+событие молча
#     выбрасывался (dedup по паре, а не по паре+обработчик);
#   * doc.on возвращал обёртку, а не id слота.
#
# Проверяется на живом движке (клики — engine.ui.click/doc.click, как мышь):
#   * engine.ui.on/doc.on возвращают id; второй обработчик той же пары живёт;
#   * повторная подписка тем же обработчиком не дублируется (одно сообщение);
#   * off по обработчику и off по паре возвращают число снятых;
#   * снятие убирает и слушателя RmlUi: освобождённый слот достаётся новому
#     обработчику, но клик по старому элементу его НЕ вызывает;
#   * 300 циклов подписка→снятие → 0 ошибок; до правки падало на 256-й;
#   * переполнение — громкая R2D_UI_LISTENER_LIMIT с числами;
#   * ui_callbacks/ui_callbacks_max в $.debug.limits() честные.
#
# Запуск: python3 tests/agent/ui_off_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "uioff")
DOC = "$.ui.doc('ui/off.rml')"
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def js(agent, code):
    try:
        return agent.eval(code)
    except Exception as error:            # noqa: BLE001 — текст нужен для отчёта
        return {"__error": str(error)}


def err(value):
    return value.get("__error", "") if isinstance(value, dict) else ""


def main():
    with Agent(game=GAME, seed=17) as a:
        a.step(4)
        doc = a.eval("%s.id" % DOC)
        check(isinstance(doc, int) and doc >= 0, "документ загружен (id=%s)" % doc)

        # --- 1. Имена и возвраты ---------------------------------------------
        check(a.eval("typeof %s.off" % DOC) == "function",
              "doc.off объявлен (до правки — undefined)")
        check(a.eval("typeof engine.ui.off") == "function",
              "engine.ui.off объявлен (до правки — undefined)")

        first = js(a, "globalThis.__nA=0; globalThis.__hA=()=>{__nA++;};"
                      "globalThis.__idA=%s.on('btn-a','click',__hA); __idA" % DOC)
        check(isinstance(first, int) and first >= 0,
              "doc.on возвращает id слота (%r)" % (first,))

        # --- 2. Второй РАЗНЫЙ обработчик той же пары работает ----------------
        second = js(a, "globalThis.__nB=0; globalThis.__hB=()=>{__nB++;};"
                       "globalThis.__idB=%s.on('btn-a','click',__hB); __idB" % DOC)
        check(isinstance(second, int) and second >= 0 and second != first,
              "второй разный обработчик получил свой id (%r)" % (second,))
        hits = js(a, "%s.click('btn-a'); [__nA, __nB]" % DOC)
        check(hits == [1, 1],
              "клик вызывает ОБА обработчика одной пары (до правки — только первый): %r"
              % (hits,))

        # --- 3. Повторная подписка тем же обработчиком не дублируется --------
        again = js(a, "globalThis.__idA2=%s.on('btn-a','click',__hA);"
                      "[__idA2, %s.listeners().length]" % (DOC, DOC))
        check(isinstance(again, list) and again[0] == first,
              "повторная подписка вернула тот же id (%r)" % (again,))
        check(isinstance(again, list) and again[1] == 2,
              "дубликата в реестре нет: на паре два РАЗНЫХ слушателя")
        hits = js(a, "%s.click('btn-a'); [__nA, __nB]" % DOC)
        check(hits == [2, 2], "повторный клик не вызвал обработчик дважды: %r" % (hits,))

        # --- 4. off по обработчику: число снятых и эффект ---------------------
        removed = js(a, "%s.off('btn-a','click',__hA)" % DOC)
        check(removed == 1, "doc.off(element,event,fn) вернул 1 (%r)" % (removed,))
        hits = js(a, "%s.click('btn-a'); [__nA, __nB]" % DOC)
        check(hits == [2, 3], "снятый обработчик больше не зовётся, соседний жив: %r"
              % (hits,))

        removed = js(a, "%s.off('btn-a','click')" % DOC)
        check(removed == 1, "doc.off(element,event) снял оставшийся обработчик (%r)"
              % (removed,))

        # --- 5. Клик не доходит до удалённой функции (RmlUi-слушатель снят) ---
        js(a, "globalThis.__nOld=0; globalThis.__hOld=()=>{__nOld++;};"
              "globalThis.__idOld=%s.on('btn-a','click',__hOld);"
              "%s.off('btn-a','click',__hOld)" % (DOC, DOC))
        swap = js(a, "globalThis.__nGhost=0; globalThis.__hGhost=()=>{__nGhost++;};"
                     "globalThis.__idGhost=%s.on('btn-b','click',__hGhost);"
                     "[__idOld, __idGhost]" % DOC)
        check(isinstance(swap, list) and swap[0] == swap[1],
              "освобождённый слот переиспользован (%r)" % (swap,))
        hits = js(a, "%s.click('btn-a'); [__nOld, __nGhost]" % DOC)
        check(hits == [0, 0],
              "старый слушатель RmlUi снят: клик по btn-a не зовёт новый обработчик "
              "из того же слота (%r)" % (hits,))
        hits = js(a, "%s.click('btn-b'); [__nGhost]" % DOC)
        check(hits == [1], "новый обработчик на btn-b работает (%r)" % (hits,))
        check(js(a, "%s.off('btn-b','click',__hGhost)" % DOC) == 1,
              "снятие нового обработчика вернуло 1")

        # --- 6. engine.ui.on/off напрямую ------------------------------------
        direct = js(a, "globalThis.__hitE=0; globalThis.__hE1=()=>{__hitE++;};"
                       "globalThis.__hE2=()=>{__hitE++;};"
                       "globalThis.__idE1=engine.ui.on(%d,'btn-a','click',__hE1);"
                       "globalThis.__idE2=engine.ui.on(%d,'btn-a','click',__hE2);"
                       "[__idE1, __idE2]" % (doc, doc))
        check(isinstance(direct, list) and all(isinstance(x, int) and x >= 0 for x in direct)
              and direct[0] != direct[1],
              "engine.ui.on возвращает разные id на разные обработчики (%r)" % (direct,))
        hits = js(a, "engine.ui.click(%d,'btn-a'); __hitE" % doc)
        check(hits == 2, "engine.ui.click зовёт оба обработчика (%r)" % (hits,))
        removed = js(a, "engine.ui.off(%d,'btn-a','click')" % doc)
        check(removed == 2, "engine.ui.off(doc,el,event) вернул 2 (%r)" % (removed,))
        hits = js(a, "engine.ui.click(%d,'btn-a'); __hitE" % doc)
        check(hits == 2, "после engine.ui.off клик не зовёт снятых (%r)" % (hits,))
        check(js(a, "engine.ui.off(%d,'btn-a','click')" % doc) == 0,
              "повторный off по пустой паре честно возвращает 0")
        check(js(a, "engine.ui.off(%d,'нет-такого','click')" % doc) == 0,
              "off по несуществующему элементу — 0, без исключения")

        # --- 7. 300 циклов подписка → снятие: слоты возвращаются ---------------
        baseline = js(a, "$.debug.limits().ui_callbacks")
        cycles = js(a, "(function(){let bad=0, offbad=0, thrown=null;"
                      "try{for(let i=0;i<300;i++){const fn=()=>{};"
                      "const id=%s.on('btn-a','click',fn); if(!(id>=0))bad++;"
                      "const n=%s.off('btn-a','click',fn); if(n!==1)offbad++;}"
                      "}catch(e){thrown=String(e&&e.message?e.message:e);}"
                      "return {bad, offbad, thrown};})()" % (DOC, DOC))
        check(isinstance(cycles, dict) and cycles.get("thrown") is None,
              "300 циклов подписка→снятие без исключений (до правки off нет) %r"
              % (cycles,))
        check(isinstance(cycles, dict) and cycles.get("bad") == 0
              and cycles.get("offbad") == 0,
              "в 300 циклах каждая подписка и каждое снятие успешны %r" % (cycles,))
        after_cycles = js(a, "$.debug.limits()")
        check(isinstance(after_cycles, dict)
              and after_cycles.get("ui_callbacks") == baseline,
              "пул вернулся к базовому числу после 300 снятий (%r → %r)"
              % (baseline, after_cycles.get("ui_callbacks")))

        # --- 8. 256 живых, 257-я — громкая структурная ошибка -----------------
        live = js(a, "(function(){globalThis.__live=[]; globalThis.__liveIds=[];"
                     "globalThis.__liveHits=0; let thrown=null;"
                     "try{for(let i=0;i<256;i++){const fn=()=>{__liveHits++;};"
                     "__live.push(fn); const id=%s.on('btn-a','click',fn);"
                     "if(!(id>=0))break; __liveIds.push(id);}}"
                     "catch(e){thrown=String(e&&e.message?e.message:e);}"
                     "return {ids: __liveIds.length, thrown};})()" % DOC)
        check(isinstance(live, dict) and live.get("ids") == 256,
              "256 одновременных подписок влезают (%r)" % (live,))
        limits = js(a, "$.debug.limits()")
        check(isinstance(limits, dict)
              and limits.get("ui_callbacks") == 256
              and limits.get("ui_callbacks_max") == 256,
              "limits: ui_callbacks=256, ui_callbacks_max=256 (%r)"
              % (limits.get("ui_callbacks") if isinstance(limits, dict) else limits,))
        overflow = js(a, "(function(){try{const fn=()=>{};"
                         "%s.on('btn-a','click',fn); return 'НЕТ ОШИБКИ';}"
                         "catch(e){return String(e&&e.message?e.message:e);}})()" % DOC)
        check(isinstance(overflow, str) and "R2D_UI_LISTENER_LIMIT" in overflow,
              "257-я подписка — R2D_UI_LISTENER_LIMIT, а не тихий выброс (%r)"
              % (overflow[:160],))
        check(isinstance(overflow, str) and "256" in overflow and "из" in overflow,
              "в ошибке переполнения есть числа (256 из 256)")
        dropped = js(a, "(function(){let n=0; for(const fn of __live){"
                        "n += %s.off('btn-a','click',fn);} __live=[]; return n;})()" % DOC)
        check(dropped == 256, "256 снятий вернули 256 (%r)" % (dropped,))
        limits = js(a, "$.debug.limits()")
        check(isinstance(limits, dict) and limits.get("ui_callbacks") == 0,
              "после снятия всех пул снова пуст (%r)"
              % (limits.get("ui_callbacks") if isinstance(limits, dict) else limits,))
        refill = js(a, "globalThis.__again=()=>{};"
                       "globalThis.__againId=%s.on('btn-a','click',__again);"
                       "[__againId, %s.listeners().length]" % (DOC, DOC))
        check(isinstance(refill, list) and isinstance(refill[0], int) and refill[0] >= 0,
              "после 256 снятий подписка снова влезает (%r)" % (refill,))
        js(a, "%s.off('btn-a','click',__again)" % DOC)

        # --- 9. Одно предупреждение на повторную подписку ---------------------
        js(a, "globalThis.__warnN=0; globalThis.__hW=()=>{__warnN++;};"
              "%s.on('btn-b','click',__hW); %s.on('btn-b','click',__hW);"
              "%s.off('btn-b','click',__hW)" % (DOC, DOC, DOC))
        a.step(2)
        log = a.stderr_text()
        count = sum(1 for line in log.splitlines()
                    if "btn-b" in line and "повторная подписка" in line)
        check(count == 1, "повторная подписка предупредила РОВНО один раз (найдено %d)"
              % count)

        # --- 10. unload: слот освобождается и БЕЗ doc.off ---------------------
        # Слушатель поставлен напрямую через engine.ui.on и не записан в
        # локальный реестр обёртки: слот обязан вернуться по OnDetach RmlUi,
        # иначе выгрузка документа тихо жгла бы пул.
        before = js(a, "$.debug.limits().ui_callbacks")
        direct_id = js(a, "engine.ui.on(%d,'btn-a','click',()=>{})" % doc)
        check(isinstance(direct_id, int) and direct_id >= 0,
              "прямой engine.ui.on повесил слушателя (id=%r)" % (direct_id,))
        check(js(a, "$.debug.limits().ui_callbacks") == before + 1,
              "слот занят (ui_callbacks=%r)" % (before + 1))
        js(a, "%s.unload()" % DOC)
        a.step(2)
        after = js(a, "$.debug.limits().ui_callbacks")
        check(before == after,
              "unload освободил слот через OnDetach: занято снова %r (%r → %r)"
              % (before, before, after))
        fresh = js(a, "[%s.id, $.ui.documents()]" % DOC)
        check(isinstance(fresh, list) and isinstance(fresh[0], int) and fresh[0] >= 0
              and "ui/off.rml" in fresh[1],
              "после unload $.ui.doc открывает документ заново (id=%r)" % (fresh,))

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
