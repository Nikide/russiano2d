// Фикстура тестов HTTP-подсистемы ($.http).
//
// Сеть намеренно не используется: агентский тест проверяет доступность API,
// деградацию без сети и то, что Promise всегда завершается.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 800, 600);
    $('<rect>', { id: 'marker' }).at(40, 40).size(20, 20).appendTo($.world);
});

// Состояние подсистемы видно агенту — им же пользуется тест.
$.agent.expose('httpState', () => ({
    backend: $.http.backend(),
    available: $.http.available(),
    pending: $.http.pending(),
}));
