# Russiano2D {{VERSION}} — {{PLATFORM_TITLE }}: инструкция для ИИ-агента

Ты получил готовый движок и игру. Тобой можно управлять программно: движок
читает JSON-команды со stdin и отвечает JSON-строками в stdout. Кадры идут
только по команде, поэтому прогон воспроизводим до кадра.

## Что в папке

| Файл | Что это |
|---|---|
| `{{BINARY}}` | движок; он же запускает игру и собирает её в один файл |
| `game/` | готовая игра: меню + уровень-платформер |
| `assets/` | текстуры, шрифты, иконки |
| `README.md` | та же инструкция для человека — как начать первый проект |

## Режим агента

```bash
{{RUN}} --agent --headless --fixed-dt 0.0166666667 --scene platformer
```

* `--agent` — кадры двигаются командой `step`, протокол на stdin/stdout;
* `--headless` — окно скрыто, но рендер и скриншоты работают;
* `--fixed-dt 0.0166666667` — детерминированный шаг (60 Гц);
* `--seed N` — зерно `$.random`;
* `--scene <имя>` — открыть сцену сразу, минуя меню;
* `--frames N` — выйти ровно после N кадров.

Первым приходит `{"event":"ready",...}`.

| Команда | Параметры | Ответ |
|---|---|---|
| `ping` | — | `{"ok":true,"pong":true,"frame":N,"time":T}` |
| `state` | — | кадр, время, окно, камера, мир, узлы, интерфейс, самотесты |
| `eval` | `code` — строка JS | `{"ok":true,"result":…}` либо `{"ok":false,"error":"…"}` |
| `step` | `frames`, `dt` | `{"ok":true,"frames":N,"frame":N2,"time":T}` |
| `screenshot` | `path` | `{"ok":true,"path":…,"width":W,"height":H}` |
| `key` | `key` (имя SDL), `action`: `"down"`,`"up"`,`"tap"` | `{"ok":true,"key":"Space","action":"tap"}` |
| `keys` | `hold` — массив имён, **заменяет** набор | `{"ok":true,"hold":["A","Space"]}` |
| `mouse` | `button` 1/2/3, `action`: `"down"`,`"up"`,`"click"` | `{"ok":true}` |
| `mouseMove` | `dx`,`dy` или `x`,`y` | `{"ok":true,"x":…,"y":…}` |
| `wheel` | `amount` | `{"ok":true}` |
| `text` | `text` | ввод текста как с клавиатуры |
| `reload` | — | перезапуск скриптов |
| `frames` | — | `{"ok":true,"frame":N,"time":T}` |
| `quit` | — | `{"ok":true}` и выход |

## Пример: пройти вправо и снять кадр

```bash
printf '%s\n' \
  '{"cmd":"state"}' \
  '{"cmd":"step","frames":40}' \
  '{"cmd":"eval","code":"$.scene.current()"}' \
  '{"cmd":"keys","hold":["D"]}' \
  '{"cmd":"step","frames":30}' \
  '{"cmd":"keys","hold":[]}' \
  '{"cmd":"screenshot","path":"shot.png"}' \
  '{"cmd":"quit"}' \
| {{RUN}} --agent --headless --scene platformer --fixed-dt 0.0166666667
```

Проверенный ответ (сокращённо):

```json
{"event":"ready","version":"{{VERSION}}","agent":true,"headless":true,"fixed_dt":0.01666666754}
{"ok":true,"state":{"frame":1,"time":0.02,"fps":60,"window":{"title":"…","w":1280,"h":720},"world":{"bodies":0},"entities":[]}}
{"ok":true,"frames":40,"frame":41,"time":0.68}
{"ok":true,"result":"platformer"}
{"ok":true,"hold":["D"]}
{"ok":true,"frames":30,"frame":71,"time":1.18}
{"ok":true,"hold":[]}
{"ok":true,"path":"shot.png","width":1280,"height":720}
{"ok":true}
```

## Пример на Python

```python
import json, subprocess

proc = subprocess.Popen(
    ["{{RUN}}", "--agent", "--headless", "--scene", "platformer",
     "--fixed-dt", "0.0166666667"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    text=True, bufsize=1)

def call(**cmd):
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            raise SystemExit("движок закрылся")
        event = json.loads(line)
        if "event" not in event:      # первый ответ — ready, его пропускаем
            return event

call(cmd="step", frames=60)
state = call(cmd="state")["state"]
print("сцена:", state.get("scene"), "| тел:", state["world"]["bodies"])
print("HUD:", call(cmd="eval", code="$('#hud-hp').text()").get("result"))
call(cmd="quit")
```

## Что можно спросить у игры через `eval`

Проверенные выражения:

| Выражение | Что вернёт |
|---|---|
| `$.scene.current()` | имя текущей сцены, например `"platformer"` |
| `$.nodes().length` | сколько узлов сейчас в мире |
| `$('#hud-hp').text()` | текст элемента интерфейса |
| `$.debug.counters()` | счётчики кадра: спрайты, draw calls, тела |
| `state.world.bodies` | число физических тел (из `state`, не из `eval`) |

`state` полностью описывает мир: кадр, время, FPS, окно, камера, гравитация и
границы мира, список узлов и элементов UI, результаты встроенных самотестов
игры (`state.tests`).

## Своя игра

Положи рядом каталог `mygame/` с `project.json` и `main.js` (см. `README.md`)
и запусти:

```bash
{{RUN}} --game mygame --agent --headless
```

Полный справочник протокола:
<https://hub.mos.ru/dem4ev48/russiano2d/-/blob/main/docs/AGENT_API.md>
