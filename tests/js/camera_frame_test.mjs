// ===========================================================================
// Юнит-тесты математики кадра (поворот камеры): src/highlevel/camera.js.
//
// Поворот кадра — это одна матрица, которой пользуются И отрисовка, И
// $.camera.worldToScreen(). Если бы их считали отдельно, картинка и «где на
// экране точка» разъехались бы при первом же повороте — ровно тот класс
// ошибок, который ищут глазами. Поэтому здесь проверяется и сама матрица, и её
// взаимная обратимость.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/camera_frame_test.mjs
// ===========================================================================

import { test, eq, near, truthy, finish } from './_harness.mjs';
import { frameWorldToScreen, frameScreenToWorld } from '../../src/highlevel/camera.js';

const W = 800, H = 600;
const IDENTITY = { x: 0, y: 0, zoom: 1, rotation: 0 };

test('без поворота: знакомая формула зума', () => {
    const p = frameWorldToScreen(IDENTITY, 100, 50, W, H);
    near(p.x, 500, 1e-6);
    near(p.y, 350, 1e-6);
    const z = frameWorldToScreen({ x: 100, y: 50, zoom: 2, rotation: 0 }, 100, 50, W, H);
    near(z.x, 400, 1e-6, 'центр камеры остаётся в центре окна');
    near(z.y, 300, 1e-6);
});

test('центр камеры всегда в центре окна, при любом повороте', () => {
    for (const a of [0, 0.5, Math.PI / 2, Math.PI, -1.2]) {
        const p = frameWorldToScreen({ x: 640, y: 360, zoom: 1.7, rotation: a }, 640, 360, W, H);
        near(p.x, W / 2, 1e-6, `угол ${a}: x центра`);
        near(p.y, H / 2, 1e-6, `угол ${a}: y центра`);
    }
});

test('поворот на 90° переносит ось X в ось Y экрана', () => {
    // Точка справа от камеры при повороте на 90° уходит ВНИЗ: положительный
    // угол поворачивает мир по часовой стрелке на экране.
    const right = frameWorldToScreen(IDENTITY, 100, 0, W, H);
    near(right.x, 500, 1e-6); near(right.y, 300, 1e-6, 'до поворота — справа');

    const rotated = frameWorldToScreen({ ...IDENTITY, rotation: Math.PI / 2 }, 100, 0, W, H);
    near(rotated.x, 400, 1e-6, 'после поворота ушла в центр по X');
    near(rotated.y, 400, 1e-6, 'и вниз по Y');
});

test('поворот и зум не зависят от порядка применения', () => {
    // Поворот вокруг центра камеры коммутирует с зумом: масштаб — это
    // умножение длины вектора, а поворот — его направления.
    const a = { x: 10, y: 20, zoom: 2.5, rotation: 0.7 };
    const p = frameWorldToScreen(a, 60, -30, W, H);
    // Вручную: вектор, повёрнутый и растянутый.
    const dx = (60 - 10) * 2.5, dy = (-30 - 20) * 2.5;
    const c = Math.cos(0.7), s = Math.sin(0.7);
    near(p.x, dx * c - dy * s + W / 2, 1e-6);
    near(p.y, dx * s + dy * c + H / 2, 1e-6);
});

test('screenToWorld — обратная операция (круговой рейс)', () => {
    const states = [
        { x: 0, y: 0, zoom: 1, rotation: 0 },
        { x: 320, y: 240, zoom: 1.5, rotation: 0.9 },
        { x: -100, y: 700, zoom: 0.6, rotation: -2.3 },
    ];
    for (const st of states) {
        for (const [x, y] of [[0, 0], [123, -456], [-7, 900]]) {
            const screen = frameWorldToScreen(st, x, y, W, H);
            const back = frameScreenToWorld(st, screen.x, screen.y, W, H);
            near(back.x, x, 1e-6, `мир→экран→мир по X (${x}, ${y})`);
            near(back.y, y, 1e-6, `мир→экран→мир по Y (${x}, ${y})`);
        }
    }
});

test('угол сохраняет расстояния: поворот не растягивает кадр', () => {
    const a = { x: 0, y: 0, zoom: 2, rotation: 1.1 };
    const p1 = frameWorldToScreen(a, 0, 0, W, H);
    const p2 = frameWorldToScreen(a, 30, 40, W, H);
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    near(dist, 50 * 2, 1e-6, 'расстояние умножилось на зум и не изменилось от поворота');
});

finish();
