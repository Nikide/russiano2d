#!/usr/bin/env python3
"""Клиент агентского протокола russiano2d.

Движок в режиме ``--agent`` обменивается с программой-агентом **одной
JSON-строкой на запрос и одной на ответ** через stdin/stdout; весь прочий вывод
(логи, ``engine.log``, предупреждения) уходит в stderr. Этот модуль — тонкая
обёртка над протоколом: запускает процесс, читает стартовое событие
``{"event":"ready"}``, шлёт команды и разбирает ответы. Внешних зависимостей
нет — только стандартная библиотека.

Запуск (см. ``docs/AGENT_API.md``, раздел 1)::

    ./build/russiano2d --agent --headless --fixed-dt 0.0166666667 \\
        --no-hot-reload --game demos --scene platformer --seed 7

Пример использования::

    import os, sys
    sys.path.insert(0, "tools")
    from agent_client import Agent, ROOT

    with Agent(game="demos", scene="platformer", seed=7) as a:
        a.step(30)
        x0 = a.state()["player"]["x"]       # снимок мира от игры

        a.hold(["D"])                       # «вправо» удерживается
        a.step(60)
        a.release_all()
        assert a.state()["player"]["x"] > x0

        a.tap("Space")                      # прыжок ровно на один кадр
        a.step(20)

        print(a.eval("$.world.count()"))
        a.screenshot(os.path.join(ROOT, "build", "shot.png"))

Бинарник ищется так: аргумент ``binary`` → переменная окружения ``R2D_BINARY``
(прежнее имя — ``NK2D_BINARY``) → ``build/russiano2d`` (прежнее имя файла —
``nikiniki2d``) в корне репозитория. Путь можно задать относительным —
он разрешается от текущего каталога, а затем от корня репозитория::

    R2D_BINARY=build-release/russiano2d python3 tools/run_tests.py
"""

from __future__ import annotations

import collections
import json
import os
import select
import subprocess
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence

__all__ = ["Agent", "AgentError", "ROOT", "DEFAULT_BINARY", "resolve_binary"]

#: Абсолютный путь к корню репозитория (каталог над tools/).
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Бинарник движка по умолчанию.
DEFAULT_BINARY = os.path.join(ROOT, "build", "russiano2d")

#: Прежнее имя бинарника: движок переименовывали, старое имя ещё поддержано.
LEGACY_BINARY = os.path.join(ROOT, "build", "nikiniki2d")

#: Переменные окружения с путём к бинарнику: текущее имя, затем прежнее.
BINARY_ENV = ("R2D_BINARY", "NK2D_BINARY")

#: Сколько последних строк stderr держать в памяти на случай разбора ошибки.
STDERR_LINES = 2000

#: Таймаут ожидания стартового события ``ready``, секунды.
DEFAULT_START_TIMEOUT = 20.0

#: Таймаут чтения одного ответа на команду, секунды.
DEFAULT_TIMEOUT = 30.0


class AgentError(Exception):
    """Ошибка запуска движка или агентского протокола.

    Бросается, когда бинарник не найден, процесс умер, ответ не пришёл вовремя,
    строка ответа не разобралась как JSON либо движок ответил ``{"ok":false}``.
    Сообщение — на русском; для разбора причин обычно полезен ``stderr_tail()``.
    """


def resolve_binary(binary: Optional[str] = None) -> str:
    """Найти бинарник движка и вернуть абсолютный путь.

    Порядок поиска: явный аргумент → ``R2D_BINARY`` → ``build/russiano2d``.
    Относительный путь проверяется от текущего каталога и от корня репозитория.

    Бросает :class:`AgentError`, если файла нет или он не исполняемый.
    """
    if binary:
        candidates: List[str] = [binary]
    else:
        env_binary = None
        for variable in BINARY_ENV:
            if os.environ.get(variable):
                env_binary = os.environ[variable]
                break
        if env_binary:
            candidates = [env_binary]
        else:
            candidates = [DEFAULT_BINARY]
            if os.path.isfile(LEGACY_BINARY):
                candidates.append(LEGACY_BINARY)

    tried: List[str] = []
    for candidate in candidates:
        if os.path.isabs(candidate):
            paths = [candidate]
        else:
            # Относительный путь — сначала от текущего каталога, затем от корня.
            paths = [os.path.abspath(candidate), os.path.join(ROOT, candidate)]
        for path in paths:
            if path in tried:
                continue
            tried.append(path)
            if os.path.isfile(path):
                if not os.access(path, os.X_OK):
                    raise AgentError(
                        "файл движка не исполняемый: %s\n"
                        "Проверьте права (chmod +x) или пересоберите проект." % path
                    )
                return path

    raise AgentError(
        "не найден бинарник движка. Искали:\n  %s\n"
        "Соберите проект (например: cmake --build build) "
        "или задайте путь через переменную R2D_BINARY." % "\n  ".join(tried)
    )


