#!/usr/bin/env python3
# ===========================================================================
# A2 (отчёт BASHNYA 0.1.34). Импорт модулей: `..` нормализуется, выход за
# каталог игры не подменяется молча.
#
# Что проверяется на РЕАЛЬНОМ движке (сцена собирается в build/module_paths,
# чтобы рядом с игрой лежали общие модули — ровно случай из отчёта):
#
#   1) `import '../../shared/config.js'` из игры в соседнем каталоге работает:
#      грузится ИМЕННО тот файл, а не одноимённый внутри каталога игры
#      (внутри лежит ловушка-двойник `shared/config.js` — старая склейка
#      выбирала её и молчала);
#   2) обычный относительный импорт внутри каталога игры не сломан;
#   3) импорт за корень, где файла нет, — явная ошибка «импорт вне каталога
#      игры» с кодом R2D_MODULE_OUTSIDE_GAME, а не подстановка чужого пути;
#   4) абсолютный путь в спецификаторе отклоняется явно (R2D_MODULE_ABSOLUTE_PATH),
#      а не приклеивается к каталогу игры;
#   5) `..` внутри каталога игры работает и после правки;
#   0) ПЕРВЫМ делом — регрессия резолвера: движок поднимает собственный слой
#      `$` (встроенный модуль) и грузит игру на обычной фикстуре. Правило,
#      которое ломает загрузчик, обязано падать здесь, а не на всех тестах
#      сразу «$ is not defined».
#
# Запуск (после сборки движка):
#   python3 tests/agent/module_import_paths_test.py
# ===========================================================================

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

WORK = os.path.join(ROOT, "build", "module_paths")
GAME = os.path.join(WORK, "apps", "game")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def prepare():
    shutil.rmtree(WORK, ignore_errors=True)
    # Общий код рядом с игрой (в отчёте: tools/devgames/game/src/config.js).
    write(os.path.join(WORK, "shared", "config.js"),
          "export const SOURCE = 'shared/config.js';\nglobalThis.SHARED_VALUE = 'SHARED';\n")
    # Двойник ВНУТРИ каталога игры: старая склейка «каталог игры + спецификатор»
    # выбирала именно его — и это было молчаливой подменой пути.
    write(os.path.join(GAME, "shared", "config.js"),
          "export const SOURCE = 'decoy';\nglobalThis.SHARED_VALUE = 'DECOY';\n")
    # `..` внутри каталога игры.
    write(os.path.join(GAME, "lib", "util.js"), "export const UTIL = 'util';\n")
    write(os.path.join(GAME, "lib", "deep", "leaf.js"), "import { UTIL } from '../util.js';\nexport const LEAF = UTIL + '/leaf';\n")
    write(os.path.join(GAME, "project.json"),
          '{"title":"module paths","version":"0.0.1","width":320,"height":180}')
    write(os.path.join(GAME, "main.js"), """// Фикстура A2: импорт вверх по дереву + наблюдение ошибок импорта.
import { SOURCE } from '../../shared/config.js';
import { LEAF } from './lib/deep/leaf.js';

globalThis.CASES = { source: SOURCE, leaf: LEAF };

$.ready(async () => {
    const probes = [
        '../../shared/config.js',
        './lib/util.js',
        '../../../../nope/absent.js',
        '/etc/hosts',
    ];
    for (const spec of probes) {
        try {
            const mod = await import(spec);
            globalThis.CASES[spec] = 'ok:' + JSON.stringify(mod.SOURCE || mod.UTIL || 'module');
        } catch (e) {
            globalThis.CASES[spec] = 'ошибка: ' + e;
        }
    }
    globalThis.CASES.done = true;
});
""")


