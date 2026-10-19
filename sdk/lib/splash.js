// ===========================================================================
// Сплэш SDK (docs/SDK.md §1.1): окно показывает картинку, название комплекта
// разработки и прогресс, пока грузятся реестр, расширения и версия backend.
//
// Только RmlUi: отдельного splash-рендерера/нативных виджетов нет. Документ
// живёт поверх shell до готовности приложения, затем скрывается. Минимальное
// время показа ограничено, чтобы при быстром старте сплэш не «мигал».
//
// Прогресс — те же этапы, что реально выполняются в app.js:
//   shell/wire/render -> реестр инструментов -> расширения -> версия -> ready.
// Это не фальшивый таймер: значение ведёт приложение через splash.progress().
// ===========================================================================

export function createSplash($, path) {
    const state = {
        visible: false,
        hidden: false,
        value: 0,          // анимированное значение 0..100
        target: 0,
        label: 'подготовка…',
        version: '',
        frames: 0,
        startedAt: 0,
        finished: false,
        failed: false,
        minMs: 900,        // не скрываться раньше, чтобы не мигать
        holdMs: 250,
    };
    let doc = null;
    try {
        doc = $.ui.doc(path || 'sdk/ui/splash.rml');
    } catch (e) {
        state.failed = true;
        return api();
    }
    const started = now();
    state.startedAt = started;
    let lastPercent = -1;
    let lastText = '';
    let shownFrames = 0;
    let finishAt = 0;

    function now() {
        // Реальные часы движка: сплэш не должен замирать от паузы/scale игры.
        try {
            if ($.time && typeof $.time.realNow === 'function') return $.time.realNow() * 1000;
        } catch (e) { /* ниже fallback */ }
        try {
            if ($.time && typeof $.time.perfNow === 'function') return $.time.perfNow();
        } catch (e) { /* ниже fallback */ }
        return state.frames * 16.6667;
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function paint() {
        if (!doc) return;
        const pct = Math.max(0, Math.min(100, state.value));
        const rounded = Math.round(pct);
        if (rounded !== lastPercent) {
            doc.html('splash-bar', '<div id="splash-fill" class="splash-fill" style="width:' + rounded + '%"></div>');
            doc.text('splash-percent', rounded + '%');
            lastPercent = rounded;
        }
        if (state.label !== lastText) {
            doc.text('splash-stage', escapeHtml(state.label));
            lastText = state.label;
        }
    }

    function show() {
        if (!doc) return false;
        doc.show();
        state.visible = true;
        paint();
        return true;
    }

    function progress(value, label) {
        if (typeof value !== 'number' || !isFinite(value)) return state.target;
        state.target = Math.max(0, Math.min(100, value));
        if (label) state.label = String(label);
        if (state.target > state.value) state.value = Math.min(state.target, state.value + 2);
        paint();
        return state.target;
    }

    function version(text) {
        state.version = String(text || '');
        if (doc && state.version) doc.text('splash-version', escapeHtml(state.version));
        return state.version;
    }

    function finish(label) {
        if (state.finished) return;
        state.finished = true;
        finishAt = now();
        progress(100, label || 'готово');
    }

    function snapshot() {
        return {
            visible: state.visible,
            hidden: state.hidden,
            progress: Math.round(state.value),
            target: state.target,
            label: state.label,
            version: state.version,
            frames: state.frames,
            finished: state.finished,
            failed: state.failed,
        };
    }

    function api() {
        return { show, progress, finish, version, snapshot, state };
    }

    show();
    progress(4, 'запуск…');

    $.update((dt) => {
        state.frames++;
        if (!doc) return;
        const seconds = Math.max(0, Math.min(0.25, Number(dt) || 0));
        // Плавно догоняем целевое значение; шаг ограничен, чтобы не «прыгать».
        const shift = (state.target - state.value) * Math.min(1, seconds * 10);
        if (Math.abs(shift) > 0.05) state.value += shift;
        else state.value = state.target;
        paint();
        if (!state.finished) return;
        const elapsed = now() - started;
        const stable = now() - finishAt;
        if (state.value >= 99.9 && stable >= state.holdMs && elapsed >= state.minMs) {
            if (state.visible) {
                doc.hide();
                state.visible = false;
                state.hidden = true;
            }
        }
    });

    return api();
}
