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
//
// Второй системы загрузки нет: свой экран — это RmlUi-документ через
// существующий $.ui.doc (или engine.ui.loadMarkup, когда нужно встроить .rcss),
// а сцена грузится тем же startLoader, что у $.scene.loadAsync.
//
//   $.loading.show({ rml: 'ui/loading.rml' });        // свой документ
//   $.loading.rml('ui/loading.rml', { rcss: 'ui/loading.rcss' });
//   const job = $.loading.scene('level2', { resources: [...] });
// ===========================================================================

import { engine } from './native.js';
import { inlineRcss } from './dialog_theme.js';

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
        // Свой RmlUi-экран: обёртка $.ui.doc или загруженный loadMarkup документ.
        doc: null,
        doc_path: null,
        doc_targets: null,    // { bar, label, progress } — id найденных элементов
        doc_warned: false,
        // §45: job сцены, за которым следит экран.
        job: null,
        job_offs: [],
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
        closeDoc();
        for (const [event, fn] of state.job_offs) {
            if (state.job && typeof state.job.off === 'function') state.job.off(event, fn);
        }
        state.job_offs = [];
        state.job = null;
    }

    /** Снять свой RmlUi-экран: скрыть, а созданный нами документ — выгрузить. */
    function closeDoc() {
        const screen = state.doc;
        state.doc = null;
        state.doc_path = null;
        state.doc_targets = null;
        state.doc_warned = false;
        if (!screen) return;
        try {
            if (screen.owned && typeof screen.unload === 'function') screen.unload();
            else if (typeof screen.hide === 'function') screen.hide();
        } catch (e) {
            ctx.log('$: ошибка при закрытии экрана загрузки: ' + e);
        }
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

    // --- Свой RmlUi-экран (существующий $.ui.doc / engine.ui.loadMarkup) -----
    //
    // Экран — это документ RmlUi, а не вторая подсистема загрузки. Элементы
    // `loading-bar` / `loading-label` (и прежние loading_bar/loading_label/
    // loading_progress из scene.js) получают прогресс; если их нет — документ
    // просто показывается, а прогресс доступен через $.loading.value().

    function elementText(screen, name) {
        if (!screen || typeof screen.content !== 'function') return null;
        try {
            const value = screen.content(name);
            return value === null || value === undefined ? null : String(value);
        } catch (e) {
            return null;
        }
    }

    function findElement(screen, names) {
        for (const name of names) {
            if (elementText(screen, name) !== null) return name;
        }
        return null;
    }

    function detectDocTargets(screen) {
        return {
            bar: findElement(screen, ['loading-bar', 'loading_bar']),
            label: findElement(screen, ['loading-label', 'loading_label']),
            progress: findElement(screen, ['loading_progress', 'loading-progress']),
        };
    }

    /** Сырой документ из engine.ui.loadMarkup: обёртки $.ui.doc тут нет. */
    function rawDocScreen(id, path) {
        const ui = engine.ui || {};
        return {
            mode: 'rml',
            path,
            id,
            owned: true,
            show() { if (typeof ui.show === 'function') ui.show(id); },
            hide() { if (typeof ui.hide === 'function') ui.hide(id); },
            unload() { if (typeof ui.unload === 'function') ui.unload(id); },
            text(element, value) { if (typeof ui.setText === 'function') ui.setText(id, element, String(value)); },
            attr(element, name, value) {
                if (typeof ui.setAttr === 'function') ui.setAttr(id, element, name, String(value));
            },
            content(element) {
                return typeof ui.getText === 'function' ? ui.getText(id, element) : null;
            },
        };
    }

    /** Обёртка $.ui.doc: прячемся за теми же методами, что и сырой документ. */
    function wrapperDocScreen(wrapper, path) {
        return {
            mode: 'rml',
            path,
            id: wrapper.id,
            owned: false,
            show() { if (typeof wrapper.show === 'function') wrapper.show(); },
            hide() { if (typeof wrapper.hide === 'function') wrapper.hide(); },
            text(element, value) { wrapper.text(element, value); },
            attr(element, name, value) { wrapper.attr(element, name, value); },
            content(element) { return typeof wrapper.content === 'function' ? wrapper.content(element) : null; },
        };
    }

    /**
     * Открыть RmlUi-экран. Сначала — отдельный .rcss через существующий
     * loadMarkup (у RmlUi нет биндинга «применить таблицу стилей», поэтому
     * таблица встраивается в разметку); иначе — $.ui.doc, тот же кэш
     * документов, что у игры.
     */
    function openRmlScreen(path, opts) {
        const o = opts || {};
        const api = ctx.$ || {};
        const fsApi = api.fs || ctx.fs || null;
        const rcss = o.rcss ? String(o.rcss) : null;
        if (rcss && fsApi && typeof fsApi.readText === 'function'
            && engine.ui && typeof engine.ui.loadMarkup === 'function') {
            const markup = fsApi.readText(path);
            const css = fsApi.readText(rcss);
            if (markup !== null && css !== null) {
                const id = engine.ui.loadMarkup('loading:' + path, inlineRcss(markup, css));
                if (typeof id === 'number' && id >= 0) {
                    const screen = rawDocScreen(id, path);
                    screen.show();
                    return screen;
                }
                ctx.log(`$: экран загрузки "${path}" с rcss "${rcss}" не загрузился — беру $.ui.doc`);
            } else {
                ctx.log(`$: .rcss "${rcss}" или .rml "${path}" не читается — стиль не встроен`);
            }
        }
        if (api.ui && typeof api.ui.doc === 'function') {
            const wrapper = api.ui.doc(path);
            if (wrapper && typeof wrapper.show === 'function') {
                const screen = wrapperDocScreen(wrapper, path);
                screen.show();
                return screen;
            }
        }
        ctx.log(`$.loading.rml: нет $.ui.doc — документ "${path}" не показан`);
        return null;
    }

    /** Прогресс в свой RmlUi-экран: value 0..1000 у полосы, «42% · шаг» у подписи. */
    function applyDocProgress(ratio, label) {
        const screen = state.doc;
        if (!screen) return false;
        const value = Math.max(0, Math.min(1, Number(ratio) || 0));
        if (!state.doc_targets) state.doc_targets = detectDocTargets(screen);
        const targets = state.doc_targets;
        if (targets.bar) screen.attr(targets.bar, 'value', Math.round(value * 1000));
        const text = `${Math.round(value * 100)}%${label ? ' · ' + label : ''}`;
        if (targets.label) screen.text(targets.label, text);
        if (targets.progress && targets.progress !== targets.label) screen.text(targets.progress, text);
        if (!targets.bar && !targets.label && !targets.progress && !state.doc_warned) {
            state.doc_warned = true;
            ctx.log(`$.loading.rml: в "${state.doc_path}" нет элементов loading-bar/loading-label — `
                + 'прогресс на экране не показан (доступен $.loading.value())');
        }
        return true;
    }

    const loading = {
        /**
         * Показать экран. opts: { title, hint, value, color, barColor } —
         * встроенный экран; `{ rml, rcss }` — свой RmlUi-документ (второй
         * системы загрузки нет, см. rml()).
         */
        show(opts) {
            const o = opts || {};
            if (o.rml) return loading.rml(o.rml, o);
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
            if (state.doc) {
                applyDocProgress(state.value, label);
                return loading;
            }
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
            if (state.doc) {
                const target = state.doc_targets && state.doc_targets.label;
                if (target) state.doc.text(target, text || '');
                return loading;
            }
            if (state.hint_lbl && state.hint_lbl.nodes[0]) state.hint_lbl.nodes[0].text = text || '';
            return loading;
        },

        /** Заголовок на ходу. */
        title(text) {
            if (state.doc) {
                const target = findElement(state.doc, ['loading-title', 'loading_title']);
                if (target) state.doc.text(target, text || '');
                return loading;
            }
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

        /**
         * Отменить то, за чем следит экран: job сцены (`$.loading.scene`) или
         * запрос ресурсов (`watch`). true — отменено.
         */
        cancel(reason) {
            if (state.job && typeof state.job.cancel === 'function' && !state.job.done()) {
                return state.job.cancel(reason);
            }
            if (!state.request || typeof state.request.cancel !== 'function') return false;
            return state.request.cancel();
        },

        /** Запрос, за которым следит экран (или null). */
        watched() { return state.request; },

        /** Job сцены, за которым следит экран (или null). */
        job() { return state.job; },

        /**
         * Свой RmlUi-экран загрузки — через существующий $.ui.doc / loadMarkup.
         *
         *   $.loading.rml('ui/loading.rml');                       // документ
         *   $.loading.rml('ui/loading.rml', { rcss: 'ui/loading.rcss' });
         *   $.loading.show({ rml: 'ui/loading.rml', rcss: 'ui/loading.rcss' });
         *   $.loading.progress(0.4, 'деревья');
         *
         * Документ получает прогресс, если в нём есть элементы с id
         * `loading-bar` (атрибут value 0..1000) и `loading-label` (текст
         * «42% · шаг»); прежние `loading_bar`/`loading_label`/`loading_progress`
         * тоже поддерживаются. Нет элементов — документ просто показывается,
         * а прогресс доступен через `$.loading.value()` (одно предупреждение
         * в журнал). `rcss` встраивается в разметку существующим loadMarkup:
         * отдельного «применить таблицу стилей» у движка нет.
         */
        rml(path, opts) {
            const o = opts || {};
            const target = path ? String(path) : (o.rml ? String(o.rml) : null);
            if (!target) {
                ctx.log('$.loading.rml: нужен путь к .rml');
                return loading;
            }
            clear();
            const screen = openRmlScreen(target, o);
            if (!screen) return loading;      // нет $.ui.doc — объяснили в журнал
            state.doc = screen;
            state.doc_path = target;
            state.visible = true;
            state.value = Math.max(0, Math.min(1, Number(o.value) || 0));
            if (o.title) loading.title(o.title);
            if (o.hint) loading.label(o.hint);
            loading.progress(state.value, o.label);
            return loading;
        },

        /**
         * Стандартная точка входа: асинхронная загрузка сцены + экран.
         *
         *   const job = $.loading.scene('level2', {
         *       resources: ['assets/tiles.png'],
         *       steps: [{ label: 'сборка', total: 400, work: (i) => build(i) }],
         *       rml: 'ui/loading.rml',        // свой экран (иначе встроенный)
         *       rcss: 'ui/loading.rcss',
         *   });
         *   job.on('progress', (p) => console.log(p.ratio));
         *
         * Возвращает job из `$.scene.job` — настоящий handle загрузчика (второго
         * загрузчика нет). Экран гасится по 'activated' (мир сменён), 'error'
         * или 'cancel'; по 'done' НЕ гасится: приобретение и активация разделены.
         * `opts.screen === false` — экрана нет, прогресс рисует игра.
         */
        scene(name, opts) {
            const o = opts || {};
            const sceneApi = ctx.scene || (ctx.$ && ctx.$.scene) || null;
            if (!sceneApi || typeof sceneApi.job !== 'function') {
                ctx.log('$.loading.scene: нужен $.scene.job — подсистема сцен не установлена');
                return null;
            }
            const job = sceneApi.job(name, Object.assign({}, o, { screen: false }));
            if (!job) return null;
            if (o.screen !== false) {
                const configured = typeof sceneApi.loading === 'function' ? (sceneApi.loading() || {}) : {};
                const rml = o.rml === undefined ? (configured.rml || null) : (o.rml || null);
                if (rml) loading.rml(rml, { rcss: o.rcss, value: 0, label: o.label });
                else loading.show({
                    title: o.title || o.label || 'Загрузка…',
                    hint: o.hint, value: 0,
                });
            }
            state.job = job;
            const bind = (event, fn) => {
                job.on(event, fn);
                state.job_offs.push([event, fn]);
            };
            bind('progress', (p) => {
                if (state.job !== job) return;
                loading.progress(p.ratio, progressText(p));
            });
            bind('done', () => {
                if (state.job !== job) return;
                loading.progress(1, '');
            });
            for (const event of ['activated', 'error', 'cancel']) {
                bind(event, () => {
                    if (state.job !== job) return;
                    if (o.keepScreen !== true) loading.hide();
                });
            }
            return job;
        },

        /** Убрать экран (и отпустить job/документ, за которыми он следил). */
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
