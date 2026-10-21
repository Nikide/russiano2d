// Фикстура системы сниппетов: герой и пол создаются кодом, поведение
// подключает Editor через editor.snippets → generated/snippets.
import './generated/snippets/index.js'; // r2d:snippets — подключение сгенерированных сниппетов (Editor)
$.ready(() => {
    $('<ground>', { id: 'floor' }).at(320, 340).size(640, 20).body('static').appendTo($.world);
    $('<hero>', { id: 'hero' }).at(100, 300).size(16, 24).body('dynamic').appendTo($.world);
});
