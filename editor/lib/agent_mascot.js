// Маскот «Руси-чан» рядом с чатом агента: живёт своей жизнью и показывает, что делает агент.
// Модуль чистый (без движка и RmlUi): состояние → кадр атласа editor/ui/mascot.png и реплика.
// Кадры (tools/mascot_slice.py): idle_0..8, walk_*, run_*, crab_*, act_0..7, emo_0..9, ico_*.
//   act_0/1 — ноутбук, act_2 — ключ, act_4 — коробка, act_5 — «?», act_6 — искры, act_7 — ноты;
//   emo_1 — радость, emo_5 — вопрос, emo_6 — злость, emo_7 — грусть, crab_7 — сердце.

const IDLE = ['idle_0', 'idle_1', 'idle_2', 'idle_3', 'idle_4', 'idle_5', 'idle_6', 'idle_7'];

// Инструмент → [кадры, fps, реплика].
const BY_TOOL = {
    search: [['act_5', 'act_6'], 2.5, 'Ищу…'],
    read: [['act_4', 'act_4', 'act_3'], 2, 'Читаю файлы…'],
    write: [['act_0', 'act_1'], 3.5, 'Пишу код…'],
    check: [['act_2', 'act_2', 'act_1'], 3, 'Проверяю…'],
    snippet: [['act_7', 'act_6'], 3, 'Подключаю кирпичик…'],
    studio: [['act_0', 'act_1', 'act_6'], 3, 'Работаю в студии…'],
};
const TOOL_KIND = {
    docs_search: 'search', docs_show: 'search', api_lookup: 'search', snippet_find: 'search',
    list_files: 'read', read_file: 'read', project_info: 'read', tabs: 'read', studio_state: 'read', studio_ops: 'read',
    write_file: 'write', edit_file: 'write',
    r2d_validate: 'check', r2d_lint: 'check', run_check: 'check', screenshot_check: 'check', r2d_cli: 'check',
    snippet_apply: 'snippet',
    open_tab: 'studio', studio_edit: 'studio', studio_op: 'studio', studio_save: 'studio', editor_op: 'studio',
};
const POKES = [
    [['emo_1', 'emo_1', 'emo_8'], 'Мяу!'], [['crab_7', 'crab_7', 'emo_0'], 'Ня~ ♥'], [['emo_2', 'emo_8'], 'Я тут, помогаю!'],
    [['emo_1', 'act_6'], 'Давай соберём что-нибудь крутое!'], [['emo_9', 'emo_3'], 'Не отвлекай, я думаю…'],
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
        thinking() { enter('thinking', ['act_5', 'emo_5'], 1.6, 'Думаю…'); },
        // Агент вызвал инструмент.
        tool(name) {
            const spec = BY_TOOL[TOOL_KIND[name] || 'check'];
            enter('tool:' + (TOOL_KIND[name] || 'check'), spec[0], spec[1], spec[2]);
        },
        // Нужно подтверждение пользователя.
        waiting() { enter('waiting', ['emo_5', 'emo_0'], 1.2, 'Можно? Нужно твоё подтверждение'); },
        // Ответ модели (текст): болтаем.
        talk() { enter('talk', ['emo_0', 'emo_2', 'emo_0', 'emo_8'], 2.5, ''); },
        success() { enter('success', ['emo_1', 'crab_7', 'emo_1'], 2, 'Готово!', 4.5); },
        failure(text) { enter('failure', ['emo_6', 'emo_7'], 1.5, text || 'Что-то пошло не так…', 5); },
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
                if (m.quiet > 45 && !m.sleeping) { m.sleeping = true; m.frames = ['idle_8']; m.i = 0; m.bubble = 'zZz…'; m.fps = 0.5; }
            } else if (!busy && (m.mode === 'thinking' || m.mode.startsWith('tool:') || m.mode === 'talk' || m.mode === 'waiting')) {
                backToIdle();
            }
            return before !== m.frames[m.i % m.frames.length] + '|' + m.bubble;
        },
        // Любое действие пользователя будит.
        wake() { if (m.sleeping) backToIdle(); m.quiet = 0; },
    };
}
