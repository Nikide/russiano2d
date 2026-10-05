// ===========================================================================
// Главное меню. Интерфейс — документ RmlUi (game/ui/menu.rml + menu.rcss).
//
// Этот файл показывает второй путь интерфейса в $: узлы <ui.*> рисует сам
// движок, а документы RmlUi дают полную вёрстку со стилями. Здесь выбран
// RmlUi, потому что меню — это статичная разметка, а не игровой HUD.
// ===========================================================================

export default function installMenu($) {
    $.scene.add('menu', {
        enter($) {
            // $.ui.doc() кэширует обёртку по пути, а слушатели вешаются один
            // раз — иначе при возврате в меню клик срабатывал бы дважды.
            this.doc = $.ui.doc('ui/menu.rml')
                .on('btn-play', 'click', () => $.scene.load('platformer'))
                .on('btn-quit', 'click', () => $.quit())
                .show();

            const best = $.store.get('best', 0);
            if (best > 0) this.doc.text('subtitle', `Лучший результат: ${best}`);
        },

        exit() {
            if (this.doc) this.doc.hide();
        },

        update(dt, $) {
            // Меню обязано работать и без мыши.
            if ($.input.pressed('enter') || $.input.pressed('space')) $.scene.load('platformer');
            if ($.input.pressed('escape')) $.quit();
        },
    });
}
