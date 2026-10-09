// Фикстура tests/agent/ui_virtual_mouse_test.py: RmlUi-документ с кнопками и прокручиваемым списком.
$.ready(() => {
    $.gfx.color('#101820');
    const doc = $.ui.doc('tests/fixtures/uiclick/ui/p.rml').show();
    const counts = { a: 0, b: 0, over: 0, down: 0, up: 0 };
    doc.on('btn-a', 'click', () => { counts.a++; });
    doc.on('btn-b', 'click', () => { counts.b++; });
    doc.on('btn-a', 'mouseover', () => { counts.over++; });
    doc.on('btn-a', 'mousedown', () => { counts.down++; });
    doc.on('btn-a', 'mouseup', () => { counts.up++; });
    $.agent.expose('uiclick', () => counts);
});
