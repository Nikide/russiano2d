// ===========================================================================
// Re2D — 2.5D как дополнение к 2D (docs/RE2D.md).
//
// Мир остаётся плоским: позиция, размер, тело и слои узла — обычные 2D-поля.
// Re2D добавляет ВИД на этот мир: камеру от первого лица (camera.js) и
// отрисовщики узлов вида 're2d'. Перспективу считает C (engine.re2d.*), здесь
// только сбор сцены и вызов пакетных нативных примитивов.
//
//   $.camera.kind(Re2D).eye(48).fov(70).mouseLook(true);
//   $('<player>', { id: 'hero' }).at(640, 1100).kind(Re2D).appendTo($.world);
//   $.camera.follow('#hero');
//
// Модуль ставит проход вида 're2d': когда камера имеет этот вид, render.js не
// рисует 2D-мир, а вызывает begin(cam) → узлы вида re2d → end(cam).
// ===========================================================================

import { registerKindPass, KIND_RE2D } from './kinds.js';
import { applyRe2dView } from './camera.js';

export function installRe2d($) {
    registerKindPass(KIND_RE2D, {
        begin(cam) { applyRe2dView(cam); },
        end() {},
    });

    $.re2d = {
        /** Факты о виде: камера (в градусах) и счётчики последнего нативного меша. */
        info() {
            return { camera: $.camera.info(), native: engine.re2d.info() };
        },
    };
}
