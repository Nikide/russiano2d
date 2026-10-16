#!/usr/bin/env python3
# ===========================================================================
# §44. Пользовательские шейдеры: лимит, ошибки компиляции, повторная регистрация.
#
# Проверяется по живому движку (фикстура tests/fixtures/render_atlas):
#   * что сборка вообще умеет компилировать шейдеры в рантайме, и на каком
#     бэкенде — факт, а не предположение; если не умеет, тест это ПИШЕТ и
#     проверки компиляции пропускает (не выдаёт «поддержано» без проверки);
#   * шапка с привязками, которую движок подставляет сам (u_texture,
#     v_texcoord, v_color, o_color) — перечислена;
#   * свой шейдер реально меняет картинку (пиксели кадра), а не только числится;
#   * ошибка компиляции не роняет кадр: defineShader → false, причина названа,
#     ранее зарегистрированные шейдеры продолжают рисоваться;
#   * повторная регистрация того же имени не течёт: и в JS, и в движке число
#     шейдеров одно и то же;
#   * предел user_shaders: сколько реально влезает, что говорит движок при
#     переполнении и как это соотносится с $.debug.limits().user_shaders_max.
#
# Запуск (после сборки движка):
#   python3 tests/agent/user_shaders_test.py
# ===========================================================================

import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "render_atlas")
FAILURES = []

#: Тело шейдера: меняет каналы местами — картинка обязана измениться заметно.
SWAP_BODY = ("void main() {\n"
             "    vec4 c = texture(u_texture, v_texcoord);\n"
             "    o_color = vec4(c.b, c.r, c.g, c.a) * v_color;\n"
             "}")
