// Вторая сцена фикстуры: нужна для проверки $.scene.load/push/pop и store.
export function installScenes($) {
    $.scene.add('second', ($) => {
        $('<rect>', { id: 'marker' }).at(50, 50).size(20, 20).appendTo($.world);
        $.store.set('visited', $.store.get('visited', 0) + 1);
    });
}
