#!/usr/bin/env python3
# ===========================================================================
# Пример §31-7 Спецификации: «Recovery» (demos/recovery).
#
# Проверяются факты, а не наличие методов:
#   * битый основной файл слота -> `$.save.load()` берёт `.bak` (счётчик
#     `stats().recovered`), значение восстанавливается, посторонний слот
#     `profile` остаётся побайтово тем же;
#   * `$.save.recover()` лечит основной файл: он побайтово равен копии;
#   * отказ записи (путь внутри файла) не разрушает последний корректный слот,
#     попадает в `$.debug.errors()` и виден на экране восстановления;
#   * слот «из будущего» отклоняется без изменения файла;
#   * битый JSON ассета -> `ok:false` с кодом `R2D_RELOAD_PARSE`, игра живёт на
#     last-known-good и продолжает считать кадры; после починки reload
#     применяется (версия растёт, значение меняется) без перезапуска;
#   * запись прогона + проигрывание с внесённым сдвигом: `divergence()` называет
#     первый tick (10 при checkpoint каждые 10) и поле `<nid>.x`; чистый прогон
#     даёт `divergence() === null`.
#
# Запуск:
#   python3 tests/agent/recovery_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/recovery_test.py
# ===========================================================================

import hashlib
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT  # noqa: E402

GAME = os.path.join("demos", "recovery")
ASSET = os.path.join(ROOT, "demos", "recovery", "assets", "panel.json")
SAVE_OUT = os.path.join(ROOT, "build", "recovery-saves")
DOC = "$.ui.doc('rml/recovery.rml')"
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def abs_path(a, name):
    """Абсолютный путь слота по относительному `$.save.path(name)`."""
    return os.path.join(ROOT, a.eval("$.save.path(%r)" % name))


def logic_errors(a):
    lines = (a.stderr_text() or "").splitlines()
    return [line.strip() for line in lines
            if "$: ошибка" in line or "[error]" in line]