#: То же, но вдвое темнее: для повторной регистрации того же имени.
DARK_BODY = ("void main() {\n"
             "    o_color = texture(u_texture, v_texcoord) * v_color * 0.4;\n"
             "}")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, name):
    path = os.path.join(ROOT, "build", "user_shaders_%s.png" % name)
    a.screenshot(path)
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def main():
    with Agent(game=GAME, seed=17) as a:
        a.step(3)

        supported = a.eval("$.gfx.shadersSupported()")
        gpu = [l for l in a.stderr_text().splitlines() if "GPU-бэкенд" in l]
        backend = gpu[-1].split("GPU-бэкенд:")[-1].strip() if gpu else "не назван"
        print("  --   бэкенд: %s; компиляция шейдеров в рантайме: %s" % (backend, supported))

        # Шапка доступна всегда: она описывает привязки конвейера.
        preamble = a.eval("$.gfx.shaderPreamble()")
        for token in ("u_texture", "v_texcoord", "v_color", "o_color"):
            check(token in preamble, "шапка движка объявляет %s" % token)

        if not supported:
            # Честный отказ вместо выдуманного «работает»: на этом бэкенде
            # компиляции нет, и остальные проверки §44 неприменимы.
            print("  --   компиляция в рантайме НЕ поддержана на бэкенде %s — "
                  "проверки компиляции пропущены (это не «зелёный» результат)" % backend)
            check(a.eval("$.gfx.defineShader('nope', '%s')" % SWAP_BODY.replace("\n", " ")) is False,
                  "defineShader возвращает false, когда компилятора в сборке нет")
            check(a.eval("$.gfx.shaderError()") != "", "причина отказа названа: %s"
                  % a.eval("$.gfx.shaderError()")[:90])
            check(a.ping().get("pong") is True, "движок отвечает")
            print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
            return 1 if FAILURES else 0

        # Сцена: спрайт с кадром атласа; шейдер вешаем на него.
        a.eval("""globalThis.__probe = $('<sprite>', { id: 'shader_probe' })
                    .at(300, 200).size(64, 64)
                    .sprite(atlasSheets.hero.frame('run_0')).appendTo($.world); 'ok'""")
        a.step(2)
        plain = shot(a, "plain")
        errors_before = a.eval("$.debug.errors().length")

        # --- Успешная регистрация и реальная отрисовка ------------------------
        ok = a.eval("$.gfx.defineShader('probe_swap', %s)" % repr(SWAP_BODY).replace("'", '"'))
        check(ok is True, "шейдер зарегистрирован (shaderError=%r)" % a.eval("$.gfx.shaderError()"))
        check(a.eval("$.gfx.userShaders()") == ["probe_swap"],
              "имя шейдера видно в $.gfx.userShaders(): %s" % a.eval("$.gfx.userShaders()"))
        count_js = a.eval("$.gfx.userShaders().length")
        count_engine = a.eval("engine.userShaderCount()")
        check(count_js == count_engine == 1,
              "JS и движок считают шейдеры одинаково: %s / %s" % (count_js, count_engine))

        applied = a.eval("""(() => {
            $('#shader_probe').shader('probe_swap');
            return $('#shader_probe').shader();
        })()""")
        a.step(2)
        swapped = shot(a, "swap")
        check(applied == "probe_swap", "шейдер применён к узлу: %s" % applied)
        check(swapped != plain, "свой шейдер реально изменил кадр (не только записан)")
        check(a.eval("$.debug.errors().length") == errors_before,
              "отрисовка своим шейдером не дала ошибок")

        # --- Повторная регистрация того же имени не течёт ---------------------
        again = a.eval("$.gfx.defineShader('probe_swap', %s)" % repr(DARK_BODY).replace("'", '"'))
        a.step(2)
        dark = shot(a, "swap_dark")
        check(again is True, "повторная регистрация того же имени принята")
        check(a.eval("$.gfx.userShaders().length") == 1 and a.eval("engine.userShaderCount()") == 1,
              "повторная регистрация не растит число шейдеров: js=%s engine=%s"
              % (a.eval("$.gfx.userShaders().length"), a.eval("engine.userShaderCount()")))
        check(dark != swapped and dark != plain, "новое тело шейдера реально применилось (кадр изменился)")
        print("  --   лимит движка: занято %s из %s ($.debug.limits().user_shaders_max)"
              % (a.eval("engine.userShaderCount()"), a.eval("$.debug.limits().user_shaders_max")))

        # --- Ошибка компиляции не роняет кадр ---------------------------------
        frames_before = a.eval("engine.frame")
        bad = a.eval("$.gfx.defineShader('probe_bad', 'void main() { o_color = no_such_thing; }')")
        message = a.eval("$.gfx.shaderError()")
        print("  --   ошибка компиляции: %s" % message.replace("\n", " ")[:110])
        check(bad is False, "несобираемый шейдер возвращает false")
        check(bool(message) and "no_such_thing" in message,
              "причина компиляции названа движком (не молчание)")
        check(a.eval("$.gfx.userShaders()").count("probe_bad") == 0,
              "несобиравшийся шейдер не попал в список: %s" % a.eval("$.gfx.userShaders()"))
        check(a.eval("engine.userShaderCount()") == 1,
              "несобиравшийся шейдер не занял слот в движке: %s" % a.eval("engine.userShaderCount()"))
        a.step(3)
        after_bad = shot(a, "after_bad")
        check(a.eval("engine.frame") > frames_before, "кадры идут после ошибки компиляции")
        check(after_bad == dark, "прежний шейдер продолжает рисоваться после ошибки компиляции")

        # --- Синтаксические проверки тела до компилятора ----------------------
        cases = [
            ("version", "#version 450\nvoid main() { o_color = vec4(1.0); }", "#version"),
            ("no_main", "float f() { return 1.0; }", "main"),
            ("no_color", "void main() { float x = 1.0; }", "o_color"),
        ]
        for name, body, hint in cases:
            rejected = a.eval("$.gfx.defineShader('probe_%s', %s)"
                              % (name, repr(body).replace("'", '"')))
            err = a.eval("$.gfx.shaderError()")
            check(rejected is False and hint in err,
                  "тело без %s отклонено с объяснением: %s" % (hint, err[:80]))
        check(a.eval("$.gfx.defineShader('flash', %s)" % repr(SWAP_BODY).replace("'", '"')) is False,
              "занятое встроенное имя не перекрывается своим шейдером")
        check(a.eval("engine.userShaderCount()") == 1,
              "отклонённые регистрации не заняли слотов: %s" % a.eval("engine.userShaderCount()"))

        # --- Предел user_shaders ----------------------------------------------
        existing = a.eval("$.gfx.userShaders().length")
        capacity = a.eval("""(() => {
            let n = 0;
            for (let i = 0; i < 64; i++) {
                const ok = $.gfx.defineShader('fill_' + i,
                    'void main() { o_color = texture(u_texture, v_texcoord) * v_color; }');
                if (!ok) break;
                n++;
            }
            return n;
        })()""")
        limit_error = a.eval("$.gfx.shaderError()")
        max_reported = a.eval("$.debug.limits().user_shaders_max")
        total_fit = existing + capacity
        print("  --   всего влезло %s шейдеров (было %s, добавлено %s); сообщение движка: %s"
              % (total_fit, existing, capacity, limit_error))
        print("  --   user_shaders_max=%s, реально доступно %s: слот 0 занят обычным спрайтом"
              % (max_reported, total_fit))
        check(total_fit <= max_reported,
              "заявленный максимум не меньше реально доступного (%s <= %s)" % (total_fit, max_reported))
        check(str(total_fit) in str(limit_error),
              "сообщение о лимите называет ТУ ЖЕ ёмкость (%s): %s" % (total_fit, limit_error))
        check(a.eval("$.gfx.userShaders().length") == a.eval("engine.userShaderCount()") == total_fit,
              "JS и движок согласны на пределе: %s / %s"
              % (a.eval("$.gfx.userShaders().length"), a.eval("engine.userShaderCount()")))
        check(a.eval("$.gfx.userShaders()").count("probe_swap") == 1,
              "переполнение не вытеснило ранее зарегистрированный шейдер")

        # --- Кадр жив и шейдеры рисуются --------------------------------------
        a.step(2)
        check(a.eval("engine.frame") > 0 and a.ping().get("pong") is True,
              "движок отвечает после заполнения лимита шейдеров")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
