// ===========================================================================
// Микрозамер раскладки данных массовых сущностей (QuickJS, без движка).
//
// Отвечает на вопрос пункта 21 плана P2 (docs/HIGH_LEVEL_API_PERF.md §5):
// стоит ли переводить частицы/пули с массива объектов на типизированные
// массивы (Structure-of-Arrays)? Гоняет один и тот же закон движения
// (гравитация, сопротивление, шаг позиции, время жизни) по трём раскладкам:
//
//   objects — массив объектов, как сейчас в particles.js;
//   f32     — SoA на Float32Array;
//   array   — SoA на обычных массивах чисел.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tools/bench_storage.mjs
//   N=20000 STEPS=500 build/_deps/quickjs-build/qjs tools/bench_storage.mjs
//
// Числа на Apple Silicon (QuickJS-ng, 5000 частиц × 300 шагов, машина без
// нагрузки, два прогона сходятся): objects 0,72 мкс/частица-шаг;
// f32 0,70 (−3 %); array 0,60 (−18 %). Вывод: в QuickJS без JIT выигрыш даёт
// раскладка SoA, а не сам Float32Array; 18 % на сцене в 1000 частиц — это
// ≈0,2 мс, меньше цены переписывания хранилища частиц вместе с их публичным
// API. Поэтому пункт 21 плана отложен, а не сделан вслепую.
// ===========================================================================

// Размер задаётся аргументами: qjs tools/bench_storage.mjs 20000 500
// (QuickJS кладёт их в scriptArgs, и первым там идёт имя файла; node — process.argv).
const args = ((typeof scriptArgs !== 'undefined' && scriptArgs)
    ? scriptArgs
    : ((typeof process !== 'undefined' && process.argv) ? process.argv : [])).filter((a) => /^\d+$/.test(String(a)));
const N = parseInt(args[0] || '5000', 10) || 5000;
const STEPS = parseInt(args[1] || '300', 10) || 300;
const DT = 1 / 60;

function now() { return Date.now(); }

function benchObjects() {
    const parts = [];
    for (let i = 0; i < N; i++) {
        parts.push({
            x: i % 100, y: (i * 7) % 100, vx: 1.5, vy: -2.5, life: 3,
            size: 4, rot: 0.1, spin: 0.02, drag: 0.98, gravity: 300, dead: false,
        });
    }
    const t0 = now();
    for (let s = 0; s < STEPS; s++) {
        for (let i = 0; i < N; i++) {
            const p = parts[i];
            if (p.dead) continue;
            p.vy += p.gravity * DT;
            p.vx *= p.drag;
            p.vy *= p.drag;
            p.x += p.vx * DT;
            p.y += p.vy * DT;
            p.rot += p.spin;
            p.life -= DT;
            if (p.life <= 0) p.dead = true;
        }
    }
    return now() - t0;
}

function benchFloat32() {
    const x = new Float32Array(N), y = new Float32Array(N);
    const vx = new Float32Array(N), vy = new Float32Array(N);
    const life = new Float32Array(N), rot = new Float32Array(N);
    const spin = new Float32Array(N), drag = new Float32Array(N), grav = new Float32Array(N);
    const dead = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
        x[i] = i % 100; y[i] = (i * 7) % 100; vx[i] = 1.5; vy[i] = -2.5; life[i] = 3;
        rot[i] = 0.1; spin[i] = 0.02; drag[i] = 0.98; grav[i] = 300;
    }
    const t0 = now();
    for (let s = 0; s < STEPS; s++) {
        for (let i = 0; i < N; i++) {
            if (dead[i]) continue;
            vy[i] += grav[i] * DT;
            vx[i] *= drag[i];
            vy[i] *= drag[i];
            x[i] += vx[i] * DT;
            y[i] += vy[i] * DT;
            rot[i] += spin[i];
            life[i] -= DT;
            if (life[i] <= 0) dead[i] = 1;
        }
    }
    return now() - t0;
}

function benchPlainArrays() {
    const x = new Array(N).fill(0), y = new Array(N).fill(0);
    const vx = new Array(N).fill(1.5), vy = new Array(N).fill(-2.5);
    const life = new Array(N).fill(3), spin = new Array(N).fill(0.02);
    const dead = new Array(N).fill(0);
    const t0 = now();
    for (let s = 0; s < STEPS; s++) {
        for (let i = 0; i < N; i++) {
            if (dead[i]) continue;
            vy[i] += 300 * DT;
            vx[i] *= 0.98;
            vy[i] *= 0.98;
            x[i] += vx[i] * DT;
            y[i] += vy[i] * DT;
            life[i] -= DT;
            if (life[i] <= 0) dead[i] = 1;
        }
    }
    return now() - t0;
}

const runs = [
    ['objects (как сейчас)', benchObjects],
    ['SoA Float32Array', benchFloat32],
    ['SoA обычный Array', benchPlainArrays],
];

const results = runs.map(([name, fn]) => [name, fn()]);
const base = results[0][1];
for (const [name, ms] of results) {
    const per = (ms * 1000) / (N * STEPS);
    const rel = ms === base ? '' : '  (' + (ms / base * 100 - 100).toFixed(0) + ' %)';
    console.log(name.padEnd(22) + ms.toString().padStart(7) + ' мс  ' +
                per.toFixed(4) + ' мкс/частица-шаг' + rel);
}
console.log('частиц ' + N + ', шагов ' + STEPS);
