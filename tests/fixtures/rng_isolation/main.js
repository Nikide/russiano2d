// ===========================================================================
// Фикстура §11 (PRODUCTION_POLISH): gameplay-ГПСЧ и косметика разделены.
//
// Тест (tests/agent/highlevel_rng_isolation_test.py) гоняет ОДИН и тот же
// детерминированный сценарий дважды, меняя ровно одно — флаг косметики
// globalThis.__cosmetic:
//
//   OFF — частицы и тряска камеры не запускаются вовсе;
//   ON  — каждый кадр залп частиц (.burst) и $.camera.shake().
//
// «Геймплей» размечен фиксированно: каждые CAPTURE_EVERY кадров в захват
// уходит ровно CAPTURE_SIZE значений default-потока $.random.next() и
// столько же из $.random.stream('generation'). Косметика обязана брать своё
// из $.random.stream('presentation') и не сдвигать эти массивы.
//
// API фикстуры (тест зовёт через a.eval):
//   globalThis.__cosmetic — флаг косметики;
//   __rng.reset()         — обнулить счётчик кадров, захваты и метрики;
//   __rng.read()          — снять результат прогона (ГПСЧ не потребляет).
// ===========================================================================

const CAPTURE_EVERY = 6;   // кадров между замерами
const CAPTURE_SIZE = 2;    // значений на замер (gameplay и generation)
const FRAMES = 60;         // столько кадров гоняет тест: ровно 10 замеров

globalThis.__cosmetic = false;

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);
    $('<rect>', { id: 'mark' }).at(20, 20).size(16, 16).color('#4fd166').appendTo($.world);

    // Эмиттер выключен: залпы выдаёт только косметический путь.
    const fx = $('<particles>', {
        id: 'fx', emitting: false, amount: 0, rate: 0, max_particles: 512,
        lifetime: [600, 1200], speed: [30, 90], spread: 360,
        size: [3, 6], seed: 11,
    }).at(400, 300).appendTo($.world);

    const st = {
        armed: false, frame: 0, gen: null, pres: null,
        gameplay: [], generation: [], presentation: [],
        burst_total: 0, particles_max: 0, shake_max: 0,
    };

    // Косметика берёт случайность из СВОЕГО потока (presentation).
    function cosmetics() {
        const r = st.pres;
        const n = 2 + Math.floor(r.next() * 3);   // залп 2..4 частиц
        r.next();                                  // декоративный разброс
        fx.burst(n);
        st.burst_total += n;
        $.camera.shake(6, 200);
    }

    function sample() {
        for (let i = 0; i < CAPTURE_SIZE; i++) st.gameplay.push($.random.next());
        for (let i = 0; i < CAPTURE_SIZE; i++) st.generation.push(st.gen.next());
        st.presentation.push(st.pres.next());
    }

    $.update(() => {
        st.frame++;
        if (globalThis.__cosmetic === true) cosmetics();
        if (st.armed && st.frame % CAPTURE_EVERY === 0) sample();
        // Метрики — доказательство, что косметика реально работала.
        const cam = $.camera._state;
        st.particles_max = Math.max(st.particles_max, fx.count());
        st.shake_max = Math.max(st.shake_max, Math.abs(cam.shake_x), Math.abs(cam.shake_y));
    });

    globalThis.__rng = {
        frames: FRAMES,
        captureSize: CAPTURE_SIZE,
        every: CAPTURE_EVERY,

        reset() {
            globalThis.__cosmetic = false;
            st.gen = $.random.stream('generation');
            st.pres = $.random.stream('presentation');
            st.armed = true;
            st.frame = 0;
            st.gameplay = [];
            st.generation = [];
            st.presentation = [];
            st.burst_total = 0;
            st.particles_max = 0;
            st.shake_max = 0;
            fx.stop().clear();
            // Погасить тряску прошлого прогона напрямую: $.camera.shake(0, 0)
            // не годится — нулевая амплитуда трактуется как «по умолчанию»
            // (intensity || 4), то есть запустила бы тряску, а не сняла её.
            const cam = $.camera._state;
            cam.shake_t = 0; cam.shake_amp = 0; cam.shake_x = 0; cam.shake_y = 0;
        },

        read() {
            return {
                frames: st.frame,
                gameplay: st.gameplay.slice(),
                generation: st.generation.slice(),
                presentation: st.presentation.slice(),
                cosmetic: globalThis.__cosmetic === true,
                metrics: {
                    burst_total: st.burst_total,
                    particles_max: st.particles_max,
                    particles_alive: fx.count(),
                    shake_max: st.shake_max,
                },
            };
        },
    };
});