def main():
    if not os.path.isdir(GAME):
        print("  FAIL нет примера: %s" % GAME)
        return 1
    original_asset = open(ASSET, "rb").read()
    shutil.rmtree(SAVE_OUT, ignore_errors=True)
    try:
        with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
            a.step(5)

            # --- 0. Пример запустился, ассет прочитан ------------------------
            check(a.eval("$.scene.current()") == "recovery", "сцена recovery открылась")
            check(a.eval("$('#hero').length") == 1, "узел игрока создан")
            snap = a.eval("$.recoveryApp.snapshot()")
            check(snap.get("assetVersion") == 1, "ассет загружен через $.reload (версия 1)")
            check((snap.get("assetValue") or {}).get("title") == "panel v1",
                  "значение ассета — last-known-good panel v1")
            check(snap.get("slotPath") == "build/recovery-saves/slot-run.json",
                  "слоты пишутся в writable-каталог (%s)" % snap.get("slotPath"))

            # --- 1. Сохранение, копия .bak -----------------------------------
            a.eval("$.store.set('score', 1); $.recoveryApp.saveGood()")
            first_run = abs_path(a, "run")
            profile = abs_path(a, "profile")
            check(os.path.isfile(first_run) and os.path.isfile(profile),
                  "оба слота записаны на диск")
            a.eval("$.store.set('score', 2); $.recoveryApp.saveGood()")
            backup = first_run + ".bak"
            check(os.path.isfile(backup), "перед перезаписью создана копия .bak")
            check(a.eval("$.save.verify('run').ok") is True, "verify: основной файл корректен")
            check(a.eval("$.save.verify('run').backup") is False,
                  "verify: здоровая запись читается без копии")
            check(a.eval("$.store.get('score')") == 2, "в основном слоте значение v2")
            profile_sha = sha256(profile)
            backup_sha = sha256(backup)

            # --- 2. Битый слот -> восстановление из .bak ---------------------
            with open(first_run, "wb") as handle:
                handle.write(b"{broken json")
            check(a.eval("$.save.verify('run').ok") is False, "битый слот виден проверкой")
            check(a.eval("$.save.verify('run').backup") is True, "у битого слота есть копия")
            check(a.eval("$.recoveryApp.retry()") is True, "load() взял .bak и применил слот")
            recovered = a.eval("$.save.stats().recovered")
            check(recovered >= 1, "stats().recovered вырос: %r" % recovered)
            check(a.eval("$.store.get('score')") == 1,
                  "из копии поднялось значение v1 (%r)" % a.eval("$.store.get('score')"))
            check(sha256(profile) == profile_sha,
                  "посторонний слот profile не изменился (побайтово)")

            # --- 3. recover лечит основной файл -------------------------------
            check(a.eval("$.recoveryApp.restoreBackup()") is True, "recover() вылечил слот")
            check(sha256(first_run) == backup_sha,
                  "основной файл побайтово равен .bak")
            check(a.eval("$.save.verify('run').ok") is True,
                  "после recover verify() снова ok")

            # --- 4. Отказ записи: машина, пользователь, целостность -----------
            frame_before = a.eval("$.time.frame()")
            bad = a.eval("$.recoveryApp.attemptBadSave()")
            check(bad.get("ok") is False, "запись в недоступный каталог вернула false")
            # Код называет СТАДИЮ отказа: запись упала на временном файле,
            # значит `R2D_SAVE_TEMP` (§14/§17 — структура вместо просто строки).
            check(bad.get("code") == "R2D_SAVE_TEMP" and bad.get("stage") == "temp",
                  "отказ назвал код %r и стадию %r" % (bad.get("code"), bad.get("stage")))
            check(bool(bad.get("error")), "текст отказа не пуст")
            check(bad.get("machine") is True, "отказ ушёл в $.debug структурно")
            codes = a.eval("$.recoveryApp.snapshot().debugCodes")
            check("R2D_SAVE_TEMP" in codes, "$.debug.errors() содержит код: %r" % codes)
            check(a.eval("$.store.get('score')") == 1, "рабочее состояние не разрушено")
            check(sha256(profile) == profile_sha, "profile цел после отказа записи")
            a.step(5)
            frame_after = a.eval("$.time.frame()")
            check(frame_after > frame_before, "игра жива после отказа: кадры идут (%d -> %d)"
                  % (frame_before, frame_after))
            status = a.eval(DOC + ".content('rec-status')") or ""
            detail = a.eval(DOC + ".content('rec-detail')") or ""
            check("не удалась" in status, "экран показал отказ пользователю: %r" % status)
            check("R2D_SAVE_TEMP" in detail, "экран показал код: %r" % detail)

            # --- 5. Слот из будущего: отказ без правки файла --------------------
            future = a.eval("$.recoveryApp.attemptFutureSlotSave()")
            check(future.get("ok") is False, "слот версии 999 не перезаписан")
            check(future.get("code") == "R2D_SAVE_FUTURE",
                  "код отказа: %r" % future.get("code"))
            check(future.get("untouched") is True, "файл слота не изменился")
            check(future.get("rejectedFuture") >= 1, "stats().rejected_future вырос")
            codes = a.eval("$.recoveryApp.snapshot().debugCodes")
            check("R2D_SAVE_FUTURE" in codes, "отказ тоже виден машине: %r" % codes)
            check(a.eval("$.save.load('run')") is True, "корректный слот всё ещё грузится")

            # --- 6. Битый ассет -> last-known-good, игра жива -------------------
            version_before = a.eval("$.reload.version('panel')")
            with open(ASSET, "wb") as handle:
                handle.write(b"{ nope")
            broken = a.eval("$.recoveryApp.reloadAsset()")
            check(broken.get("ok") is False, "битый ассет отклонён")
            check(broken.get("code") == "R2D_RELOAD_PARSE",
                  "код отклонения: %r" % broken.get("code"))
            check(a.eval("$.reload.version('panel')") == version_before,
                  "версия ассета не выросла на ошибке")
            check((a.eval("$.recoveryApp.snapshot().assetValue") or {}).get("title") == "panel v1",
                  "игра работает на last-known-good (panel v1)")
            frame_before = a.eval("$.time.frame()")
            a.step(5)
            check(a.eval("$.time.frame()") > frame_before, "кадры идут после битого ассета")
            check(a.eval("$('#hero').length") == 1, "мир на месте после битого ассета")

            # --- 7. Починка ассета -> reload применяется без перезапуска --------
            with open(ASSET, "w", encoding="utf-8") as handle:
                handle.write('{"version":1,"title":"panel v2","accent":"#3fb950"}\n')
            fixed = a.eval("$.recoveryApp.reloadAsset()")
            check(fixed.get("ok") is True, "починенный ассет применён")
            check(fixed.get("changed") is True, "reload сообщил changed=true")
            check(a.eval("$.reload.version('panel')") == version_before + 1,
                  "версия ассета выросла: %r -> %r"
                  % (version_before, a.eval("$.reload.version('panel')")))
            check((a.eval("$.recoveryApp.snapshot().assetValue") or {}).get("title") == "panel v2",
                  "игра видит новое значение без перезапуска")

            # --- 8. Прогон: запись, чистый replay, divergence --------------------
            check(a.eval("$.recoveryApp.recordRun(24)") is True, "запись прогона начата")
            a.step(30)
            frames = a.eval("$.replay.length()")
            check(frames == 24, "записано 24 кадра (%r)" % frames)
            header = a.eval("$.replay.header()")
            checks = (header.get("checkpoints") or {}).get("count", 0)
            check(checks >= 2, "checkpoint'ов в заголовке: %r" % checks)
            check((header.get("input") or {}).get("actions") == ["left", "right", "jump"],
                  "разрешённые actions в заголовке")
            check(a.eval("$.recoveryApp.playRun({})") is True, "чистое проигрывание начато")
            a.step(30)
            check(a.eval("$.recoveryApp.divergence()") is None,
                  "чистый прогон: divergence() === null")

            check(a.eval("$.recoveryApp.playRun({mismatchAfter: 7})") is True,
                  "проигрывание со сдвигом начато")
            a.step(30)
            div = a.eval("$.recoveryApp.divergence()")
            check(div is not None, "расхождение найдено")
            if div:
                check(div.get("tick") == 10,
                      "первый расходящийся tick назван: %r (ожидался 10)" % div.get("tick"))
                fields = [f.get("field") for f in div.get("fields", [])]
                check(any(str(f).endswith(".x") for f in fields),
                      "в отчёте поле позиции: %r" % fields[:3])
                check(len(div.get("ids", [])) >= 1, "в отчёте ID узла: %r" % div.get("ids"))
                check((div.get("versions") or {}).get("replay") == 2,
                      "версия записи в отчёте: %r" % (div.get("versions") or {}).get("replay"))
                check((div.get("versions") or {}).get("engine", {}).get("build") == "demos/recovery",
                      "ID сборки в отчёте: %r" % (div.get("versions") or {}).get("engine"))
                print("  --   divergence: tick=%s fields=%s ids=%s"
                      % (div.get("tick"), fields[:3], div.get("ids")))

            # --- 9. Экран восстановления ----------------------------------------
            actions = a.eval(DOC + ".content('rec-actions')") or ""
            for button in ("btn-retry", "btn-restore", "btn-reset",
                           "btn-bad-save", "btn-reload"):
                check(button in actions, "экран восстановления содержит %s" % button)
            check("слот:" in (a.eval(DOC + ".content('rec-slot')") or ""),
                  "экран показывает путь слота и версию ассета")

            # --- 10. Посторонний слот цел на протяжении всего сценария -----------
            check(sha256(profile) == profile_sha,
                  "profile не изменился за весь сценарий (побайтово)")

            # --- 11. Непредвиденных ошибок логики нет ----------------------------
            # Ошибки самих сценариев (отказ записи, слот из будущего, битый JSON)
            # ожидаемы; любой другой текст ошибки — провал.
            expected_markers = ("не удалось записать", "записан версией", "не разобрался")
            unexpected = [line for line in logic_errors(a)
                          if not any(marker in line for marker in expected_markers)]
            check(not unexpected, "непредвиденных ошибок логики нет: %r" % unexpected[:2])
    finally:
        with open(ASSET, "wb") as handle:
            handle.write(original_asset)
        shutil.rmtree(SAVE_OUT, ignore_errors=True)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
