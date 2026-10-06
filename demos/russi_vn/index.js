// ===========================================================================
// Демо «Руси-тян: Бака!» — визуальная новелла на $.timeline
// (AnimatedTimelineScene2d).
//
// Сюжет: ты открыл движок Russiano2D, а внутри тебя уже ждёт Руси-тян —
// цундэрэ-маскот движка. Она объясняет, почему JavaScript прекрасен, а Python
// ужасен, показывает философию движка и в конце спрашивает, понравилось ли
// тебе. От ответа зависит, влюбится она в тебя или назовёт бака.
//
// Что показывает демо:
//   * `$.timeline` — новая функция высокоуровневого API: сцена-таймлайн из
//     «битов» (локация, поза, реплика, выбор, тряска, вспышка) с метками,
//     ветвлением и концовками;
//   * семь поз героини, дыхание, входы/выходы и акценты (`bounce`, `tremble`,
//     `sigh`, …) — всё из присланных картинок, без скелетной анимации;
//   * тряска экрана через камеру, вспышки и затемнения, смена четырёх локаций
//     с перекрёстным затуханием;
//   * выборы с флагами (`trust`) и две концовки, которые запоминаются в
//     `$.store` и переживают перезапуск;
//   * HUD: «руси-метр», подсказки управления, авто-режим и быстрый пропуск.
//
// Запуск:
//   ./build/russiano2d --game demos --scene russi_vn
//   ./build/russiano2d --game demos            # кнопка «Руси-тян (ВН)»
//
// Свою новеллу на этом модуле собрать просто: см. README.md рядом с этим
// файлом — там разбор всех битов и рецепт «своя ВН за десять минут».
// ===========================================================================

const ART = 'demos/assets/art/vn';
const SFX_DIR = 'demos/assets/audio/sfx';
const MUSIC_DIR = 'demos/assets/audio/music';

