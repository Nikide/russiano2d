// ===========================================================================
// Кампания платформера: меню, три уровня, победа и прогресс.
//
// Точка входа игры — game/main.js. Здесь живёт ровно то, что общее для всех
// уровней: порядок сцен, HUD, пауза, переходы и сохранение прогресса. Сам
// уровень (сборка мира, монеты, шипы, ворота) — game/level.js, его данные —
// game/levels.js. Поэтому новый уровень = одна запись в LEVELS, а не правка
// логики (docs/PHILOSOPHY.md §1: игра — это код и данные).
//
// Прогресс: $.store.file('save.json') — какие уровни пройдены, лучшее время и
// лучший результат. Файл читается на старте и пишется после каждого уровня.
// ===========================================================================

import { makeLevel } from './level.js';
import { LEVELS } from './levels.js';

const SAVE = 'save.json';

//: Состояние каждого построенного уровня по имени сцены. Нужно HUD/агенту,
//: чтобы читать мир уровня, не заглядывая внутрь замыкания сцены.
const liveLevels = new Map();

/** Прогресс игрока. Читается/пишется через $.store, структура — данные. */
function loadProgress($) {
    const best = {};
    const raw = $.store.get('levels', {});
    for (const level of LEVELS) {
        const entry = raw && typeof raw === 'object' ? raw[level.id] : null;
        best[level.id] = {
            done: !!(entry && entry.done),
            coins: (entry && Number(entry.coins)) || 0,
            time: (entry && Number(entry.time)) || 0,
        };
    }
    return best;
}

function saveProgress($, progress) {
    $.store.set('levels', progress);
    $.store.save();
}

/** Сцена уровня: строит уровень, рисует HUD, ведёт паузу и переходы. */
/**
 * Зарегистрировать сцену уровня.
 *
 * `sceneName` обычно равен `spec.id`, но у первого уровня есть второе имя —
 * `platformer`: под ним сцену запускают внешние инструменты и тесты
 * (`tools/agent_client.py`, `tools/make_screenshots.py`, `highlevel_perf_test`),
 * и ломать их переименованием незачем. Это тот же уровень и та же логика,
 * просто вторая запись в реестре сцен.
 */
function addLevelScene($, spec, index, progress, sceneName) {
    const level = makeLevel(spec);
    const isLast = index === LEVELS.length - 1;
    let overlay = null;

    function hud($) {
        const state = level.state;
        // Панель накрывает все четыре строки: без неё тёмный текст терялся на
        // светлом небе первого уровня (проверено скриншотом).
        $('<ui.panel>', { id: 'hud-bg' }).at(170, 56).size(320, 112)
            .color('#0d1220bb').appendTo($.ui);
        $('<ui.label>', { id: 'hud-hp', size: 18, color: '#e8f0ff' }).at(28, 18).appendTo($.ui);
        $('<ui.label>', { id: 'hud-coins', size: 18, color: '#ffd54a' }).at(28, 42).appendTo($.ui);
        $('<ui.label>', { id: 'hud-level', size: 17, color: '#cfe0f5' })
            .at(28, 68).appendTo($.ui);
        $('<ui.label>', { id: 'hud-time', size: 17, color: '#cfe0f5' })
            .at(28, 90).appendTo($.ui);

        overlay = $('<ui.panel>', { id: 'overlay' }).at(640, 360).size(1280, 720)
            .color('#000000cc').appendTo($.ui).hide();
        $('<ui.label>', { id: 'overlay-title', size: 42, color: '#ffffff' })
            .at(640, 320).appendTo($.ui).hide();
        $('<ui.label>', { id: 'overlay-hint', size: 20, color: '#9fb3cc' })
            .at(640, 384).appendTo($.ui).hide();
    }

    function showOverlay($, title, hint) {
        $('#overlay').show();
        $('#overlay-title').show().text(title);
        $('#overlay-hint').show().text(hint);
    }

    function hideOverlay($) {
        $('#overlay').hide();
        $('#overlay-title').hide();
        $('#overlay-hint').hide();
    }

    function finish($, state) {
        const entry = progress[spec.id];
        entry.done = true;
        entry.coins = Math.max(entry.coins, state.coins);
        // Лучшее время — меньшее из ненулевых: 0 значит «ещё не проходили».
        entry.time = entry.time > 0 ? Math.min(entry.time, state.time) : state.time;
        saveProgress($, progress);
    }

    $.scene.add(sceneName || spec.id, {
        enter($) {
            this.paused = false;
            this.result = null;
            level.build($);
            hud($);
            $.world.gravity(0, level.spec.gravity === undefined ? 1800 : level.spec.gravity)
                .color(level.spec.sky || '#101820');
            $.sound.music('assets/audio/music/action.ogg', { loop: true, volume: 0.22 });
            $.time.resume();
        },

        exit($) {
            $.sound.stopMusic(300);
            hideOverlay($);
        },

        update(dt, $) {
            const state = level.state;
            const hero = $('#hero');

            // Пауза: Esc ставит и снимает. На паузе физика и логика мира стоят
            // ($.time.pause() останавливает и шаг Box2D), поэтому update уровня
            // не вызывается — иначе мир ехал бы под экраном паузы.
            if ($.input.pressed('escape') && !state.done) {
                this.paused = !this.paused;
                if (this.paused) {
                    $.time.pause();
                    showOverlay($, 'Пауза', 'Esc — продолжить, Enter — в меню');
                } else {
                    $.time.resume();
                    hideOverlay($);
                }
            }
            if (this.paused) {
                if ($.input.pressed('enter')) { $.time.resume(); $.scene.load('menu'); }
                return;
            }

            // HUD: здоровье, монеты, номер уровня, время.
            const hp = Math.max(0, Math.round(hero.hp()));
            $('#hud-hp').text(`Здоровье: ${hp}`);
            $('#hud-coins').text(`Монеты: ${state.coins} / ${state.goal}`);
            $('#hud-level').text(`Уровень ${index + 1}: ${spec.title || spec.id}`);
            $('#hud-time').text(`Время: ${state.time.toFixed(1)} с`);

            level.update(dt, $);

            if (state.done && !this.result) {
                this.result = 'win';
                finish($, state);
                const next = LEVELS[index + 1];
                showOverlay($, isLast ? 'Кампания пройдена!' : 'Уровень пройден',
                            isLast ? 'Enter — в меню' : 'Enter — дальше, Esc — в меню');
                $.vfx.flash('#ffffff', { ms: 220, alpha: 0.5 });
            } else if (hero.length && hero.hp() <= 0 && !this.result) {
                this.result = 'dead';
                showOverlay($, 'Вы проиграли', 'Enter — заново, Esc — в меню');
                $.vfx.flash('#ff3b30', { ms: 260, alpha: 0.4 });
            }

            if (this.result === 'win' && $.input.pressed('enter')) {
                if (isLast) $.scene.load('menu');
                else $.scene.load(LEVELS[index + 1].id);
            } else if (this.result && $.input.pressed('enter')) {
                $.scene.load(sceneName || spec.id);   // перезапуск того же уровня
            } else if (this.result && $.input.pressed('escape')) {
                $.scene.load('menu');
            }
        },
    });

    return level;
}

