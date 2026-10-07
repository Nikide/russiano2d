// ===========================================================================
// Экран загрузки: заголовок, подпись и полоса прогресса.
//
// Зачем в движке: смена сцены — главный источник пауз (построение мира, запекание
// тайлмапа, загрузка текстур), и каждый делал себе заглушку руками. Здесь один
// вызов на весь экран:
//
//   $.loading.show({ title: 'Готовим лес…', hint: 'это пара секунд' });
//   $.loading.progress(0.4, 'деревья');
//   $.loading.hide();
//
// Полоса — обычный <ui.bar> из интерфейса, поэтому экран живёт в том же слое,
// что и остальной HUD, и не мешает вводу.
// ===========================================================================

export function createLoading(ctx) {
    const state = {
        nodes: [],
        bar: null,
        title_lbl: null,
        label_lbl: null,
        hint_lbl: null,
        value: 0,
        visible: false,
    };

    function clear() {
        for (const node of state.nodes) node.remove();
        state.nodes = [];
        state.bar = null;
        state.title_lbl = null;
        state.label_lbl = null;
        state.hint_lbl = null;
        state.visible = false;
    }

    const loading = {
        /**
         * Показать экран. opts: { title, hint, value, color }.
         * Повторный вызов перерисовывает экран заново.
         */
        show(opts) {
            const o = opts || {};
            const $ = ctx.$;
            const win = $.window.size();
            const cx = win.w / 2;
            const cy = win.h / 2;
            clear();

            state.nodes.push($('<ui.panel>', { id: 'loading_bg', color: '#05070cf2' })
                .at(cx, cy).size(win.w, win.h).appendTo($.ui));
            state.title_lbl = $('<ui.label>', { id: 'loading_title', size: 34,
                                                color: o.color || '#e8f0ff', align: 'center',
                                                text: o.title || 'Загрузка…' })
                .at(cx, cy - 40).appendTo($.ui);
            state.bar = $('<ui.bar>', { id: 'loading_bar', value: 0, max: 1000,
                                        fillColor: o.barColor || '#5ce1e6' })
                .at(cx, cy + 20).size(460, 14).appendTo($.ui);
            state.label_lbl = $('<ui.label>', { id: 'loading_label', size: 16, color: '#9fb3d0',
                                                align: 'center', text: '0%' })
                .at(cx, cy + 52).appendTo($.ui);
            state.hint_lbl = $('<ui.label>', { id: 'loading_hint', size: 13, color: '#63758d',
                                               align: 'center', text: o.hint || '' })
                .at(cx, cy + 82).appendTo($.ui);

            state.nodes.push(state.title_lbl, state.bar, state.label_lbl, state.hint_lbl);
            state.visible = true;
            loading.progress(o.value === undefined ? 0 : o.value);
            return loading;
        },

        /** Прогресс 0..1 и необязательная подпись текущего шага. */
        progress(value, label) {
            if (!state.visible) return loading;
            state.value = Math.max(0, Math.min(1, Number(value) || 0));
            if (state.bar && state.bar.nodes[0]) {
                state.bar.nodes[0].value = Math.round(state.value * 1000);
                state.bar.nodes[0].max_value = 1000;
            }
            if (state.label_lbl && state.label_lbl.nodes[0]) {
                state.label_lbl.nodes[0].text = `${Math.round(state.value * 100)}%`
                    + (label ? ` · ${label}` : '');
            }
            return loading;
        },

        /** Только подпись, без изменения полосы. */
        label(text) {
            if (state.hint_lbl && state.hint_lbl.nodes[0]) state.hint_lbl.nodes[0].text = text || '';
            return loading;
        },

        /** Заголовок на ходу. */
        title(text) {
            if (state.title_lbl && state.title_lbl.nodes[0]) state.title_lbl.nodes[0].text = text || '';
            return loading;
        },

        visible() { return state.visible; },
        value() { return state.value; },

        /** Убрать экран. */
        hide() { clear(); return loading; },

        /**
         * Провести список шагов с полосой прогресса: шаги выполняются по одному
         * за кадр, поэтому экран успевает отрисоваться и не «залипает».
         *
         *   $.loading.run([
         *       { label: 'лес', work: () => buildForest() },
         *       { label: 'враги', work: () => spawnHorde() },
         *   ], () => startRun());
         */
        run(steps, done) {
            const list = (steps || []).slice();
            const total = Math.max(1, list.length);
            let index = 0;
            // Хук ставит $.update: в ctx.update его нет, и run() падал
            // («ctx.update is not a function»).
            const addUpdate = ($ && typeof $.update === 'function')
                ? (fn) => { $.update(fn); return () => {}; }
                : () => {
                    ctx.log('$.loading.run: нет $.update — шаги не будут выполнены');
                    return () => {};
                };
            const off = addUpdate(() => {
                if (index >= list.length) {
                    off();
                    if (typeof done === 'function') done();
                    return;
                }
                const step = list[index];
                loading.progress(index / total, step.label || '');
                try {
                    if (typeof step.work === 'function') step.work();
                    else if (typeof step === 'function') step();
                } catch (e) {
                    ctx.log(`$: ошибка на шаге загрузки "${step.label || index}": ${e}`);
                }
                index++;
                if (index >= list.length) loading.progress(1);
            });
            return loading;
        },
    };

    return loading;
}
