#!/usr/bin/env python3
"""Сборка игры в один исполняемый файл: `russiano2d build`.

Проверяет весь путь целиком: сборка → запуск без папки проекта → шифрование
(исходников в файле нет) → защита от подмены (изменённый байт ломает запуск) →
второй режим сборки (--relink).

Запуск:
    python3 tests/agent/build_test.py
"""

import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))

from agent_client import ROOT, Agent, AgentError  # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "hello")

failures = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        failures.append(message)


def run_build(args, timeout=180):
    """Запускает билдер и возвращает (код, stdout+stderr)."""
    process = subprocess.run(
        [BINARY, "build"] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout,
    )
    return process.returncode, process.stdout


def main():
    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1

    work = tempfile.mkdtemp(prefix="r2d_build_test_")
    standalone = os.path.join(work, "hello")
    try:
        # --- 1. Сборка -----------------------------------------------------
        # --encrypt просим явно: на macOS билдер по умолчанию НЕ шифрует груз
        # (собранный файл там всё равно переподписывают codesign, см. src/build.c
        # и tools/release.py). Тест проверяет саму гарантию «груз зашифрован»,
        # а не платформенное умолчание — иначе он валился на macOS и не проверял
        # ничего на остальных системах. Умолчание проверяем отдельно ниже.
        code, out = run_build(["--project", FIXTURE, "--out", standalone, "--encrypt"])
        check(code == 0, "билдер отработал без ошибок")
        check(os.path.exists(standalone), "собранный файл появился")
        if failures:
            print(out)
            return 1

        engine_size = os.path.getsize(BINARY)
        built_size = os.path.getsize(standalone)
        check(built_size > engine_size, "в собранный файл что-то дописано (%d байт)"
              % (built_size - engine_size))
        check(os.access(standalone, os.X_OK), "собранный файл исполняемый")
        check("ChaCha20" in out, "груз зашифрован по запросу --encrypt (ChaCha20-Poly1305)")

        # Умолчание шифрования: везде включено, кроме macOS — там файл
        # переподписывают, и шифрование сочли лишним шагом.
        plain = os.path.join(work, "hello_plain")
        code, out_plain = run_build(["--project", FIXTURE, "--out", plain])
        check(code == 0, "сборка с умолчаниями отработала")
        if sys.platform == "darwin":
            check("выключено" in out_plain,
                  "на macOS умолчание — без шифрования (см. release.py)")
        else:
            check("ChaCha20" in out_plain, "умолчание без флага шифрует груз")

        # --- 2. Запуск без папки проекта -----------------------------------
        # Файл лежит в отдельном каталоге: рядом нет ни скриптов, ни ассетов.
        with Agent(binary=standalone, game=None, seed=7) as game:
            game.step(5)
            # Фикстура не описывает сцену по имени — она строит мир в $.ready,
            # поэтому проверяем сам мир: он мог появиться только из груза.
            hero = game.eval("$('#hero').length")
            check(hero == 1, "мир собран из груза: игрок на месте (%r)" % hero)
            goblins = game.eval("$('.goblin').length")
            check(goblins == 3, "враги из груза на месте (%r)" % goblins)

            # Вторая сцена тоже лежит в грузе как отдельный модуль.
            # Переход отключаем: по умолчанию сцена меняется через затемнение,
            # и двух кадров для проверки не хватило бы.
            game.eval("$.scene.load('second', { transition: 'none' })")
            game.step(4)
            check(game.eval("$.scene.current()") == "second",
                  "второй модуль из груза загрузился")

            # Имя окна: берётся из project.json проекта и уезжает в груз.
            title = game.eval("$.window.title()")
            check(title == "Проверочная игра", "имя окна взято из манифеста проекта (%r)" % title)

            before = game.state()["frame"]
            game.step(20)
            check(game.state()["frame"] > before, "симуляция идёт: кадры считаются")
            check(game.eval("typeof $ === 'function'"), "высокоуровневое API живо")

        # --- 3. Шифрование: исходников в файле нет --------------------------
        with open(standalone, "rb") as f:
            blob = f.read()

        # Ищем строки, которые есть только в коде игры. Строку 'export default'
        # взять нельзя: она есть в самом движке (встроенное API $ лежит в
        # бинарнике как исходник).
        check(b"btnClick" not in blob, "идентификаторы игры не видны в собранном файле")
        check("Вторая сцена фикстуры".encode() not in blob,
              "комментарии из исходников не сохранились")
        check(b"$(\'<enemy>\', { class: \'goblin\' })" not in blob,
              "текста игровых модулей в файле нет")

        # --- 4. Подмена байта ломает запуск ---------------------------------
        tampered = os.path.join(work, "tampered")
        shutil.copyfile(standalone, tampered)
        data = bytearray(open(tampered, "rb").read())
        data[-200] ^= 0x01        # портим байт внутри груза
        open(tampered, "wb").write(bytes(data))
        os.chmod(tampered, 0o755)

        try:
            with Agent(binary=tampered, game=None, seed=7) as game:
                scene = game.eval("$.scene.current()")
                check(scene is None, "подменённый груз не загрузился (сцена: %r)" % scene)
        except AgentError:
            # Движок вправе вообще не подняться — это тоже отказ.
            check(True, "подменённый груз отвергнут на старте")

        # --- 5. Второй режим: --relink --------------------------------------
        relink_dir = os.path.join(work, "relink")
        code, out = run_build(["--project", FIXTURE, "--relink", relink_dir])
        generated = os.path.join(relink_dir, "r2d_payload_data.c")
        check(code == 0 and os.path.exists(generated), "режим --relink сгенерировал C-файл")
        if os.path.exists(generated):
            text = open(generated, encoding="utf-8", errors="ignore").read()
            check("r2d_embedded_payload" in text and "payload_footer" in text,
                  "в C-файле есть оба массива: груз и футер")
            check(text.count("};") >= 2, "оба массива закрыты — файл синтаксически целый")

        # --- 6. Понятные отказы ---------------------------------------------
        code, out = run_build(["--project", os.path.join(work, "нет-такого"), "--out",
                               os.path.join(work, "x")])
        check(code != 0, "несуществующий проект — ошибка, а не пустая сборка")

        code, out = run_build(["--project", FIXTURE])
        check(code != 0, "без --out и --relink билдер отказывается работать")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print()
    if failures:
        print("ПРОВАЛЕНО: %d" % len(failures))
        for f in failures:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