def main():
    # ------------------------------------------------------------------
    # 0. Движок поднимает слой $ из собственного загрузчика и грузит игру.
    #
    # Это защита РЕЗОЛВЕРА, а не проверка игры: слой $ — встроенный модуль
    # движка (r2d/bootstrap.js), и точка входа игры получает его импортом.
    # Любая правка правил импорта, которая отрежет загрузчик, валит здесь
    # ПЕРВОЙ — с причиной в журнале движка, а не «$ is not defined» на всех
    # фикстурах сразу (так уже было 13:03–13:05 при правке A2).
    # ------------------------------------------------------------------
    with Agent(game=os.path.join(ROOT, "tests", "fixtures", "hello"), seed=3) as a:
        a.step(3)
        dollar = a.eval("typeof $")
        if dollar not in ("object", "function"):
            print("  --   журнал движка (последние строки):")
            for line in a.stderr_text().splitlines()[-6:]:
                print("       | " + line)
        check(dollar in ("object", "function"),
              "движок поднял встроенный слой $ (typeof $ = %s)" % dollar)
        if dollar in ("object", "function"):
            check(a.eval("typeof $.fs") == "object" and a.eval("typeof $.agent") == "object",
                  "слой $ собран целиком (fs/agent доступны)")
            check(a.eval("$('#hero').length") == 1,
                  "игра tests/fixtures/hello загрузилась и собрала мир")
            check(a.eval("typeof $.atlas") == "object" and a.eval("typeof $.reload") == "object",
                  "подсистемы $, живущие в отдельных модулях, тоже на месте")
        else:
            check(False, "слой $ не поднялся — зависимые проверки резолвера пропущены (журнал выше)")

    prepare()
    with Agent(game=GAME, seed=7) as a:
        a.step(5)
        cases = a.eval("JSON.stringify(globalThis.CASES)")
        cases = json.loads(cases) if cases else {}
        print("  --   импорты: %s" % json.dumps(cases, ensure_ascii=False)[:300])

        # 1) Импорт вверх по дереву: файл именно тот, а не двойник в игре.
        check(cases.get("source") == "shared/config.js",
              "static import '../../shared/config.js' загрузил ОБЩИЙ файл: %s" % cases.get("source"))
        check(a.eval("globalThis.SHARED_VALUE") == "SHARED",
              "значение взято из общего модуля, а не из двойника в каталоге игры: %s"
              % a.eval("globalThis.SHARED_VALUE"))

        # 2) Обычный относительный импорт и `..` внутри игры не сломаны.
        check(cases.get("leaf") == "util/leaf",
              "import внутри игры и `..` в нём работают: %s" % cases.get("leaf"))
        check(str(cases.get("./lib/util.js", "")).startswith("ok:"),
              "динамический импорт соседнего модуля игры работает: %s" % cases.get("./lib/util.js"))
        check(str(cases.get("../../shared/config.js", "")) == 'ok:"shared/config.js"',
              "динамический импорт общего модуля работает: %s" % cases.get("../../shared/config.js"))

        # 3) Выход за корень без файла — явная ошибка с кодом.
        beyond = str(cases.get("../../../../nope/absent.js", ""))
        print("  --   за корнем: %s" % beyond[:200])
        check("модуль вне каталога игры не найден" in beyond,
              "ненайденный модуль за каталогом игры назван явно: %s" % beyond[:160])
        check("R2D_MODULE_OUTSIDE_GAME" in beyond,
              "ошибка выхода за корень несёт код R2D_MODULE_OUTSIDE_GAME")

        # 4) Абсолютный путь отклоняется, а не приклеивается к игре.
        absolute = str(cases.get("/etc/hosts", ""))
        print("  --   абсолютный: %s" % absolute[:200])
        check("абсолютный путь" in absolute and "R2D_MODULE_ABSOLUTE_PATH" in absolute,
              "абсолютный спецификатор отклонён с кодом R2D_MODULE_ABSOLUTE_PATH: %s" % absolute[:160])

        check(cases.get("done") is True, "все пробы импорта дошли до конца (игра жива)")

        # 5) Ошибка за корнем видна и в журнале движка (не только в JS).
        stderr = a.stderr_text()
        check("R2D_MODULE_OUTSIDE_GAME" in stderr,
              "код выхода за корень виден в журнале движка")

    # Отдельный прогон: статический импорт за корень роняет загрузку точки
    # входа — причина обязана быть названа в журнале, а окно не падать.
    broken = os.path.join(WORK, "apps", "broken")
    shutil.copytree(GAME, broken, dirs_exist_ok=True)
    write(os.path.join(broken, "main.js"),
          "import '../../../../nowhere/x.js';\nglobalThis.SHOULD_NOT_LOAD = true;\n")
    with Agent(game=broken, seed=7) as a:
        a.step(3)
        text = a.stderr_text()
        check("модуль вне каталога игры не найден" in text and "R2D_MODULE_OUTSIDE_GAME" in text,
              "статический импорт за корень: причина в журнале движка")
        check(a.eval("globalThis.SHOULD_NOT_LOAD") is None, "код после упавшего импорта не выполнился")
        check(a.ping().get("pong") is True, "движок отвечает, окно не упало")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
