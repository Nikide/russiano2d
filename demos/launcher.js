// ===========================================================================
// Меню-лаунчер: выбор демо.
//
// Кнопки строятся по списку сцен, которые зарегистрировали демо-модули, плюс
// таблица подписей ниже. Добавить новое демо — положить demos/имя/index.js и
// дописать одну строку регистрации в demos/main.js.
//
// Интерфейс — узлы <ui.*> высокоуровневого API: они рисуются самим движком,
// работают без .rml-файлов и видны агенту через $.agent.snapshot().
// ===========================================================================

const TITLES = {
    platformer: { title: 'Платформер',   icon: 'directions_run',        hint: 'Box2D, анимация, монеты, враги, HUD' },
    shooter25d: { title: '2.5D шутер',   icon: 'my_location',           hint: 'рейкастинг, билборды, оружие от первого лица' },
    gallery:    { title: 'Галерея',      icon: 'collections',           hint: 'все анимационные листы с управлением' },
    arena:      { title: 'Арена',        icon: 'sports_martial_arts',   hint: 'волны врагов, стрельба, экран проигрыша' },
    physics:    { title: 'Физика',       icon: 'science',               hint: 'песочница Box2D: ящики, взрывы, гравитация' },
    bsp:        { title: 'BSP',          icon: 'account_tree',          hint: 'порядок отрисовки без z-буфера' },
    light:      { title: 'Свет и тени',  icon: 'lightbulb',             hint: 'полигоны видимости, тени из геометрии' },
    shooter_witch: { title: 'Ведьма',    icon: 'auto_awesome',
                     hint: 'ночной лес, фонари, кровь, авто-стрельба, апгрейды',
                     art: 'demos/assets/art/menu/witch_menu.png' },
};

export default function installLauncher($) {
    $.scene.add('launcher', {
        enter($) {
            const names = $.scene.names().filter((n) => n !== 'launcher');
            const icon = (name) => ($.ui.hasIcon(name) ? $.ui.icon(name) : '');

            // Фон меню: арт того демо, у которого он есть. Картинка лежит под
            // кнопками, поэтому создаётся первой; затемнение — панелью поверх.
            const backdrop = Object.values(TITLES).find((t) => t.art);
            if (backdrop) {
                $('<ui.image>', { id: 'menu_bg' })
                    .at(640, 360).size(1280, 720)
                    // Арт притемняем им же: панель поверх съедала картинку целиком.
                    .sprite(backdrop.art).alpha(0.55).appendTo($.ui);
            }

            $('<ui.label>', { id: 'title', text: 'Russiano2D', size: 46, color: '#e8f0ff' })
                .at(80, 60).appendTo($.ui);
            $('<ui.label>', { id: 'subtitle', size: 18, color: '#8fa3bf',
                              text: 'выбери демо · Esc внутри демо возвращает сюда' })
                .at(84, 104).appendTo($.ui);

            names.forEach((name, i) => {
                const info = TITLES[name] || { title: name, icon: 'play_arrow', hint: '' };
                const col = i % 2;
                const row = Math.floor(i / 2);
                const x = 80 + col * 380;
                const y = 170 + row * 100;

                const button = $('<ui.button>', {
                    id: 'btn-' + name,
                    text: `${icon(info.icon)}  ${info.title}`,
                    size: 22,
                }).at(x + 165, y + 30).size(330, 62).appendTo($.ui);

                $('<ui.label>', { id: 'hint-' + name, size: 14, color: '#7d8fa8', text: info.hint })
                    .at(x + 8, y + 70).appendTo($.ui);

                button.on('click', () => {
                    $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.4 });
                    $.scene.load(name);
                });
            });

            $('<ui.label>', { id: 'keys', size: 15, color: '#63758d',
                              text: 'A/D или ←/→ — идти · Space/W/↑ — прыжок · мышь — стрельба · F1 — оверлей' })
                .at(84, 668).appendTo($.ui);

            $.world.color('#0e1420');
            $.sound.music('demos/assets/audio/music/menu.ogg', { loop: true, volume: 0.35 });
        },

        exit() {
            $.sound.stopMusic(400);
        },

        update(dt, $) {
            if ($.input.pressed('escape')) $.quit();
        },
    });
}
