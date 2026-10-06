#!/usr/bin/env python3
# ===========================================================================
# Тест режимов смешивания и заглушки render target через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/render и проверяет то, что видит игра:
# $.blend()/node.blend_mode доходят до батча, все четыре режима рисуются в
# одном кадре и не ломают вывод, а $.viewport даёт игре свою текстуру
# (render target) и режим смешивания. Картинку целиком не сверяем — только
# размер скриншота, пиксельные проверки эффектов и живые счётчики кадра.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_render_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "render")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- $.blend: геттер/сеттер и валидация -------------------------------
        check(a.eval("typeof $.blend") == "function", "$.blend доступно")
        check(a.eval("$.blend()") == "alpha", "режим по умолчанию — alpha")

        a.eval("$.blend('add')")
        check(a.eval("$.blend()") == "add", "$.blend('add') сменил режим по умолчанию")
        check(a.eval("$.blend('screen')") == "add",
              "неизвестный режим не меняет текущий")
        a.eval("$.blend('alpha')")
        check(a.eval("$.blend()") == "alpha", "режим вернулся к alpha")

        # --- node.blend_mode --------------------------------------------------
        for node_id, mode in (("b_alpha", "alpha"), ("b_add", "add"),
                              ("b_multiply", "multiply"), ("b_none", "none")):
            check(a.eval("$('#%s').blend()" % node_id) == mode,
                  "узел #%s в режиме %s" % (node_id, mode))
        check(a.eval("$('#b_bad').blend()") == "alpha",
              "неизвестный режим узла откатился в alpha")

        # --- Кадр со всеми режимами рисуется ---------------------------------
        a.step(2)
        stats = a.eval("$.gfx.stats()")
        check(isinstance(stats, dict) and stats.get("sprites", 0) >= 6,
              "все узлы со своими режимами попали в батч (sprites=%s)"
              % (stats.get("sprites") if isinstance(stats, dict) else stats))
        check(a.eval("engine.frame") > 0, "кадры идут")

        # --- $.viewport: render target игры ------------------------------------
        # Раньше здесь была заглушка, которая бросала «не поддержано». Теперь
        # кадр можно рисовать в свою текстуру: bind() — цель кадра, sprite() —
        # прошлый кадр для шлейфов.
        check(a.eval("typeof $.viewport") == "object", "$.viewport доступно")
        check(a.eval("$.viewport.supported") is True, "render target поддержан")
        check(a.eval("$.viewport.count()") == 0, "текстур пока нет")

        vp = a.eval("globalThis.__vp = $.viewport.create(320, 240)")
        check(isinstance(vp, int) and vp >= 0, "create() вернул id (%s)" % vp)
        check(a.eval("$.viewport.count()") == 1, "текстура учтена")
        size = a.eval("$.viewport.size(globalThis.__vp)")
        check(isinstance(size, dict) and size.get("w") == 320 and size.get("h") == 240,
              "размер текстуры читается обратно (%s)" % size)
        check(a.eval("$.viewport.sprite(globalThis.__vp)") >= 0,
              "у текстуры есть спрайт прошлого кадра")

        bound = a.eval("""
            (() => {
                const ok = $.viewport.bind(globalThis.__vp);
                const id = $.viewport.bound();
                return [ok, id];
            })()
        """)
        check(isinstance(bound, list) and bound[0] is True and bound[1] == vp,
              "bind() связывает кадр с текстурой (%s)" % bound)

        # Кадр уходит в текстуру, а на экран движок показывает его блитом:
        # значит, снимок кадра обязан остаться непустым.
        a.step(3)
        shot = a.screenshot(os.path.join(ROOT, "build", "render_viewport_test.png"))
        check(os.path.getsize(shot) > 0, "кадр со связанным viewport сохранён")

        # Привязка живёт один кадр: игра вызывает bind() в своём кадре заново.
        check(a.eval("$.viewport.bound()") is None, "привязка сбрасывается после кадра")
        check(a.eval("$.viewport.unbind()") is True, "unbind() возвращает кадр на экран")
        check(a.eval("$.viewport.bind(-5)") in (True, False), "bind(-5) отвечает булевым")

        check(a.eval("$.viewport.destroy(globalThis.__vp)") is True, "destroy() удаляет текстуру")
        check(a.eval("$.viewport.count()") == 0, "после destroy текстур нет")
        a.step(2)
        check(a.ping().get("pong") is True, "движок жив после render target")

        # --- Пост-обработка ---------------------------------------------------
        supported = a.eval("engine.postSupported()")
        check(isinstance(supported, bool), "postSupported() отвечает да/нет")
        check(a.eval("typeof $.gfx.post") == "function", "$.gfx.post доступно")
        check(a.eval("$.gfx.postSupported()") == supported,
              "$.gfx.postSupported() совпадает с движком")

        a.step(3)
        clean = a.screenshot(os.path.join(ROOT, "build", "render_post_off.png"))
        check(os.path.getsize(clean) > 0, "кадр без поста сохранён")

        a.eval("$.gfx.post({ vignette: 0.9, glow: 0.4, grain: 0.2, chromatic: 0.004 })")
        now = a.eval("$.gfx.post()")
        check(isinstance(now, dict) and abs(now.get("vignette", 0) - 0.9) < 1e-6,
              "параметры поста читаются обратно (%s)" % now)
        a.step(3)
        tinted = a.screenshot(os.path.join(ROOT, "build", "render_post_on.png"))
        check(os.path.getsize(tinted) > 0, "кадр с пост-обработкой сохранён")

        if supported:
            check(open(clean, "rb").read() != open(tinted, "rb").read(),
                  "пост-обработка меняет картинку кадра")
        else:
            print("  пропуск: сборка без пост-обработки (шейдер не поднялся)")

        # Линза — экранное искажение: главный эффект для взрывов и чёрной дыры.
        a.eval("$.gfx.post({ lens: 1.1, centerX: 0.5, centerY: 0.5, radius: 0.3 })")
        a.step(3)
        check(a.ping().get("pong") is True, "движок жив после кадра с линзой")

        a.eval("$.gfx.post({ on: false })")
        a.step(2)
        check(a.eval("$.gfx.post().enabled") == 0, "пост выключается")

        # --- Камерные пресеты: от мультика до хоррора -------------------------
        names = a.eval("$.gfx.postPresets()")
        check(isinstance(names, list) and "horror" in names and "adventure" in names,
              "список камерных пресетов (%s)" % names)

        a.eval("$.gfx.postPreset('horror')")
        a.step(3)
        horror = a.eval("$.gfx.post()")
        check(isinstance(horror, dict) and horror.get("saturation", 1) < 0.5,
              "хоррор обесцвечивает кадр (saturation=%s)" % (horror or {}).get("saturation"))
        check((horror or {}).get("vignette", 0) > 0.5, "хоррор сильно вигнетирует")
        check((horror or {}).get("blood", 0) > 0, "у хоррора кровавые края")

        a.eval("$.gfx.postPreset('adventure', { ms: 400 })")
        a.step(1)
        mid = a.eval("$.gfx.post()")
        check(isinstance(mid, dict) and mid.get("saturation", 0) > (horror or {}).get("saturation", 0),
              "переход идёт плавно, а не рывком (saturation=%s)"
              % (mid or {}).get("saturation"))
        a.step(40)
        warm = a.eval("$.gfx.post()")
        check(isinstance(warm, dict) and warm.get("saturation", 0) > 1.1,
              "мультяшный пресет досчитался (saturation=%s)" % (warm or {}).get("saturation"))
        check((warm or {}).get("enabled", 0) == 1, "пресет включает пост сам")

        a.eval("$.gfx.postPreset('нейвероятный-пресет')")
        check(a.eval("$.gfx.post().saturation") == (warm or {}).get("saturation"),
              "неизвестный пресет ничего не меняет")

        shot = a.screenshot(os.path.join(ROOT, "build", "render_post_horror.png"))
        check(os.path.getsize(shot) > 0, "кадр в хорроре сохранён")

        # --- Честный bloom: отдельные проходы, а не выборки в посте ------------
        # Раньше свечение было восемью выборками в одном проходе пост-обработки.
        # Теперь это яркий проход с понижением разрешения и два размытия:
        # их видно по счётчику проходов и по буферам половинного разрешения.
        a.eval("$.gfx.post({ on: false }); 'ok'")
        a.step(2)
        info = a.eval("engine.renderInfo()")
        check(isinstance(info, dict) and "bloom_ready" in info,
              "engine.renderInfo() отвечает полями свечения: %s" % info)
        check(isinstance(info, dict) and info.get("passes") == 0,
              "без поста полноэкранных проходов нет")

        a.eval("$.gfx.post({ glow: 1.2, bloom_threshold: 0.45, bloom_radius: 1.5 }); 'ok'")
        a.step(2)
        info = a.eval("engine.renderInfo()")
        check(isinstance(info, dict) and info.get("bloom_ready") is True,
              "свечение посчиталось отдельными проходами")
        check(isinstance(info, dict) and info.get("passes") >= 4,
              "проходов не меньше четырёх: порог, два размытия и композит (%s)"
              % (info or {}).get("passes"))
        check(isinstance(info, dict) and info.get("bloom_w") == info.get("scene_w") // 2
              and info.get("bloom_h") == info.get("scene_h") // 2,
              "буферы свечения половинного разрешения: %sx%s при сцене %sx%s"
              % ((info or {}).get("bloom_w"), (info or {}).get("bloom_h"),
                 (info or {}).get("scene_w"), (info or {}).get("scene_h")))

        post = a.eval("engine.getPost()")
        check(isinstance(post, dict) and abs(post.get("bloom_threshold", 0) - 0.45) < 1e-6,
              "порог свечения доехал до движка (%s)" % (post or {}).get("bloom_threshold"))
        check(isinstance(post, dict) and post.get("bloom_ready") is True,
              "getPost() сообщает, что свечение готово")
        js_post = a.eval("$.gfx.post()")
        check(isinstance(js_post, dict) and abs(js_post.get("bloom_radius", 0) - 1.5) < 1e-6,
              "$.gfx.post() отдаёт параметры свечения обратно")

        shot = a.screenshot(os.path.join(ROOT, "build", "render_bloom_test.png"))
        check(os.path.getsize(shot) > 0, "кадр со свечением сохранён: " + shot)

        # --- Шейдер узла (.shader) ---------------------------------------------
        # Раньше .shader() писал предупреждение и ничего не делал: пайплайн был
        # один на все узлы. Теперь есть конвейеры шейдеров узла и таблица
        # эффектов на кадр.
        check(a.eval("typeof $('#base').shader") == "function", ".shader() существует")
        check(a.eval("typeof $('#base').shaderParam") == "function", ".shaderParam() существует")
        kinds = a.eval("$.gfx.fxKinds()")
        check(isinstance(kinds, list) and "flash" in kinds and "dissolve" in kinds
              and "chroma" in kinds and "wave" in kinds,
              "виды эффектов перечисляются: %s" % kinds)
        check(a.eval("$('#base').shader()") == "none", "по умолчанию шейдера нет")

        a.eval("$.gfx.postOff(); 'ok'")
        a.step(2)
        check(a.eval("engine.renderInfo().fx_cmds") == 0,
              "без шейдеров команд с эффектом нет")

        a.eval("$('#base').shader('flash', { color: '#ff0000', amount: 1 }); 'ok'")
        check(a.eval("$('#base').shader()") == "flash", ".shader() читается обратно")
        params = a.eval("$('#base').shaderParam()")
        check(isinstance(params, dict) and params.get("amount") == 1,
              "параметры шейдера доступны через .shaderParam()")
        a.step(2)
        info = a.eval("engine.renderInfo()")
        check(isinstance(info, dict) and info.get("fx_cmds", 0) >= 1,
              "кадр нарисовал узел шейдером узла (fx_cmds=%s)" % (info or {}).get("fx_cmds"))
        check(isinstance(info, dict) and info.get("fx", 0) >= 1,
              "таблица эффектов кадра не пуста")

        a.eval("$('#base').shaderParam('amount', 0.25); 'ok'")
        check(abs(a.eval("$('#base').shaderParam('amount')") - 0.25) < 1e-6,
              ".shaderParam() меняет один параметр")

        a.eval("$('#base').shader('нет-такого-эффекта'); 'ok'")
        check(a.eval("$('#base').shader()") == "flash",
              "неизвестный эффект не сбивает текущий")
        a.eval("$('#base').shader(null); 'ok'")
        a.step(2)
        check(a.eval("$('#base').shader()") == "none", "shader(null) выключает эффект")
        check(a.eval("engine.renderInfo().fx_cmds") == 0, "и команд с эффектом больше нет")

        # --- Ореол свечения в пикселях ----------------------------------------
        # Сцена приводится к тёмному фону с одной яркой вспышкой: на большом
        # светлом пятне «ярче вокруг» не измерить — там всё яркое.
        # Pillow может отсутствовать — тогда проверка пропускается, а не валит тест.
        try:
            from PIL import Image   # noqa: PLC0415
        except ImportError:
            print("  skip пиксельная проверка свечения: нет Pillow")
        else:
            a.eval("""
                $.world.color('#000000');
                $('#base, #b_alpha, #b_add, #b_multiply, #b_none, #b_bad, #bright').remove();
                $('<rect>', { id: 'bright' }).at(400, 300).size(40, 40)
                    .color('#ffffff').appendTo($.world);
                'ok'
            """)
            a.eval("$.gfx.post({ on: false }); 'ok'")
            a.step(3)
            off_path = a.screenshot(os.path.join(ROOT, "build", "render_bloom_off.png"))
            a.eval("$.gfx.post({ glow: 1.5, bloom_threshold: 0.35, bloom_radius: 1.5 }); 'ok'")
            a.step(3)
            on_path = a.screenshot(os.path.join(ROOT, "build", "render_bloom_on.png"))

            def bright_box(path):
                """Прямоугольник самой яркой области кадра — источника свечения."""
                img = Image.open(path).convert("RGB")
                w, h = img.size
                pix = img.load()
                xs, ys = [], []
                for y in range(h):
                    for x in range(w):
                        if sum(pix[x, y]) / 3.0 > 200:
                            xs.append(x)
                            ys.append(y)
                if not xs:
                    return None
                return (min(xs), min(ys), max(xs), max(ys))

            def halo(path, box):
                """Средняя яркость кольца 12..70 px вокруг источника."""
                img = Image.open(path).convert("RGB")
                w, h = img.size
                pix = img.load()
                x0, y0, x1, y1 = box
                total, count = 0.0, 0
                for y in range(max(0, y0 - 70), min(h, y1 + 71)):
                    for x in range(max(0, x0 - 70), min(w, x1 + 71)):
                        dx = max(x0 - x, 0, x - x1)
                        dy = max(y0 - y, 0, y - y1)
                        if dx * dx + dy * dy < 12 * 12:
                            continue        # сам источник и его кромка
                        total += sum(pix[x, y]) / 3.0
                        count += 1
                return total / max(1, count)

            probe = bright_box(off_path)
            check(probe is not None, "во вспышке есть яркие пиксели")
            off_halo = halo(off_path, probe) if probe else 0.0
            on_halo = halo(on_path, probe) if probe else 0.0
            check(on_halo > off_halo + 0.5,
                  "вокруг источника стало светлее: %.3f → %.3f" % (off_halo, on_halo))
            check(on_halo > 0.5, "ореол свечения виден в пикселях (%.3f)" % on_halo)

        # --- Пользовательские шейдеры ($.gfx.defineShader) ---------------------
        # Рантайм-компиляция GLSL: glslang (GLSL → SPIR-V) и spirv-cross
        # (SPIR-V → MSL). Раньше это была последняя строка таблицы §28.
        check(a.eval("$.gfx.shadersSupported()") is True,
              "компиляция шейдеров в рантайме поддержана")
        preamble = a.eval("$.gfx.shaderPreamble()")
        check(isinstance(preamble, str) and "u_texture" in preamble and "v_texcoord" in preamble,
              "шапка шейдера объясняет привязки (%d байт)" % len(preamble or ""))
        check(a.eval("$.gfx.userShaders()") == [], "своих шейдеров пока нет")

        user_src = ("void main() {\n"
                    "    vec4 c = texture(u_texture, v_texcoord) * v_color;\n"
                    "    o_color = vec4(c.r * 0.1, 1.0, c.b * 0.1, c.a);\n"
                    "}")
        check(a.eval("$.gfx.defineShader('greenish', %r)" % user_src) is True,
              "свой шейдер скомпилировался")
        check(a.eval("$.gfx.userShaders()") == ["greenish"], "шейдер попал в список")
        check(a.eval("$.gfx.shaderError()") == "", "ошибок компиляции нет")

        check(a.eval("$.gfx.defineShader('flash', 'void main() { o_color = vec4(1.0); }')") is False,
              "встроенное имя занять нельзя")
        check(a.eval("$.gfx.defineShader('broken', 'void main() { o_color = broken(); }')") is False,
              "сломанный шейдер не компилируется")
        broken_error = a.eval("$.gfx.shaderError()")
        check(isinstance(broken_error, str) and "broken" in broken_error,
              "текст ошибки компилятора доступен игре (%s...)" % (broken_error or "")[:60])

        # Свой шейдер идёт тем же путём отрисовки, что встроенные эффекты.
        a.eval("""
            $.gfx.postOff();
            $.world.color('#000000');
            $('#base, #fxprobe, #userprobe').remove();
            globalThis.__cam = $.camera.pos();
            $('<rect>', { id: 'userprobe' }).at(__cam.x, __cam.y).size(80, 80)
                .color('#ffffff').appendTo($.world);
            $('#userprobe').shader('greenish');
            'ok'
        """)
        a.step(3)
        info = a.eval("engine.renderInfo()")
        check(isinstance(info, dict) and info.get("fx_cmds", 0) >= 1,
              "узел нарисован пользовательским шейдером (fx_cmds=%s)" % (info or {}).get("fx_cmds"))

        user_shot = a.screenshot(os.path.join(ROOT, "build", "render_user_shader.png"))
        check(os.path.getsize(user_shot) > 0, "кадр со своим шейдером сохранён")
        try:
            from PIL import Image   # noqa: PLC0415
        except ImportError:
            print("  skip пиксельная проверка своего шейдера: нет Pillow")
        else:
            img = Image.open(user_shot).convert("RGB")
            w, h = img.size
            pix = img.load()
            green = sum(1 for y in range(h) for x in range(w)
                        if pix[x, y][1] > 200 and pix[x, y][0] < 60)
            check(green > 3000, "свой шейдер перекрасил узел в зелёный (%d px)" % green)

        a.eval("$('#userprobe').shader(null); 'ok'")
        a.step(2)

        # --- Вспышка шейдером узла видна в пикселях ---------------------------
        try:
            from PIL import Image   # noqa: PLC0415
        except ImportError:
            print("  skip пиксельная проверка шейдера узла: нет Pillow")
        else:
            # Проверяем на одном узле перед камерой: после блока свечения
            # сцена уже перестроена, а яркая вспышка была за кадром.
            a.eval("""
                $.gfx.postOff();
                $.world.color('#000000');
                $('#base, #b_alpha, #b_add, #b_multiply, #b_none, #b_bad, #bright, #fxprobe').remove();
                globalThis.__cam = $.camera.pos();
                $('<rect>', { id: 'fxprobe' }).at(__cam.x, __cam.y).size(80, 80)
                    .color('#ffffff').appendTo($.world);
                'ok'
            """)
            a.step(3)
            off_path = a.screenshot(os.path.join(ROOT, "build", "render_fx_off.png"))
            a.eval("$('#fxprobe').shader('flash', { color: '#ff0000', amount: 1 }); 'ok'")
            a.step(3)
            on_path = a.screenshot(os.path.join(ROOT, "build", "render_fx_flash.png"))

            def red_and_white(path):
                img = Image.open(path).convert("RGB")
                w, h = img.size
                pix = img.load()
                red = white = 0
                for y in range(h):
                    for x in range(w):
                        r, g, b = pix[x, y]
                        if r > 200 and g < 80 and b < 80:
                            red += 1
                        elif r > 200 and g > 200 and b > 200:
                            white += 1
                return red, white

            off_red, off_white = red_and_white(off_path)
            on_red, on_white = red_and_white(on_path)
            check(off_white > 0, "до эффекта вспышка белая (%d px)" % off_white)
            check(on_red > off_white // 2,
                  "после flash узел красный (%d px против %d белых)" % (on_red, on_white))
            check(on_white < off_white, "белых пикселей стало меньше (%d → %d)"
                  % (off_white, on_white))
            a.eval("$('#fxprobe').shader(null); 'ok'")

        # --- Скриншот кадра со смешиванием ------------------------------------
        shot = a.screenshot(os.path.join(ROOT, "build", "render_blend_test.png"))
        check(os.path.getsize(shot) > 0, "скриншот кадра сохранён: " + shot)
        check(a.ping().get("pong") is True, "движок жив после кадра с режимами")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
