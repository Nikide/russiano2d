// ===========================================================================
// Модели — вкладка Editor для провайдеров агента: список, адрес/модель/ключ, проверка
// подключения, свои провайдеры, поведение. Данные — общее хранилище (lib/agent_models.js),
// то же читает панель «Агент». Виртуальный путь вкладки — `agent:models`.
// ===========================================================================

import { studioDoc, esc } from '../lib/studio_kit.js';
import { PROTOCOL_LABELS, httpTransport } from '../lib/agent_models.js';

export const meta = { id: 'models', title: 'Модели', icon: 'smart_toy', match: (p) => p === 'agent:models' };

export function create(host) {
    const $ = host.$;
    const doc = studioDoc($, 'models');
    const models = host.models;
    const transport = httpTransport($);
    const st = { open: null, adding: false, result: {}, chips: {}, busy: false, closed: false, newProto: 'openai', error: '' };

    const val = (id) => String(doc.value(id) === null || doc.value(id) === undefined ? '' : doc.value(id));

    function formFor(r) {
        const p = models.profile(r.id);
        const spec = models.spec(r.id);
        const res = st.result[r.id];
        const chips = (p.models || []).map((m) => '<span class="md-chip' + (m === p.model ? ' on' : '') + '" data-key="pick:' + r.id + ':' + esc(m) + '">' + esc(m) + '</span>').join('');
        const keyHint = r.id === 'gigachat' ? 'Authorization key из кабинета разработчика (Basic-ключ): токен Editor получает сам.'
            : r.id === 'openai' ? 'Для локальных серверов ключ не нужен.' : 'Ключ вводится один раз; вставка — Cmd/Ctrl+V.';
        return '<div class="md-card">' +
            '<span class="md-label">Адрес API</span><input id="md-base" class="md-in" type="text"/>' +
            '<span class="md-label">Модель</span><input id="md-model" class="md-in" type="text"/>' +
            '<div class="md-actions"><button class="st-btn" data-key="models:' + r.id + '">Обновить список моделей</button><span class="md-hint">' + (p.models.length ? 'в списке ' + p.models.length + ' · обновляется сам' : 'подгружается сам, когда введён ключ') + '</span></div>' +
            (chips ? '<div class="md-chips">' + chips + '</div>' : '') +
            '<span class="md-label">Ключ API</span><input id="md-key" class="md-in" type="password"/><span class="md-hint">' + esc(keyHint) + '</span>' +
            '<div class="md-actions"><span class="md-chip' + (p.remember ? ' on' : '') + '" data-key="remember:' + r.id + '">Запомнить ключ на этом компьютере: ' + (p.remember ? 'да' : 'нет') + '</span></div>' +
            '<span class="md-hint">' + (p.remember ? 'Ключ записан открытым текстом в agent.local.json (файл в .gitignore).' : 'Ключ хранится только в памяти Editor и пропадёт после закрытия.') + '</span>' +
            '<div class="md-actions"><button class="st-btn primary" data-key="activate:' + r.id + '">Сделать активной</button>' +
            '<button class="st-btn" data-key="test:' + r.id + '">Проверить подключение</button>' +
            (spec.custom ? '<button class="st-btn danger" data-key="remove:' + r.id + '">Удалить</button>' : '') +
            '<span class="md-result' + (res ? (res.ok ? ' ok' : ' err') : '') + '">' + esc(res ? res.text : '') + '</span></div></div>';
    }

    function render() {
        let html = '<span class="md-title">Модели</span><span class="md-sub">Подключите провайдера и выберите модель для агента. Активная модель отвечает в панели «Агент».</span>';
        for (const r of models.list()) {
            const open = st.open === r.id;
            html += '<div class="md-row' + (r.active ? ' on' : '') + (open ? ' open' : '') + '"><div class="md-main"><span class="md-name">' + esc(r.label) + '</span>' +
                (r.custom ? '<span class="md-badge">Свой</span>' : '') + '<span class="md-dot' + (r.configured ? ' ok' : '') + '"></span>' +
                '<span class="md-meta">' + esc(r.desc) + ' · ' + esc(r.model) + '</span></div>' +
                (r.active ? '<span class="md-active">Активна</span>' : '') +
                '<button class="st-btn" data-key="edit:' + r.id + '">' + (open ? 'Свернуть' : 'Изменить') + '</button></div>';
            if (open) html += formFor(r);
        }
        if (st.adding) {
            html += '<div class="md-card" style="margin-top:8px;border-top-width:1px;border-radius:10px;"><span class="md-label">Название</span><input id="md-n-label" class="md-in" type="text"/>' +
                '<span class="md-label">ID (латиница, для запросов и хранения)</span><input id="md-n-id" class="md-in" type="text"/>' +
                '<span class="md-label">Адрес API</span><input id="md-n-base" class="md-in" type="text"/><span class="md-hint">например https://gateway.example/v1 — без /chat/completions</span>' +
                '<span class="md-label">Протокол</span><div class="md-chips">' + Object.keys(PROTOCOL_LABELS).map((k) => '<span class="md-chip' + (st.newProto === k ? ' on' : '') + '" data-key="proto:' + k + '">' + esc(PROTOCOL_LABELS[k]) + '</span>').join('') + '</div>' +
                '<span class="md-label">Модель по умолчанию</span><input id="md-n-model" class="md-in" type="text"/>' +
                '<div class="md-actions"><button class="st-btn primary" data-key="create">Добавить</button><button class="st-btn" data-key="cancel">Отмена</button><span class="md-result err">' + esc(st.error) + '</span></div></div>';
        } else {
            html += '<span class="md-add" data-key="add">+ Свой провайдер: шлюз, свой сервер, любая OpenAI- или Anthropic-совместимая точка</span>';
        }
        const b = models.state;
        html += '<span class="md-h">ПОВЕДЕНИЕ АГЕНТА</span><div class="md-card" style="border-top-width:1px;border-radius:10px;"><span class="md-label">Лимит шагов на вопрос</span><input id="md-steps" class="md-in" type="text" style="width:120px;"/>' +
            '<div class="md-actions"><span class="md-chip' + (b.autoApprove ? ' on' : '') + '" data-key="approve">Подтверждения: ' + (b.autoApprove ? 'разрешать всё' : 'спрашивать') + '</span><span class="md-chip' + (b.mascotOn ? ' on' : '') + '" data-key="mascot">Маскот: ' + (b.mascotOn ? 'вкл' : 'выкл') + '</span></div>' +
            '<span class="md-hint">«Разрешать всё» — запись файлов, правки студий и команды r2d выполняются без вопроса; откат ↶ в шапке агента остаётся.</span></div>' +
            '<span class="md-note">Настройки (кроме ключей) хранятся в agent.local.json рядом с state.local.json и не попадают в проект и git. Беседа с агентом лежит в проекте (.r2d-agent.json).</span>';
        doc.html('md-body', html);
        fill();
    }

    function fill() {
        if (st.open) {
            const p = models.profile(st.open);
            doc.setValue('md-base', p.base); doc.setValue('md-model', p.model); doc.setValue('md-key', p.key);
        }
        doc.setValue('md-steps', String(models.state.maxSteps));
    }

    // Введённое в форме → хранилище (без перерисовки: фокус остаётся в поле).
    function commit() {
        if (st.open) {
            const before = models.profile(st.open).key;
            models.set(st.open, { base: val('md-base'), model: val('md-model'), key: val('md-key') });
            if (before !== models.profile(st.open).key && models.needsModels(st.open)) autoModels(st.open, true);
        }
        const n = parseInt(val('md-steps'), 10);
        if (n >= 1 && n <= 100 && n !== models.state.maxSteps) models.setBehavior({ maxSteps: n });
    }

    // Список моделей подтягивается сам и сохраняется: при открытии провайдера, после проверки и смены ключа.
    async function autoModels(id, quiet) {
        if (st.fetching === id) return;
        st.fetching = id;
        try { await models.refreshModels(id, transport); if (!quiet) st.result[id] = { ok: true, text: 'моделей: ' + models.profile(id).models.length }; }
        catch (e) { if (!quiet) st.result[id] = { ok: false, text: e.message }; }
        st.fetching = null;
        if (!st.closed) render();
    }

    async function act(key) {
        const [name, id, ...rest] = key.split(':');
        const arg = rest.join(':');
        if (name === 'edit') { commit(); st.open = st.open === id ? null : id; st.adding = false; render(); if (st.open && models.needsModels(id)) autoModels(id, true); return; }
        if (name === 'activate') { commit(); models.activate(id); render(); return; }
        if (name === 'remember') { commit(); models.set(id, { remember: !models.profile(id).remember }); render(); return; }
        if (name === 'pick') { models.set(id, { model: arg }); commit(); render(); return; }
        if (name === 'approve') { commit(); models.setBehavior({ autoApprove: !models.state.autoApprove }); render(); return; }
        if (name === 'mascot') { commit(); models.setBehavior({ mascotOn: !models.state.mascotOn }); render(); return; }
        if (name === 'add') { commit(); st.adding = true; st.error = ''; render(); return; }
        if (name === 'cancel') { st.adding = false; render(); return; }
        if (name === 'proto') { st.newProto = id; st.error = ''; const keep = [val('md-n-label'), val('md-n-id'), val('md-n-base'), val('md-n-model')]; render(); ['md-n-label', 'md-n-id', 'md-n-base', 'md-n-model'].forEach((f, i) => doc.setValue(f, keep[i])); return; }
        if (name === 'create') {
            try {
                const c = models.addCustom({ id: val('md-n-id').trim(), label: val('md-n-label'), protocol: st.newProto, base: val('md-n-base'), model: val('md-n-model') });
                st.adding = false; st.open = c.id; st.error = '';
            } catch (e) { st.error = e.message; const keep = [val('md-n-label'), val('md-n-id'), val('md-n-base'), val('md-n-model')]; render(); ['md-n-label', 'md-n-id', 'md-n-base', 'md-n-model'].forEach((f, i) => doc.setValue(f, keep[i])); return; }
            render(); return;
        }
        if (name === 'remove') { try { models.removeCustom(id); } catch (_) { /* уже удалён */ } if (st.open === id) st.open = null; render(); return; }
        if (name === 'test') {
            commit();
            st.result[id] = { ok: false, text: 'Проверяю…' }; render();
            const r = await models.test(id, transport);
            if (st.closed) return;
            st.result[id] = r.ok ? { ok: true, text: 'Подключение работает (' + r.ms + ' мс)' } : { ok: false, text: String(r.error || 'ошибка') };
            render();
            if (r.ok && models.needsModels(id)) autoModels(id, true);
            return;
        }
        if (name === 'models') {
            commit();
            st.result[id] = { ok: false, text: 'Запрашиваю список…' }; render();
            await autoModels(id, false);
        }
    }

    doc.on('md-body', 'click', (id, ev, key) => { if (key) act(key); });
    doc.on('md-body', 'change', () => commit());

    models.onChange(() => { if (!st.closed && doc.value('md-steps') !== null) { /* состояние поменяли извне (панель): перерисуем при следующем показе */ st.stale = true; } });

    return {
        doc,
        async open() { st.open = models.state.active; render(); },
        update() { if (st.stale && !host.typing()) { st.stale = false; render(); } },
        layout() {}, onActive() {},
        async save() { commit(); return true; },
        undo() { return false; }, redo() { return false; },
        dirty: () => false,
        diagnostics: () => [],
        snapshot: () => ({ active: models.state.active, open: st.open, providers: models.list().map((r) => r.id + (r.configured ? '+' : '')) }),
        // Для тестов и агента.
        act, commit,
        close() { st.closed = true; doc.unload(); },
    };
}
