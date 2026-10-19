// Игра по умолчанию: демо визуальной новеллы «Руси-тян: Бака!».
// Отдельный проект, чтобы релизный пакет не нёс платформер и лишние демо.
import install from './vn.js';

$.ready(async ($) => {
    install($);
    $.scene.load('russi_vn', { transition: 'none' });
});
