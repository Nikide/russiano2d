// Маскот «Руси-чан» рядом с чатом агента: живёт своей жизнью и показывает, что делает агент.
// Модуль чистый (без движка и RmlUi): состояние → кадр атласа editor/ui/mascot.png и реплика.
// Кадры (tools/mascot_slice.py, сетка 8x8): idle_0..7 стоит, walk/run/crab — движение, act — работа
// (act_0/1/5/6/7 ноутбук, act_2 ключ, act_3 ноутбук и «?», act_4 коробка), emo — эмоции (emo_0 радость,
// emo_2 «!», emo_3 «?», emo_4 недовольна, emo_5 спит, emo_6 сердечки, emo_7 грустит), fx — идея (fx_2),
// карта (fx_3), галочка (fx_4), предупреждение (fx_5), сон на ноутбуке (fx_6), праздник (fx_7), misc — разное.

const IDLE = ['idle_0', 'idle_1', 'idle_2', 'idle_3', 'idle_4', 'idle_5', 'idle_6', 'idle_7'];

// Инструмент → [кадры, fps, реплика].
const BY_TOOL = {
    search: [['fx_3', 'fx_3', 'fx_2'], 2, 'Ищу…'],
    read: [['misc_6', 'act_4'], 2, 'Читаю файлы…'],
    write: [['act_0', 'act_1', 'act_5', 'act_6'], 3.5, 'Пишу код…'],
    check: [['act_2', 'fx_1'], 2.5, 'Проверяю…'],
    snippet: [['fx_2', 'fx_0'], 2.5, 'Подключаю кирпичик…'],
    studio: [['act_7', 'act_6', 'act_1'], 3, 'Работаю в студии…'],
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
    [['emo_0', 'emo_0', 'misc_2'], 'Мяу!'], [['emo_6', 'emo_6', 'emo_0'], 'Ня~ ♥'], [['misc_7', 'emo_0'], 'Смотри, что у меня есть!'],
    [['fx_7', 'emo_0'], 'Давай соберём что-нибудь крутое!'], [['emo_1', 'emo_4'], 'Не отвлекай, я думаю…'],
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
        thinking() { enter('thinking', ['act_3', 'emo_3'], 1.6, 'Думаю…'); },
        // Агент вызвал инструмент.
        tool(name) {
            const spec = BY_TOOL[TOOL_KIND[name] || 'check'];
            enter('tool:' + (TOOL_KIND[name] || 'check'), spec[0], spec[1], spec[2]);
        },
        // Нужно подтверждение пользователя.
        waiting() { enter('waiting', ['emo_3', 'emo_2'], 1.2, 'Можно? Нужно твоё подтверждение'); },
        // Агент задаёт вопрос пользователю.
        asking() { enter('waiting', ['emo_3', 'emo_2'], 1.2, 'Хочу кое-что уточнить…'); },
        // Ответ модели (текст): болтаем.
        talk() { enter('talk', ['emo_0', 'misc_2', 'emo_0', 'idle_0'], 2.5, ''); },
        success() { enter('success', ['fx_4', 'emo_6', 'fx_7'], 2, 'Готово!', 4.5); },
        failure(text) { enter('failure', ['fx_5', 'emo_7', 'emo_4'], 1.5, text || 'Что-то пошло не так…', 5); },
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
                if (m.quiet > 45 && !m.sleeping) { m.sleeping = true; m.frames = ['fx_6']; m.i = 0; m.bubble = 'zZz…'; m.fps = 0.5; }
            } else if (!busy && (m.mode === 'thinking' || m.mode.startsWith('tool:') || m.mode === 'talk' || m.mode === 'waiting')) {
                backToIdle();
            }
            return before !== m.frames[m.i % m.frames.length] + '|' + m.bubble;
        },
        // Любое действие пользователя будит.
        wake() { if (m.sleeping) backToIdle(); m.quiet = 0; },
    };
}
