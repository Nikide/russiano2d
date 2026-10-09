# Агентские тесты russiano2d

Здесь лежат тесты, которые управляют движком через агентский протокол:
запускают его в режиме `--agent --headless`, шлют JSON-команды и проверяют
ответы. Протокол и список команд — `docs/AGENT_API.md`.

## Как устроен тест

* Имя файла — `<что_проверяем>_test.py` (только такие файлы видит раннер).
* Тест — обычный скрипт на Python 3, **только стандартная библиотека**.
* Клиент — `tools/agent_client.py` (класс `Agent`, контекстный менеджер).
* Каждая проверка печатает строку `  ok  <что проверяли>` либо
  `  FAIL <что проверяли>`. Это контракт с раннером: без строк `  ok  `
  тест считается **пропуском**, а не успехом.
* Код выхода: `0` — всё хорошо, `1` — была хоть одна проверка `FAIL`.
* Прогон идёт в детерминированном режиме (`--fixed-dt`, `--seed`), «ждать» —
  это `step(N)`, а не `sleep`.

Запуск: `python3 tools/run_tests.py <имя>_test` или весь набор
`python3 tools/run_tests.py` (лог каждого теста — `build/test_<имя>.log`).

## Скелет теста

```python
#!/usr/bin/env python3
"""Проверяет, что герой ходит вправо и прыгает."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent, ROOT

failures = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        failures.append(message)


with Agent(game="demos", scene="platformer", seed=7) as a:
    a.step(30)
    x0 = a.state()["player"]["x"]

    a.hold(["D"])
    a.step(60)
    a.release_all()
    check(a.state()["player"]["x"] > x0, "герой сдвинулся вправо")

    a.tap("Space")
    a.step(20)
    check(a.state()["player"]["y"] < 400, "герой прыгнул")

    shot = a.screenshot(os.path.join(ROOT, "build", "platformer_test.png"))
    check(os.path.getsize(shot) > 0, "скриншот сохранён: " + shot)

print("все проверки пройдены" if not failures else "ПРОВАЛЕНО: %d" % len(failures))
sys.exit(1 if failures else 0)
```

## Правила

1. Одна проверка — одна строка `  ok  ` / `  FAIL `; проверок должно быть
   больше нуля, иначе тест попадёт в `skip`.
2. Никаких `time.sleep()` — только `a.step(n)` / `a.run(n)`.
3. Тест должен работать без человека и без окна (`--headless`).
4. Если нужен внешний ассет, которого может не быть (шрифт, текстура, дисплей),
   осознанно пропустите тест: напечатайте `пропуск: <причина>`, **не** печатая
   строк `  ok  `, и выйдите с кодом `0`. Раннер покажет `skip` и предупредит,
   что пропуск — не «зелено». Притворяться успехом нельзя.
5. Имена клавиш — как в SDL (`docs/internal/NATIVE.md`, раздел 5): `"Space"`, `"D"`,
   `"Return"`, `"Left Shift"`.
6. Сообщения и имена проверок — на русском, идентификаторы — на английском.
