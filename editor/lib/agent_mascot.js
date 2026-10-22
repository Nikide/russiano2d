// Маскот «Руси-чан» рядом с чатом агента: живёт своей жизнью и показывает, что делает агент.
// Модуль чистый (без движка и RmlUi): состояние → кадр атласа editor/ui/mascot.png и реплика.
// Кадры режет tools/mascot_slice.py из assets/mascot/sheet_v2.png; имя r<строка>_<кадр> (r4_3 — 5-я строка, 4-й кадр),
// в RmlUi это класс .mc-r4-3. Строки листа: 0 стоит лицом/поворот/спиной, 1 ходьба, 2 бег (r2_14 — «!»),
// 3 покачивание, ноутбук (r3_7), лампочка (r3_9, r3_16), коробка (r3_9, r3_10), присела; 4 эмоции: сердце (r4_3),
// ноты (r4_5, r4_6), световые мечи (r4_7, r4_8, r4_10, r4_11), взрыв (r4_14), искры (r4_16); 5 ключ (r5_3), ноты,
// «?» (r5_11), ноутбук на полу (r5_15); 6 «?» (r6_8, r6_9), капля пота (r6_10), планшет (r6_13); 7 «!» (r7_0), ноты,
// мечи, коробка (r7_15, r7_16); 8 летающая тарелка (r8_18); 9 розовый «?» (r9_0), серая тень (r9_7…r9_12), вихрь
// (r9_14), спит на подушке (r9_15); 10 значки: хвост, головы, череп, «?», «!», сердце, искры, нота, карандаш, лампочка,
// ключ, ноутбук, коробка, арбуз, чашка.

const IDLE = ['r0_0', 'r0_1', 'r0_2', 'r0_3', 'r0_4'];

// Инструмент → [кадры, fps, реплика].
const BY_TOOL = {
    search: [['r5_11', 'r6_8', 'r6_9'], 2, 'Ищу…'],
    read: [['r6_13', 'r3_10', 'r6_13'], 2, 'Читаю файлы…'],
    write: [['r3_7', 'r5_15', 'r3_7', 'r5_15'], 3.5, 'Пишу код…'],
    check: [['r5_3', 'r5_4'], 2.5, 'Проверяю…'],
    snippet: [['r3_9', 'r3_16'], 2.5, 'Подключаю кирпичик…'],
    studio: [['r3_7', 'r5_15', 'r6_13'], 3, 'Работаю в студии…'],
};
const TOOL_KIND = {
    docs_search: 'search', docs_show: 'search', api_lookup: 'search', snippet_find: 'search', search_project: 'search',
    list_files: 'read', read_file: 'read', project_info: 'read', tabs: 'read', studio_state: 'read', studio_ops: 'read',
    write_file: 'write', edit_file: 'write', delete_file: 'write', move_file: 'write', undo_edit: 'write', plan: 'write', pixel_art: 'write', generate_sound: 'write', skill_load: 'search', skill_list: 'search', pixel_preview: 'read',
    r2d_validate: 'check', r2d_lint: 'check', run_check: 'check', screenshot_check: 'check', playtest: 'check', r2d_cli: 'check',
    snippet_apply: 'snippet',
    open_tab: 'studio', studio_edit: 'studio', studio_op: 'studio', studio_save: 'studio', editor_op: 'studio',
};
const POKES = [
    [['r4_12', 'r4_13', 'r4_3'], 'Мяу!'], [['r4_3', 'r4_3', 'r4_5'], 'Ня~ ♥'], [['r8_18', 'r9_14'], 'Меня похищают! Шучу…'],
    [['r4_7', 'r4_8'], 'Давай соберём что-нибудь крутое!'], [['r6_10', 'r2_14'], 'Не отвлекай, я думаю…'],
];

export const mascotFrames = () => ({ idle: IDLE, tools: BY_TOOL, pokes: POKES });

export function createMascot() {
    const m = {
        mode: 'idle', frames: IDLE, fps: 1.4, bubble: '', t: 0, i: 0, quiet: 0, hold: 0, pokeIdx: 0, sleeping: false,
    };

    function enter(mode, frames, fps, bubble, hold) {
        m.mode = mode; m.frames = frames; m.fps = fps; m.bubble = bubble || ''; m.i = 0; m.t = 0; m.hold = hold || 0; m.quiet = 0; m.sleeping = false;
    }

    function backToIdle() { enter('idle', IDLE, 1.4, '', 0); }

    return {
        get state() { return { mode: m.mode, frame: m.frames[m.i % m.frames.length], bubble: m.bubble, sleeping: m.sleeping }; },
        // Агент начал думать (запрос к модели).
        thinking() { enter('thinking', ['r6_8', 'r6_9'], 1.6, 'Думаю…'); },
        // Агент вызвал инструмент.
        tool(name) {
            const spec = BY_TOOL[TOOL_KIND[name] || 'check'];
            enter('tool:' + (TOOL_KIND[name] || 'check'), spec[0], spec[1], spec[2]);
        },
        // Нужно подтверждение пользователя.
        waiting() { enter('waiting', ['r5_11', 'r6_9'], 1.2, 'Можно? Нужно твоё подтверждение'); },
        // Агент задаёт вопрос пользователю.
        asking() { enter('waiting', ['r5_11', 'r6_9'], 1.2, 'Хочу кое-что уточнить…'); },
        // Ответ модели (текст): болтаем.
        talk() { enter('talk', ['r4_12', 'r4_13', 'r4_12', 'r0_0'], 2.5, ''); },
        success() { enter('success', ['r4_5', 'r4_3', 'r4_16'], 2, 'Готово!', 4.5); },
        failure(text) { enter('failure', ['r6_10', 'r2_14', 'r9_0'], 1.5, text || 'Что-то пошло не так…', 5); },
        // Клик по персонажу.
        poke() {
            const p = POKES[m.pokeIdx++ % POKES.length];
            enter('poke', p[0], 3, p[1], 2.6);
        },
        // dt в секундах; вернуть true, если кадр или реплика изменились.
        tick(dt, busy) {
            const before = m.frames[m.i % m.frames.length] + '|' + m.bubble;
            m.t += dt;
            const step = 1 / m.fps;
            while (m.t >= step) { m.t -= step; m.i++; }
            if (m.hold > 0) { m.hold -= dt; if (m.hold <= 0) backToIdle(); }
            else if (m.mode === 'idle') {
                m.quiet += dt;
                if (m.quiet > 45 && !m.sleeping) { m.sleeping = true; m.frames = ['r9_15']; m.i = 0; m.bubble = 'zZz…'; m.fps = 0.5; }
            } else if (!busy && (m.mode === 'thinking' || m.mode.startsWith('tool:') || m.mode === 'talk' || m.mode === 'waiting')) {
                backToIdle();
            }
            return before !== m.frames[m.i % m.frames.length] + '|' + m.bubble;
        },
        // Любое действие пользователя будит.
        wake() { if (m.sleeping) backToIdle(); m.quiet = 0; },
    };
}