/** Меню: RmlUi-документ ui/menu.rml + быстрые клавиши. */
function addMenuScene($, progress) {
    $.scene.add('menu', {
        enter($) {
            // Слушатели вешаются один раз: $.ui.doc() кэширует обёртку по пути,
            // и повторное .on() на возврате в меню дало бы двойной клик.
            this.doc = $.ui.doc('ui/menu.rml')
                .on('btn-play', 'click', () => $.scene.load(firstUnfinished(progress).id))
                .on('btn-quit', 'click', () => $.quit())
                .show();
            this.doc.text('subtitle', summary(progress));
            this.doc.text('hint', 'Enter — играть, Esc — выход');
        },

        exit() { if (this.doc) this.doc.hide(); },

        update(dt, $) {
            // Меню обязано работать и без мыши.
            if ($.input.pressed('enter') || $.input.pressed('space')) {
                $.scene.load(firstUnfinished(progress).id);
            }
            if ($.input.pressed('escape')) $.quit();
        },
    });
}

/** Первый непройденный уровень — «продолжить»; если все пройдены, первый. */
function firstUnfinished(progress) {
    return LEVELS.find((level) => !progress[level.id].done) || LEVELS[0];
}

function summary(progress) {
    const done = LEVELS.filter((l) => progress[l.id].done).length;
    return `Пройдено уровней: ${done} из ${LEVELS.length}`;
}

/** Регистрирует всю кампанию в `$`. Вызывается из game/main.js. */
export function installCampaign($) {
    $.store.file(SAVE).load();
    const progress = loadProgress($);

    addMenuScene($, progress);
    LEVELS.forEach((spec, index) => {
        const level = addLevelScene($, spec, index, progress);
        // Состояние уровня нужно снаружи — HUD кампании и агентский снимок
        // читают его по имени сцены (в том числе по псевдониму 'platformer').
        liveLevels.set(spec.id, level);
        if (index === 0) liveLevels.set('platformer', addLevelScene($, spec, index, progress, 'platformer'));
    });

    // Горячие клавиши отладки: F3 — перезапуск уровня, F4 — пропустить уровень.
    // Оставлены только в отладочных целях: они не мешают игре и видны агенту.
    $.update((dt, $ref) => {
        if ($.input.pressed('f3')) {
            const current = $.scene.current();
            if (LEVELS.some((l) => l.id === current)) $.scene.load(current);
        }
    });

    // Состояние кампании для агента: уровни, прогресс и — что важно тестам —
    // взят ли чекпойнт на текущем уровне (по нему проверяется возрождение).
    $.agent.expose('campaign', () => ({
        levels: LEVELS.map((l) => l.id),
        progress,
        scene: $.scene.current(),
        checkpoint: currentLevelState() ? currentLevelState().checkpointTaken : false,
    }));

    function currentLevelState() {
        const name = $.scene.current();
        const entry = liveLevels.get(name);
        return entry ? entry.state : null;
    }
}

export { LEVELS };