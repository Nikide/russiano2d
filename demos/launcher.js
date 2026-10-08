// ===========================================================================
// Меню-лаунчер демо.
//
// Интерфейс — документ RmlUi (demos/ui/launcher.rml + launcher.rcss): меню и
// экраны в движке делаются только так (docs/UI_RMLUI_LAW.md). Список демо
// строится из DEMOS и вставляется в #demo-list разметкой RML.
//
// Вёрстка адаптивная: сцена всегда 16:9 (см. #stage в web/shell.html), поэтому
// размеры в RCSS заданы в vh — интерфейс масштабируется пропорционально любому
// размеру окна, а карточки перестраиваются flex-wrap'ом.
//
// Платформер из меню убран (решение проекта): сам демо-модуль остаётся в
// репозитории и запускается как раньше:
//   ./build/russiano2d --game demos --scene platformer
// ===========================================================================

const DOC = 'demos/ui/launcher.rml';
// Фон меню — арт лаунчера (в .rml), музыка — отдельным файлом: движок играет её
// циклом, пока открыто меню, и глушит при переходе в демо.
// Формат — MP3: в сборке движка MP3 включён (dr_mp3), а OGG-энкодер, который
// оказался под рукой, писал битую длительность (движок видел 9039 с вместо 188).
const MENU_MUSIC = 'demos/assets/audio/music/lobby_groove.mp3';
const CLICK_SFX = 'demos/assets/audio/sfx/ui_click.ogg';

const DEMOS = [
    {
        scene: 'shooter_witch',
        // В меню ведём в интро демо; сам бой остаётся сценой для тестов и
        // агента: --scene shooter_witch.
        enter: 'witch_menu',
        icon: 'auto_awesome',
        title: 'Типичная ночь в Мытищинском лесу',
        hint: 'Ночной лес, свет от фонарей, волны врагов',
    },
    {
        scene: 'russi_vn',
        icon: 'favorite',
        title: 'Руси-тян (ВН)',
        hint: 'Визуальная новелла: озвучка, выбор и две концовки',
    },
    {
        scene: 're2d_world',
        icon: 'view_in_ar',
        title: 'Re2D · мир-коробка',
        hint: 'Комната от первого лица, мышь крутит взгляд, добрые маскоты',
    },
    {
        scene: 're2dsprite',
        icon: '360',
        title: 'Re2DSprite · Руси-тян',
        hint: 'Развёртка, анимации и предметы с сокетами',
    },
];

export default function installLauncher($) {
    // Разметку и подписки делаем один раз: документ RmlUi кэшируется по пути,
    // а $.ui.doc(...).on() не вешает обработчик дважды на ту же пару.
    let built = false;

    function volume() {
        const v = Number($.store.get('volume', 0.8));
        return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
    }

    function applyVolume($, value) {
        const v = Math.max(0, Math.min(1, value));
        $.store.set('volume', v);
        $.sound.volume(v).mute(false);
        return v;
    }

    function showVolume(doc) {
        doc.text('vol-value', Math.round(volume() * 100) + '%');
    }

    function build($, doc) {
        const icon = (name) => ($.ui.hasIcon(name) ? $.ui.icon(name) : '');

        // Карточка демо: иконка, название, подпись. Разметка — RML, классы
        // совпадают с launcher.rcss.
        doc.html('demo-list', DEMOS.map((demo, i) => `
            <div class="demo" id="demo-${i}">
                <span class="ico">${icon(demo.icon)}</span>
                <span class="t">${demo.title}</span>
                <span class="s">${demo.hint}</span>
            </div>`).join(''));

        DEMOS.forEach((demo, i) => {
            doc.on(`demo-${i}`, 'click', () => {
                $.sound.play(CLICK_SFX, { volume: 0.4 });
                $.scene.load(demo.enter || demo.scene);
            });
            doc.on(`demo-${i}`, 'mouseover', () => doc.text('selected', demo.title));
        });

        // Иконки Material Design подставляем из JS: глифы живут во встроенном
        // шрифте, в .rml их не вписать.
        doc.html('vol-down', icon('volume_down'));
        doc.html('vol-up', icon('volume_up'));
        doc.html('vol-mute', icon('volume_off'));
        doc.on('vol-down', 'click', () => { applyVolume($, volume() - 0.1); showVolume(doc); });
        doc.on('vol-up', 'click', () => { applyVolume($, volume() + 0.1); showVolume(doc); });
        doc.on('vol-mute', 'click', () => {
            const muted = !$.store.get('muted', false);
            $.store.set('muted', muted);
            $.sound.mute(muted);
        });
    }

    $.scene.add('launcher', {
        enter($) {
            const doc = $.ui.doc(DOC);
            if (!doc || doc.id < 0) {
                $.log('лаунчер: не удалось загрузить ' + DOC);
                return;
            }
            if (!built) {
                built = true;
                build($, doc);
                applyVolume($, volume());
            }
            showVolume(doc);
            doc.text('selected', DEMOS[0].title);
            doc.show();

            $.world.color('#0e1420');
            $.sound.music(MENU_MUSIC, { loop: true, volume: 0.35 });
        },

        exit() {
            const doc = $.ui.doc(DOC);
            if (doc) doc.hide();
            $.sound.stopMusic(400);
        },

        update(dt, $) {
            if ($.input.pressed('escape')) $.quit();
        },
    });
}