export default function install($) {
    // --- Ресурсы -----------------------------------------------------------
    // Расширения у свободных ассетов разные (.ogg/.mp3/.wav), а имена файлов
    // задаёт CREDITS демо-проекта. Поэтому путь не угадывается, а выбирается:
    // первый существующий вариант. Нет ни одного — движок просто промолчит,
    // новелла не сломается.
    const exists = (path) => {
        try { return $.fs.exists(path); } catch (e) { return false; }
    };
    const pick = (...paths) => {
        for (const path of paths) if (path && exists(path)) return path;
        return null;
    };
    const voice = (name, ext) => pick(...ext.map((e) => `${SFX_DIR}/${name}.${e}`));
    const tune = (name, ext) => pick(...ext.map((e) => `${MUSIC_DIR}/${name}.${e}`));

    const sfx = {
        page: voice('vn_page', ['ogg', 'wav', 'mp3']) || `${SFX_DIR}/ui_click.ogg`,
        heart: voice('vn_heart', ['ogg', 'wav', 'mp3']) || `${SFX_DIR}/pickup_01.ogg`,
        glitch: voice('vn_glitch', ['ogg', 'wav', 'mp3']) || `${SFX_DIR}/enemy_hit.ogg`,
        whoosh: voice('vn_whoosh', ['ogg', 'wav', 'mp3']) || `${SFX_DIR}/jump_01.ogg`,
        impact: voice('vn_impact', ['ogg', 'wav', 'mp3']) || `${SFX_DIR}/explosion_01.ogg`,
        click: `${SFX_DIR}/ui_click.ogg`,
    };

    // Музыка: свои треки проекта (присланные автором), а если их нет — CC0-набор
    // демо-проекта. Пути не угадываются, а выбираются: расширения у всех разные.
    const music = {
        tension: tune('vn_tension', ['mp3', 'ogg', 'wav']) || `${MUSIC_DIR}/menu.ogg`,
        afternoon: tune('vn_afternoon', ['mp3', 'ogg', 'wav']) || `${MUSIC_DIR}/action.ogg`,
        romance: tune('vn_romance', ['ogg', 'mp3', 'wav']) || `${MUSIC_DIR}/menu_whimsy.mp3`,
    };

    const poses = {
        neutral: `${ART}/russi/russi_neutral.png`,
        happy: `${ART}/russi/russi_happy.png`,
        blush: `${ART}/russi/russi_blush.png`,
        shy: `${ART}/russi/russi_shy.png`,
        angry: `${ART}/russi/russi_angry.png`,
        jealous: `${ART}/russi/russi_jealous.png`,
        caring: `${ART}/russi/russi_caring.png`,
    };

    const bg = (name) => pick(`${ART}/bg/${name}.png`, `${ART}/bg/${name}.jpg`);

    const locations = {
        room: {
            title: 'Комната · 03:07',
            bg: bg('bedroom_night'),
            music: music.tension,
            volume: 0.42,
            mood: { color: '#12224f', alpha: 0.26 },
        },
        class: {
            title: 'Аудитория «JS 101»',
            bg: bg('classroom_day'),
            music: music.afternoon,
            volume: 0.5,
            mood: { color: '#2b3f6b', alpha: 0.08 },
        },
        roof: {
            title: 'Крыша · закат',
            bg: bg('rooftop_sunset'),
            music: music.afternoon,
            volume: 0.48,
            mood: { color: '#ff8a4c', alpha: 0.14 },
        },
        street: {
            title: 'Ночная улица',
            bg: bg('city_night'),
            music: music.tension,
            volume: 0.45,
            mood: { color: '#0d1738', alpha: 0.28 },
        },
        yard: {
            title: 'Школьный двор',
            bg: bg('schoolyard_day'),
            music: music.afternoon,
            volume: 0.55,
        },
    };

    // --- Оформление ---------------------------------------------------------
    // Стиль текста объявляется до новеллы: реплики ссылаются на него по имени.
    $.font.define('vn_line', { size: 26, color: '#eef3ff', lineHeight: 1.28, align: 'left' });

    // --- Новелла -----------------------------------------------------------
    // Одна героиня — Руси-тян. `cast` оставлен таблицей: модуль умеет и
    // нескольких персонажей, но в этом демо он один, как и просили.
    $.animatedTimelineScene2d({
        id: 'russi_vn',
        title: 'Руси-тян: Бака!',
        scene: 'russi_vn',
        exitScene: 'launcher',
        backdrop: '#05070f',
        speed: 55,
        style: 'vn_line',
        // Реплику, выборы и HUD рисует RmlUi: перенос строк, шрифт, рамка и
        // подсветка кнопок — его работа, а $.dialog остаётся мозгом (печатная
        // машинка, выборы, клавиатура). Разметка — demos/ui/vn-dialog.rml.
        dialogView: { kind: 'rml', doc: 'demos/ui/vn-dialog.rml' },
        voice: { dir: 'demos/russi_vn/voice', ext: 'mp3', volume: 1 },
        locationCard: false,          // табличку локации рисует vn-hud.rml
        dialogTheme: {
            panel: '#0b1220d0',
            speaker: '#ffb3d9',
            speakerSize: 26,
            height: 150,          // минимальная высота панели; ниже текст растит её сам
            choiceTextSize: 22,
            text: '#eef3ff',
            choice: '#1b2436f0',
            choiceHover: '#3b4a72f0',
            choiceText: '#e8f0ff',
        },
        location: 'room',
        enter: enterVn,
        exit: exitVn,
        update: updateVn,
        locations,
        cast: {
            russi: {
                name: 'Руси-тян',
                poses,
                pose: 'neutral',
                x: 0.62,          // где стоит: доля ширины окна
                bottom: 1.02,     // низ спрайта чуть ниже кадра — как в новеллах
                height: 0.94,     // высота героини: доля высоты окна
                idle: true,       // дыхание
            },
        },
        script: [
            // --- Пролог: комната, ночь -------------------------------------
            { location: 'room' },
            { wait: 300 },
            { narrate: 'Ты открыл движок. Монитор мигнул — и в темноте комнаты кто-то шевельнул хвостом.' },
            { narrate: 'Кружка остыла. Курсор мигает. Где-то очень близко сопит что-то зелёное.' },
            { sfx: sfx.whoosh },
            { show: 'russi', from: 'bottom', ms: 800 },
            { pose: 'jealous' },
            { anim: 'step' },
            { say: 'Ты… ты чего уселся? Я тебя не звала. Вообще-то.' },
            { pose: 'neutral' },
            { say: 'Ладно. Раз уж открыл — знакомься. Это Russiano2D. Мой движок.' },
            { pose: 'happy', anim: 'bounce' },
            { say: 'А я — Руси-тян, его маскот. Да, я цундэрэ. Это не баг, это фича!' },
            { pose: 'neutral' },
            { say: 'И самое главное. Внутри — JavaScript. Не Python. JavaScript. Повтори.' },
            { say: 'Игровая логика — на JS, ядро — на C. Общение — через одну точку входа: $.' },

            { say: 'Ну? Что скажешь про мой язык?', pose: 'happy', choose: [
                { text: 'JS. Понял. Звучит красиво.', goto: 'praise', add: { trust: 2 } },
                { text: 'А почему не Python?', goto: 'python', add: { trust: -1 } },
                { text: 'Мне всё равно, я за Unity.', goto: 'unity', add: { trust: -2 } },
            ] },

            // --- Ветка «похвалил JS» ---------------------------------------
            { label: 'praise' },
            { pose: 'happy', anim: 'bounce' },
            { sfx: sfx.heart },
            { say: 'Хм! Ну… наконец-то кто-то с мозгами. Не то чтобы мне было важно твоё мнение!' },
            { pose: 'blush' },
            { flash: { color: '#ff9ec7', alpha: 0.30, ms: 260 } },
            { say: 'П-просто… приятно. Всё. Молчи. Идём дальше.' },
            { goto: 'lecture' },

            // --- Ветка «зачем не Python» ------------------------------------
            { label: 'python' },
            { anim: 'tremble' },
            { shake: 14, ms: 450 },
            { sfx: sfx.glitch },
            { flash: { color: '#ff5a5a', alpha: 0.45, ms: 300 } },
            { pose: 'angry' },
            { say: 'ПИТОН?! Ты… ты… БАКА!!!' },
            { shake: 18, ms: 500 },
            { say: 'Python — это язык, на котором аналитики считают таблички! А тут ДВИЖОК! C и JS! Понимаешь? ДВИЖОК!' },
            { narrate: 'В воздухе мигнула красная строка: TypeError: cannot read property «python» of undefined.' },
            { pose: 'jealous', anim: 'sigh' },
            { say: '…Ладно. Проехали. Но я запомнила. Я всё запоминаю, учти.' },
            { goto: 'lecture' },

            // --- Ветка «я за Unity» -----------------------------------------
            { label: 'unity' },
            { pose: 'jealous' },
            { say: 'Unity. Понятно. Тогда зачем ты вообще здесь?' },
            { anim: 'tremble' },
            { shake: 9, ms: 380 },
            { pose: 'angry' },
            { sfx: sfx.impact },
            { say: 'У меня игра — это текст. Её можно читать, diff-ить и ревьюить. А у тебя что? Клики по сцене и молитва, чтобы .meta-файлы не разъехались!' },
            { anim: 'sigh' },
            { pose: 'shy' },
            { say: '…Прости. Я не хотела кричать. Просто мне правда важно, чтобы ты понял.' },
            { goto: 'lecture' },

            // --- Аудитория: как устроен $ -----------------------------------
            { label: 'lecture' },
            { fade: '#000000', ms: 420 },
            { wait: 260 },
            { location: 'class' },
            { sfx: sfx.whoosh },
            { fade: null, ms: 460 },
            { pose: 'neutral' },
            { say: 'Так. Смотри сюда. Одна точка входа. Всё — через $.' },
            { pose: 'happy' },
            { say: "$('<player>', { id: 'hero' }).at(100, 300).controls('wasd').appendTo($.world);" },
            { say: 'Читается как предложение! Как обычный текст, а не как вызов с десятком параметров.' },
            { pose: 'neutral' },
            { say: 'Почему так? Потому что $ всегда возвращает обёртку. Поэтому цепочки работают. Поэтому же поиск — как в CSS: $(«.enemy»).damage(10).' },
            { say: 'И да: низкоуровневый engine никуда не делся. $ построен поверх него, оба доступны одновременно.' },

            { say: 'Спрашивай. Один вопрос — и идём дальше.', pose: 'neutral', choose: [
                { text: 'А в чём философия движка?', goto: 'philosophy', add: { trust: 1 } },
                { text: 'А ИИ-агенты его умеют?', goto: 'agents', add: { trust: 1 } },
                { text: 'А где редактор уровней?', goto: 'editor' },
            ] },

            // --- Философия ---------------------------------------------------
            { label: 'philosophy' },
            { pose: 'caring' },
            { say: 'Философия простая: игра — это текст.' },
            { say: 'Уровень и логика описываются кодом и данными, а не кликами по сцене. Такой проект удобно читать, diff-ить, ревьюить и генерировать.' },
            { anim: 'lean' },
            { pose: 'happy' },
            { say: 'И редактора поэтому нет. И не нужен! Код — лучший редактор. Он не забудет сохранить сцену.' },
            { goto: 'roof' },

            // --- Агенты ------------------------------------------------------
            { label: 'agents' },
            { pose: 'happy', anim: 'bounce' },
            { say: 'Умеют! --agent: команды приходят JSON-строками в stdin, ответы уходят в stdout. Окно можно спрятать — рендер и скриншоты работают.' },
            { say: 'И движок сам о себе рассказывает: $.agent.expose(«score», …) — игра становится инструментом для программы, а не только для человека.' },
            { pose: 'blush' },
            { sfx: sfx.heart },
            { say: 'Представляешь? Даже агент может пройти эту новеллу. И выбрать неправильный ответ. И я его тоже назову бака.' },
            { goto: 'roof' },

            // --- Про редактор ------------------------------------------------
            { label: 'editor' },
            { pose: 'jealous' },
            { say: 'Редактора нет. И не нужен.' },
            { say: 'Уровень — это код. Его можно diff-ить. Попробуй сделать diff бинарной сцены. Попробуй. Я подожду.' },
            { anim: 'tremble' },
            { pose: 'angry' },
            { shake: 7, ms: 300 },
            { say: '…Всё, молчу. Идём, покажу закат. Там красиво. Не подумай чего.' },
            { goto: 'roof' },

            // --- Крыша: закат и чай ------------------------------------------
            { label: 'roof' },
            { fade: '#000000', ms: 400 },
            { wait: 240 },
            { location: 'roof' },
            { sfx: sfx.whoosh },
            { fade: null, ms: 520 },
            { pose: 'neutral' },
            { say: 'Здесь я иногда компилирую. Ну… то есть сижу. Просто сижу, ясно?' },

            // Тёплая ветка — тем, кто не ругал движок.
            { if: 'trust >= 2', then: [
                { pose: 'blush' },
                { anim: 'pop' },
                { sfx: sfx.heart },
                { say: 'И вообще. Ты, кажется, не самый ужасный человек. КАЖЕТСЯ. Не обольщайся.' },
                { pose: 'caring' },
                { say: 'Держи. Чай. Он не отравлен. Наверное.' },
                { narrate: 'Кружка тёплая. Руси-тян отворачивается, но кончик хвоста мелко дрожит.' },
                { anim: 'tremble' },
                { pose: 'jealous' },
                { say: 'Ч-что? Ничего я не дрожу! Это ветер! Ветер, ясно?!' },
            ], else: [
                { pose: 'shy' },
                { anim: 'sigh' },
                { say: 'Я, между прочим, старалась. Движок — это как… как торт. Только из C и JavaScript.' },
                { say: 'И если ты скажешь, что он плохой, я… я не расстроюсь. Я просто уйду компилировать. Навсегда.' },
            ] },

            { pose: 'neutral' },
            { anim: 'lean' },
            { say: 'Ладно. Хватит экскурсий. Один вопрос, и я отстану.' },

            // --- Ночная улица: последний вопрос ------------------------------
            { fade: '#000000', ms: 380 },
            { wait: 200 },
            { location: 'street' },
            { sfx: sfx.whoosh },
            { fade: null, ms: 480 },
            { pose: 'shy' },
            { say: 'Тебе понравился мой движок? Только честно.' },
            { pose: 'jealous' },
            { say: 'Мне не важно. Совсем не важно. Но если ты соврёшь — я узнаю. У меня есть $.agent.snapshot().' },

            { say: 'Итак? Я слушаю.', pose: 'shy', choose: [
                { text: 'Да. Он офигенный. Давай делать на нём игру вместе!', goto: 'love' },
                { text: 'Не моё. Python и Unity удобнее.', goto: 'hate' },
            ] },

            // --- Хорошая концовка --------------------------------------------
            { label: 'love' },
            { sfx: sfx.heart },
            { flash: { color: '#ffb3d9', alpha: 0.5, ms: 320 } },
            { shake: 5, ms: 260 },
            { pose: 'blush', anim: 'bounce' },
            { say: '…П-правда? Ты… ты серьёзно? Не шути так, я компилирую чувства без предупреждений!' },
            { pose: 'happy', anim: 'pop' },
            { say: 'Тогда ладно! Но у нас будет код-ревью. И ты будешь писать логику, а я — компилировать. И никаких print в моём коде!' },
            { pose: 'blush' },
            { anim: 'lean' },
            { say: 'И… и, может, вечером посмотрим на звёзды. Как партнёры по проекту. ТОЛЬКО по проекту!' },
            { narrate: 'Она протягивает руку. Хвост рисует в воздухе сердечко. Компилятор одобрительно молчит.' },
            { anim: 'step' },
            { say: 'Ну? Чего замер? Берём задачу в работу, бака. У нас теперь общий репозиторий.' },
            // Эпилог — пятая локация: утро после ночного разговора.
            { fade: '#000000', ms: 480 },
            { wait: 260 },
            { location: 'yard' },
            { sfx: sfx.whoosh },
            { fade: null, ms: 560 },
            { pose: 'happy', anim: 'bounce' },
            { say: 'Утро. Двор. Ты уже взял задачу в трекере, а я... я не ждала. Просто мимо проходила.' },
            { pose: 'blush' },
            { anim: 'lean' },
            { say: 'И да: код-ревью в девять. Не опаздывай, партнёр.' },
            { ending: {
                id: 'love',
                mood: 'good',
                title: 'Хорошая концовка: «Тимлид-цундэрэ»',
                subtitle: 'Руси-тян влюбилась',
                text: 'Ты сказал, что движок прекрасен — и Руси-тян поверила. Теперь у вас общий репозиторий, общий бэклог и очень строгое код-ревью.\nСовет: загляни в docs/tutorial-first-game.md — там первая игра на $ за пятнадцать минут.',
                hint: 'Space — сыграть заново · Esc — в меню демо',
            } },

            // --- Плохая концовка ---------------------------------------------
            { label: 'hate' },
            { pose: 'jealous' },
            { anim: 'tremble' },
            { shake: 12, ms: 420 },
            { sfx: sfx.glitch },
            { flash: { color: '#ff4444', alpha: 0.4, ms: 300 } },
            { pose: 'angry' },
            { say: '…Ясно. Бака.' },
            { say: 'Иди. Пиши свои скрипты. Я не расстроена. Я вообще не умею расстраиваться, у меня assert вместо слёз.' },
            { narrate: 'Она отворачивается. Хвост дёргается. Где-то в недрах движка падает assert.' },
            { pose: 'shy' },
            { anim: 'sigh' },
            { say: '…Если передумаешь — движок лежит в dist/. И документация. Она хорошая. Правда хорошая.' },
            { say: 'И новелла эта никуда не денется. Я буду ждать. Не то чтобы я жду!' },
            { ending: {
                id: 'hate',
                mood: 'bad',
                title: 'Плохая концовка: «Segfault в сердечке»',
                subtitle: 'Ты не понравился Руси',
                text: 'Ты выбрал другой инструмент — и Руси-тян ушла компилировать в одиночестве.\nНо движок-то остался: dist/, docs/HIGH_LEVEL_API.md и полсотни демо. Может, стоит дать ему второй шанс?',
                hint: 'Space — сыграть заново · Esc — в меню демо',
            } },
        ],
    });

    // --- HUD новеллы (RmlUi) -------------------------------------------------
    // Никаких узлов <ui.*>: руси-метр, «АВТО», табличка локации и подсказка
    // живут в demos/ui/vn-hud.rml, а игра только пишет в них значения.
    const HUD_DOC = 'demos/ui/vn-hud.rml';
    const hud = { doc: null, level: -1, place: null, fast: false, auto_backup: 0 };

    function buildHud() {
        hud.doc = $.ui.doc(HUD_DOC).show();
        hud.level = -1;
        hud.place = null;
        drawMeter();
    }

    /** «Руси-метр»: шкала от 0 до 5 по флагу trust. */
    function drawMeter() {
        if (!hud.doc) return;
        const trust = Number($.store.get('trust', 0)) || 0;
        const level = Math.max(0, Math.min(5, trust + 2));
        if (hud.level === level) return;
        hud.level = level;
        hud.doc.style('vn-meter-fill', 'width', Math.round((level / 5) * 100) + '%');
        hud.doc.style('vn-meter-fill', 'background-color',
                      level >= 4 ? '#ff8fc0' : (level <= 1 ? '#5b6480' : '#c98fb0'));
    }

    /** Табличка локации: показывается на входе и гаснет сама. */
    function showPlace(title) {
        if (!hud.doc || !title) return;
        hud.doc.text('vn-place', title);
        hud.doc.cls('vn-place', 'off', false);
        hud.place = title;
        $.time.after(2600, () => {
            if (hud.doc && hud.place === title) hud.doc.cls('vn-place', 'off', true);
        });
    }

    // --- Сцена --------------------------------------------------------------
    // Хуки сцены таймлайна (enter/exit/update) объявлены прямо в спеке —
    // отдельную сцену с тем же именем регистрировать нельзя, она затрёт
    // staging новеллы (фон, героиню и оверлеи).
    function enterVn() {
        buildHud();
        // У новеллы свой файл прогресса: флаги «руси-метра» и открытые концовки
        // не должны подмешиваться в сохранение основной игры (save.json).
        $.store.file('demos/vn_save.json').load();
        $.store.autoSave(15000);
    }

    function exitVn() {
        // Документы RmlUi снимаем целиком: при возврате в меню их быть не должно.
        if (hud.doc) { hud.doc.hide(); hud.doc.unload(); hud.doc = null; }
        const dialog = $.ui.doc('demos/ui/vn-dialog.rml');
        if (dialog) { dialog.hide(); dialog.unload(); }
        hud.level = -1;
        hud.place = null;
        hud.fast = false;
        $.store.save();
    }

    function updateVn(dt) {
        drawMeter();

        // Быстрый пропуск: держишь Ctrl — реплики летят. Авто-режим, включённый
        // клавишей A, не теряется: его состояние запоминается на время пропуска.
        const fast = $.input.down('ctrl');
        if (fast !== hud.fast) {
            hud.fast = fast;
            if (fast) {
                hud.auto_backup = $.timeline.auto();
                $.dialog.speed(400);
                $.timeline.auto(140);
            } else {
                $.dialog.speed(55);
                $.timeline.auto(hud.auto_backup || false);
            }
        }

        if ($.input.pressed('a')) {
            const on = $.timeline.auto() > 0;
            $.timeline.auto(on ? false : 1600);
            $.sound.play(sfx.click, { volume: 0.5 });
        }
        if ($.input.pressed('r')) $.timeline.play('russi_vn');

        if (hud.doc) hud.doc.cls('vn-auto', 'off', $.timeline.auto() <= 0);
        if ($.input.pressed('escape')) $.scene.load('launcher');
    }

    /** HUD чтения на финальной карточке лишний: прячем и возвращаем на старте. */
    function showHud(on) {
        if (!hud.doc) return;
        if (on) hud.doc.show(); else hud.doc.hide();
    }

    // --- Агент и тесты ------------------------------------------------------
    $.timeline.on('ending', (event) => {
        $.store.set('last_ending', event.id);
        $.store.save();
        showHud(false);
    });
    $.timeline.on('start', () => showHud(true));
    $.timeline.on('location', (event) => {
        $.sound.play(sfx.whoosh, { volume: 0.35 });
        showPlace(event.title || '');
    });

    $.agent.expose('vn_scene', () => $.timeline.current());
    $.agent.expose('vn_location', () => ($.timeline.state().location || ''));
    $.agent.expose('vn_trust', () => Number($.store.get('trust', 0)) || 0);
    $.agent.expose('vn_last_ending', () => $.store.get('last_ending', '') || '');
    $.agent.expose('vn_ending', () => $.timeline.state().ending || '');
    $.agent.expose('vn_waiting', () => $.timeline.state().waiting || '');
    $.agent.expose('vn_pose', () => {
        const actors = $.timeline.state().actors || [];
        return actors.length ? actors[0].pose : '';
    });
    $.agent.expose('vn_choices', () => $.timeline.choices().map((c) => c.text).join(' | '));
    $.agent.expose('vn_text', () => $.dialog.text());
    $.agent.expose('vn_visible', () => {
        const actors = $.timeline.state().actors || [];
        return actors.length ? !!actors[0].visible : false;
    });
}
