// ===========================================================================
// Russiano2D Editor — точка входа (docs/EDITOR.md).
//
//   r2d                 Project Manager
//   r2d edit <проект>   сразу открыть проект
//
// src/main.c запускает этот каталог как обычный проект (--game editor) и
// передаёт путь проекта через --scene: здесь он приходит как $.startScene.
// ===========================================================================

import { createEditor } from './app.js';

let editor = null;

$.ready(() => {
    editor = createEditor($);
    $.editorApp = editor;    // та же поверхность для агента: eval("$.editorApp…")
    editor.start($.startScene || '');
});

$.update((dt) => {
    if (editor) editor.update(dt);
});