def _format_number(value: float) -> str:
    """Отформатировать число без хвостовых нулей: 1/60 → ``0.0166666667``."""
    text = ("%.10f" % float(value)).rstrip("0").rstrip(".")
    return text if text else "0"


class Agent:
    """Управление движком russiano2d через агентский протокол.

    Класс — контекстный менеджер: ``__exit__`` закрывает соединение, что
    завершает процесс движка (закрытие stdin равносильно команде ``quit``).

    Параметры конструктора:

    * ``game`` — каталог игры (``--game``), по умолчанию ``"game"``;
    * ``scene`` — сцена для немедленной загрузки (``--scene``), иначе меню;
    * ``seed`` — зерно генератора (``--seed``), задаёт воспроизводимость;
    * ``binary`` — путь к бинарнику (иначе ``R2D_BINARY`` / ``build/russiano2d``);
    * ``headless`` — скрытое окно (``--headless``); скриншоты работают;
    * ``fixed_dt`` — детерминированный шаг кадра (``--fixed-dt``), секунды;
    * ``stats`` — печатать статистику кадра раз в секунду в stderr (``--stats``);
    * ``keep_stderr`` — хранить stderr в кольцевом буфере (поток читается всегда,
      иначе процесс заблокируется на заполненной трубе);
    * ``env`` — дополнительные переменные окружения для процесса;
    * ``cwd`` — рабочий каталог процесса, по умолчанию корень репозитория;
    * ``start_timeout`` — сколько ждать событие ``ready``, секунды;
    * ``timeout`` — сколько ждать ответ на одну команду, секунды;
    * ``hot_reload`` — не добавлять ``--no-hot-reload`` (по умолчанию добавляется:
      тестам нужен предсказуемый запуск);
    * ``extra_args`` — дополнительные флаги командной строки (например,
      ``["--frames", "10"]``).

    Все ошибки клиента (в том числе ``{"ok":false}``, смерть процесса и
    неверные аргументы обёрток) поднимаются как :class:`AgentError`.
    """

    def __init__(
        self,
        game: str = "game",
        scene: Optional[str] = None,
        seed: Optional[int] = None,
        binary: Optional[str] = None,
        headless: bool = True,
        fixed_dt: float = 1.0 / 60.0,
        stats: bool = False,
        keep_stderr: bool = True,
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None,
        start_timeout: float = DEFAULT_START_TIMEOUT,
        timeout: float = DEFAULT_TIMEOUT,
        hot_reload: bool = False,
        extra_args: Optional[Sequence[str]] = None,
    ) -> None:
        self.binary = resolve_binary(binary)
        self.game = game
        self.scene = scene
        self.seed = seed
        self.headless = headless
        self.fixed_dt = fixed_dt
        self.stats = stats
        self.keep_stderr = keep_stderr
        self.cwd = cwd or ROOT
        self.start_timeout = float(start_timeout)
        self.timeout = float(timeout)
        self.hot_reload = bool(hot_reload)
        self.extra_args = list(extra_args or [])

        self.argv = self._build_argv()

        self._proc: Optional[subprocess.Popen] = None
        self._stderr_lines: "collections.deque[str]" = collections.deque(maxlen=STDERR_LINES)
        self._stderr_thread: Optional[threading.Thread] = None
        self._out_fd = -1
        self._out_buf = bytearray()
        self._next_id = 1
        self._closed = False
        self._quit_sent = False
        self.requests = 0          # сколько запросов отправлено
        self.ready: Dict[str, Any] = {}   # стартовое событие {"event":"ready",...}

        self._start(env)

    # --- запуск и остановка ---------------------------------------------------

    def _build_argv(self) -> List[str]:
        """Собрать командную строку движка в режиме агента."""
        argv = [self.binary, "--agent"]
        if self.headless:
            argv.append("--headless")
        if self.fixed_dt is not None:
            argv += ["--fixed-dt", _format_number(self.fixed_dt)]
        if self.seed is not None:
            argv += ["--seed", str(self.seed)]
        if self.game:
            argv += ["--game", str(self.game)]
        if self.scene:
            argv += ["--scene", str(self.scene)]
        if self.stats:
            argv.append("--stats")
        if not self.hot_reload:
            argv.append("--no-hot-reload")
        argv += [str(a) for a in self.extra_args]
        return argv

    def _start(self, env: Optional[Dict[str, str]]) -> None:
        """Запустить процесс и дождаться стартового события ``ready``."""

        proc_env = dict(os.environ)
        # Тесты не должны шуметь: подставляем беззвучный драйвер SDL, если
        # драйвер не задан явно. Микшер при этом работает по-настоящему —
        # проверки звука (каналы, громкость, воспроизведение) не ломаются,
        # просто звук не идёт в колонки. Чтобы прогнать тест СО звуком:
        #   R2D_TEST_AUDIO=real python3 tests/agent/<тест>.py
        if proc_env.get("R2D_TEST_AUDIO") != "real" and not proc_env.get("SDL_AUDIODRIVER"):
            proc_env["SDL_AUDIODRIVER"] = "dummy"
        if env:
            proc_env.update({str(k): str(v) for k, v in env.items()})

        try:
            self._proc = subprocess.Popen(
                self.argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=self.cwd,
                env=proc_env,
            )
        except OSError as exc:
            raise AgentError(
                "не удалось запустить движок: %s\n  команда: %s"
                % (exc, " ".join(self.argv))
            ) from exc

        # stdout читаем побайтово с собственной буферизацией: так таймаут
        # работает и на неполной строке (движок не обязан дослать "\n").
        assert self._proc.stdout is not None
        self._out_fd = self._proc.stdout.fileno()

        self._stderr_thread = threading.Thread(
            target=self._stderr_worker, name="agent-stderr", daemon=True
        )
        self._stderr_thread.start()

        try:
            line = self._read_line(self.start_timeout, "стартовое событие ready")
            try:
                event = json.loads(line)
            except ValueError as exc:
                raise AgentError(
                    "стартовая строка движка не разобралась как JSON: %r\n%s"
                    % (line, self.stderr_tail())
                ) from exc
            if not isinstance(event, dict) or event.get("event") != "ready":
                raise AgentError(
                    "движок не прислал событие ready, получено: %r\n%s"
                    % (line, self.stderr_tail())
                )
        except BaseException:
            # Старт не удался — не оставляем запущенный процесс висеть.
            # Вежливый quit здесь не нужен: движок ещё не сказал ready.
            self._closed = True
            self._stop_process()
            raise
        self.ready = event

    def _stderr_worker(self) -> None:
        """Читать stderr в кольцевой буфер, чтобы труба не переполнилась."""
        stream = self._proc.stderr if self._proc else None
        if stream is None:
            return
        try:
            for line in stream:
                if self.keep_stderr:
                    self._stderr_lines.append(line.rstrip("\n"))
        except (ValueError, OSError):
            # Поток закрыли при остановке процесса — это нормально.
            pass

    def _stop_process(self) -> None:
        """Добить процесс и закрыть трубы (без вежливой просьбы quit)."""
        proc = self._proc
        if proc is None:
            return
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    pass

        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                if stream is not None:
                    stream.close()
            except (OSError, ValueError):
                pass

        if self._stderr_thread is not None:
            self._stderr_thread.join(timeout=2.0)

    def close(self) -> None:
        """Завершить движок. Идемпотентно; вызывается на выходе из ``with``."""
        if self._closed:
            return
        self._closed = True
        proc = self._proc
        if proc is None:
            return

        if proc.poll() is None:
            try:
                self._send({"cmd": "quit"})
                self._quit_sent = True
            except (AgentError, OSError, ValueError):
                pass
            try:
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                pass

        self._stop_process()

    def quit(self, timeout: float = 2.0) -> None:
        """Послать ``quit`` и дождаться выхода процесса (не более ``timeout`` с)."""
        if self._quit_sent or self._proc is None:
            return
        self._quit_sent = True
        try:
            self._send({"cmd": "quit"})
        except (AgentError, OSError, ValueError):
            return
        try:
            self._proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            pass

    def __enter__(self) -> "Agent":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.close()
        return False

    def __repr__(self) -> str:
        state = "закрыт" if self._closed else "работает"
        return "<Agent %s, pid=%s, кадр=%s>" % (
            state,
            self._proc.pid if self._proc else "-",
            self.ready.get("frame", "?"),
        )

    # --- обмен по протоколу ---------------------------------------------------

    def _read_line(self, timeout: float, what: str) -> str:
        """Прочитать одну строку ответа, не дольше ``timeout`` секунд."""
        if self._proc is None:
            raise AgentError("движок не запущен")
        deadline = time.monotonic() + max(0.0, float(timeout))
        while True:
            newline = self._out_buf.find(b"\n")
            if newline >= 0:
                raw = bytes(self._out_buf[:newline])
                del self._out_buf[: newline + 1]
                line = raw.decode("utf-8", "replace").strip()
                if line:
                    return line
                continue

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AgentError(
                    "таймаут %.1f с: движок не ответил (%s)\n%s"
                    % (timeout, what, self.stderr_tail())
                )

            ready, _, _ = select.select([self._out_fd], [], [], remaining)
            if not ready:
                continue

            chunk = os.read(self._out_fd, 65536)
            if not chunk:
                code = self._proc.poll()
                # Даём потоку stderr дочитать последние строки перед отчётом.
                if self._stderr_thread is not None:
                    self._stderr_thread.join(timeout=1.0)
                raise AgentError(
                    "движок закрыл stdout, ожидание: %s (код выхода: %s)\n%s"
                    % (what, code, self.stderr_tail())
                )
            self._out_buf.extend(chunk)

    def _send(self, payload: Dict[str, Any]) -> None:
        """Записать одну JSON-строку в stdin движка."""
        if self._proc is None or self._proc.stdin is None:
            raise AgentError("движок не запущен")
        if self._proc.poll() is not None:
            raise AgentError(
                "движок уже завершился (код %s)\n%s"
                % (self._proc.returncode, self.stderr_tail())
            )
        text = json.dumps(payload, ensure_ascii=False)
        try:
            self._proc.stdin.write(text + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise AgentError(
                "не удалось отправить команду %r: движок закрыл stdin (%s)\n%s"
                % (payload.get("cmd"), exc, self.stderr_tail())
            ) from exc

    def cmd(self, name: str, **params: Any) -> Dict[str, Any]:
        """Выполнить команду протокола и вернуть разобранный ответ.

        ``cmd`` подставляется как ``"cmd": name``, к запросу добавляется
        автоматический ``id`` (в возвращаемом словаре его нет). Параметры со
        значением ``None`` не отправляются. При ``"ok": false`` поднимается
        :class:`AgentError` с текстом ошибки движка.

        >>> a.cmd("step", frames=10)
        {'ok': True, 'frames': 10, 'frame': 10}
        """
        payload: Dict[str, Any] = {"cmd": name}
        for key, value in params.items():
            if value is not None:
                payload[key] = value
        request_id = self._next_id
        self._next_id += 1
        payload["id"] = request_id

        self.requests += 1
        self._send(payload)
        line = self._read_line(self.timeout, "ответ на команду %r" % name)

        try:
            response = json.loads(line)
        except ValueError as exc:
            raise AgentError(
                "ответ на %r не разобрался как JSON: %r\n%s"
                % (name, line, self.stderr_tail())
            ) from exc
        if not isinstance(response, dict):
            raise AgentError(
                "ответ на %r — не JSON-объект: %r" % (name, line))

        response.pop("id", None)
        if response.get("ok") is not True:
            error = response.get("error") or "движок вернул ok != true: %r" % (line,)
            raise AgentError("команда %r: %s" % (name, error))
        return response

    # --- низкоуровневые обёртки ----------------------------------------------

    def ping(self) -> Dict[str, Any]:
        """Проверить связь: ``{"ok":true,"pong":true,"frame":N,"time":T}``."""
        return self.cmd("ping")

    def frames(self) -> int:
        """Текущий номер кадра (запрос ``frames``)."""
        return int(self.cmd("frames").get("frame", 0))

    def frame(self) -> int:
        """Синоним :meth:`frames`: номер текущего кадра."""
        return self.frames()

    def time(self) -> float:
        """Текущее игровое время в секундах (запрос ``frames``)."""
        return float(self.cmd("frames").get("time", 0.0))

    def step(self, frames: int = 1, dt: Optional[float] = None) -> Dict[str, Any]:
        """Прогнать ровно ``frames`` кадров (каждый рисуется полностью).

        ``dt`` необязателен: если не задан, используется ``--fixed-dt``.
        Удобный синоним — :meth:`run`.
        """
        return self.cmd("step", frames=int(frames), dt=dt)

    def state(self) -> Dict[str, Any]:
        """Вернуть поле ``state`` ответа — снимок мира от игрового кода."""
        return self.cmd("state").get("state", {})

    def eval(self, code: str) -> Any:
        """Выполнить JS-код в контексте игры и вернуть ``result``.

        Значение приводится движком к JSON (``undefined`` → ``null``).
        Пример: ``a.eval("$('#hero').pos()")``.
        """
        return self.cmd("eval", code=code).get("result")

    def key(self, name: str, action: str = "tap") -> Dict[str, Any]:
        """Нажать/отпустить клавишу: ``action`` — ``down``, ``up`` или ``tap``.

        Имя клавиши — как в SDL (``docs/API.md``, раздел 5): ``"Space"``,
        ``"D"``, ``"Return"``, ``"Left Shift"``. ``tap`` — нажатие на один кадр.
        """
        if action not in ("down", "up", "tap"):
            raise AgentError("key: неизвестное действие %r (ожидалось down/up/tap)" % action)
        return self.cmd("key", key=name, action=action)

    def keys(self, hold: Iterable[str]) -> Dict[str, Any]:
        """Заменить весь удерживаемый набор клавиш; ``[]`` — отпустить всё."""
        names = [str(name) for name in hold]
        return self.cmd("keys", hold=names)

    def mouse(self, button: int = 1, action: str = "click") -> Dict[str, Any]:
        """Кнопка мыши: ``button`` 1/2/3 — ЛКМ/СКМ/ПКМ, ``action`` — down/up/click."""
        if action not in ("down", "up", "click"):
            raise AgentError(
                "mouse: неизвестное действие %r (ожидалось down/up/click)" % action)
        return self.cmd("mouse", button=int(button), action=action)

    def mouse_move(
        self,
        dx: Optional[float] = None,
        dy: Optional[float] = None,
        x: Optional[float] = None,
        y: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Двинуть мышь: относительные ``dx``/``dy`` либо абсолютные ``x``/``y``."""
        if dx is None and dy is None and x is None and y is None:
            raise AgentError("mouse_move: нужен хотя бы один из dx, dy, x, y")
        return self.cmd("mouseMove", dx=dx, dy=dy, x=x, y=y)

    def wheel(self, amount: float) -> Dict[str, Any]:
        """Прокрутить колесо мыши на ``amount``."""
        return self.cmd("wheel", amount=amount)

    def screenshot(self, path: str) -> str:
        """Сохранить PNG текущего кадра; вернуть абсолютный путь к файлу.

        Движок рисует дополнительный кадр и только потом отвечает, так что файл
        к моменту возврата уже на диске. Каталог создаётся при необходимости.
        """
        target = os.path.abspath(path)
        directory = os.path.dirname(target)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self.cmd("screenshot", path=target)
        return target

    def reload(self) -> int:
        """Перезапустить игровые скрипты (hot reload вручную); вернуть число перезапусков."""
        return int(self.cmd("reload").get("reloads", 0))

    # --- идиоматичные хелперы -------------------------------------------------

    def hold(self, names: Iterable[str]) -> Dict[str, Any]:
        """Удерживать набор клавиш (синоним :meth:`keys`)."""
        return self.keys(names)

    def release_all(self) -> Dict[str, Any]:
        """Отпустить все удерживаемые клавиши."""
        return self.keys([])

    def tap(self, name: str) -> Dict[str, Any]:
        """Коротко нажать клавишу — сработает ровно на следующем кадре."""
        return self.key(name, "tap")

    def run(self, frames: int) -> Dict[str, Any]:
        """Прокрутить ``frames`` кадров (синоним :meth:`step`)."""
        return self.step(frames)

    # --- диагностика ----------------------------------------------------------

    def is_alive(self) -> bool:
        """Жив ли процесс движка."""
        return self._proc is not None and self._proc.poll() is None

    def returncode(self) -> Optional[int]:
        """Код выхода процесса либо ``None``, если он ещё работает."""
        return self._proc.poll() if self._proc is not None else None

    def stderr_text(self) -> str:
        """Весь сохранённый stderr одной строкой (последние ``2000`` строк)."""
        return "\n".join(self._stderr_lines)

    def stderr_tail(self, lines: int = 20) -> str:
        """Хвост stderr: ``lines`` последних строк — для текста ошибки."""
        tail = list(self._stderr_lines)[-max(1, int(lines)):]
        if not tail:
            return "stderr пуст"
        return "stderr (последние %d строк):\n  %s" % (len(tail), "\n  ".join(tail))


def main() -> int:
    """Небольшая самопроверка обмена с движком (ручной запуск).

    ``python3 tools/agent_client.py`` — запускает движок, печатает ``ping``,
    делает один шаг и закрывает соединение. Не является тестом набора.
    """
    with Agent() as agent:
        print("готово:", agent.ready)
        print("ping:", agent.ping())
        agent.step(1)
        print("кадр:", agent.frame(), "время: %.4f" % agent.time())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
