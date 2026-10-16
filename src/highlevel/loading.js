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
        request: null,        // §45: запрос, за которым следит экран
        unwatch: null,
    };

    function clear() {
        for (const node of state.nodes) node.remove();
        state.nodes = [];
        state.bar = null;
        state.title_lbl = null;
        state.label_lbl = null;
        state.hint_lbl = null;
        state.visible = false;
        state.request = null;
        state.unwatch = null;
    }

    /** Человеческая подпись прогресса: байты и стадия, без вранья о точности. */
    function progressText(progress) {
        const p = progress || {};
        const parts = [];
        if (p.bytes_known && p.bytes_total > 0) {
            parts.push(formatBytes(p.bytes_done) + ' / ' + formatBytes(p.bytes_total));
        } else if (p.jobs_total) {
            parts.push(`${p.jobs_done} / ${p.jobs_total}`);
        }
        if (p.stage && p.stage !== 'queued' && p.stage !== 'done') parts.push(stageName(p.stage));
        if (p.cancelled) parts.push('отменено');
        else if (p.estimated && !p.failed) parts.push('оценочно');
        return parts.join(' · ');
    }

    function stageName(stage) {
        switch (stage) {
            case 'io': return 'чтение';
            case 'decode': return 'декодирование';
            case 'apply': return 'применение';
            default: return stage;
        }
    }

    function formatBytes(value) {
        const bytes = Math.max(0, Number(value) || 0);
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }

    /** Полоса по прогрессу запроса: байты — точные, стадия — оценочная. */
    function applyRequestProgress() {
        const req = state.request;
        if (!req || !state.visible) return;
        const p = req.progress();
        let ratio = 0;
        if (p.bytes_known && p.bytes_total > 0) ratio = p.bytes_done / p.bytes_total;
        else if (p.jobs_total > 0) ratio = p.jobs_done / p.jobs_total;
        if (p.state === 'ready') ratio = 1;
        loading.progress(ratio, progressText(p));
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

        /**
         * §45: следить за асинхронным запросом ресурсов. Полоса показывает
         * реальные байты (если размеры известны) и стадию; оценочная стадия
         * честно помечена словом «оценочно», отмена — «отменено».
         *
         *   const req = $.resource.request(['assets/heavy.png']);
         *   $.loading.show({ title: 'Готовим лес…' }).watch(req);
         *   $.loading.cancel();     // отмена по кнопке/клавише
         */
        watch(request, opts) {
            const o = opts || {};
            if (state.unwatch) { state.unwatch(); state.unwatch = null; }
            state.request = request || null;
            if (!request || typeof request.on !== 'function') {
                if (o.label !== undefined) loading.label(o.label);
                return loading;
            }
            const refresh = () => applyRequestProgress();
            const off = [];
            for (const event of ['ready', 'failed', 'cancelled']) {
                request.on(event, () => {
                    applyRequestProgress();
                    if (event === 'failed' && typeof o.onFailed === 'function') o.onFailed(request.error());
                    if (event === 'ready' && typeof o.onReady === 'function') o.onReady(request);
                    if (event === 'cancelled' && typeof o.onCancelled === 'function') o.onCancelled();
                });
            }
            // Постоянное обновление полосы: прогресс виден и между событиями.
            const api = ctx.$;
            if (api && typeof api.update === 'function') {
                let stopped = false;
                api.update(() => {
                    if (stopped || state.request !== request) return;
                    if (request.done()) { stopped = true; applyRequestProgress(); return; }
                    applyRequestProgress();
                });
                off.push(() => { stopped = true; });
            }
            state.unwatch = () => { for (const fn of off) fn(); };
            applyRequestProgress();
            return loading;
        },

        /** Отменить запрос, за которым следит экран. true — отменён. */
        cancel() {
            if (!state.request || typeof state.request.cancel !== 'function') return false;
            return state.request.cancel();
        },

        /** Запрос, за которым следит экран (или null). */
        watched() { return state.request; },

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
            // Хук ставится через ctx.$ (в модуле нет глобального `$` — раньше
            // здесь было голое `$`, и run() падал с «$ is not defined»).
            const api = ctx.$;
            if (!api || typeof api.update !== 'function') {
                ctx.log('$.loading.run: нет $.update — шаги не будут выполнены');
                return loading;
            }
            // $.update не отдаёт функцию снятия, поэтому шаги выключаем флагом:
            // раньше «off()» ничего не снимал, и список крутился каждый кадр.
            let finished = false;
            api.update(() => {
                if (finished) return;
                if (index >= list.length) {
                    finished = true;
                    loading.progress(1);
                    if (typeof done === 'function') done();
                    return;
                }
                const step = list[index];
                loading.progress(index / total, step && step.label ? step.label : '');
                try {
                    if (step && typeof step.work === 'function') step.work();
                    else if (typeof step === 'function') step();
                } catch (e) {
                    ctx.log(`$: ошибка на шаге загрузки "${(step && step.label) || index}": ${e}`);
                }
                index++;
                if (index >= list.length) loading.progress(1);
            });
            return loading;
        },
    };

    return loading;
}
