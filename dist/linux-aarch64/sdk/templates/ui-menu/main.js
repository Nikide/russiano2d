// {{name}} — меню на RmlUi: разметка и стили лежат в ui/menu.rml и ui/menu.rcss.
$.ready(() => {
    $.gfx.color('#0b0e14');
    const menu = $.ui.doc('ui/menu.rml').show();
    menu.on('btn-play', 'click', () => menu.text('status', 'Игра начинается…'));
    menu.on('btn-quit', 'click', () => $.quit());
});
