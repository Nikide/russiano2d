// ===========================================================================
// Интерфейс: $.ui — узлы <ui.*> поверх сцены и документы RmlUi.
//
// Два пути, оба живые:
//   * узлы $('<ui.button>', {...}) — рисуются самим $.gfx, работают без
//     .rml-файлов, попадают на скриншот в headless-прогоне и полностью
//     доступны агенту;
//   * документы RmlUi — $.ui.doc('ui/menu.rml') — для сложной вёрстки,
//     стилей и шрифтов.
//
// Узлы интерфейса живут в координатах окна: камера на них не влияет.
// ===========================================================================

import { ctx, query, packColor, nodesWithFacet } from './core.js';
import { activeDialog } from './widgets.js';

// Кэш обёрток документов RmlUi: путь → обёртка (см. ui.doc()).
const docs = new Map();

// Текущий масштаб интерфейса. Живёт в модуле, а не в подсистеме: масштаб —
// настройка игрока, и он не должен сбрасываться при createApi().
let state_scale = 1;

/**
 * Узел внутри поддерева `ancestor`? Нужен, чтобы модальный диалог пропускал
 * ввод своим детям (кнопкам окна), но блокировал всё остальное.
 */
function isInside(ancestor, node) {
    for (let cur = node; cur; cur = cur.parent_node) {
        if (cur === ancestor) return true;
    }
    return false;
}

export function installUi($) {
    const ui = {
        // --- Узлы <ui.*> -----------------------------------------------------

        /** Показать/скрыть любой узел интерфейса по селектору. */
        show(sel) { query(sel).forEach((n) => { n.visible = true; }); return ui; },
        hide(sel) { query(sel).forEach((n) => { n.visible = false; }); return ui; },

        /** Полоса здоровья/прогресса: $.ui.bar('#hp', 0.5). */
        bar(sel, value, max) {
            query(sel).forEach((n) => {
                n.value = value;
                if (max !== undefined) n.max_value = max;
            });
            return ui;
        },

        /** Текст любого ui-узла. */
        label(sel, text) {
            query(sel).forEach((n) => { n.text = String(text); });
            return ui;
        },

        /** Частота кадров для HUD. */
        fps() { return Math.round(engine.fps); },

        /**
         * Масштаб интерфейса: `$.ui.scale(1.5)` — крупнее для большого экрана
         * или для слабого зрения. Без аргумента читает текущий.
         *
         * Масштабируются узлы <ui.*> — положение, размер и кегль текста.
         * Масштаб применяется ОДИН РАЗ: повторный `scale(1.5)` не увеличит
         * вдвое, а поставит ровно 1.5 (пересчёт от текущего к новому).
         */
        scale(value) {
            if (value === undefined) return state_scale;
            const next = Math.max(0.25, Math.min(4, Number(value) || 1));
            const ratio = next / state_scale;
            if (ratio !== 1) {
                const nodes = nodesWithFacet('ui');
                for (const node of nodes) {
                    node.x *= ratio;
                    node.y *= ratio;
                    node.w *= ratio;
                    node.h *= ratio;
                    if (node.size) node.size *= ratio;
                }
            }
            state_scale = next;
            return ui;
        },

        /** Прочитать масштаб без изменения. */
        scaleValue() { return state_scale; },

        /**
         * Семантика для ассистивных технологий: `$.ui.aria('#play', { role: 'button',
         * label: 'Начать игру' })`.
         *
         * Свойства лежат на узле (`node.aria`) и попадают в снимок агента,
         * поэтому доступность интерфейса проверяется автотестом. Сам движок
         * ничего не произносит: озвучивает оболочка, читающая снимок.
         */
        aria(sel, props) {
            const list = typeof sel === 'string' ? query(sel) : sel;
            if (!props) return list.length ? (list[0].aria || null) : null;
            for (const node of list) {
                node.aria = Object.assign({}, node.aria || {}, props);
            }
            return ui;
        },

        /** Сколько ui-узлов имеют семантику. */
        ariaCount() {
            let n = 0;
            for (const node of nodesWithFacet('ui')) if (node.aria) n++;
            return n;
        },

        /** Семантика узла (или null) — удобно в проверках. */
        ariaOf(sel) {
            const list = typeof sel === 'string' ? query(sel) : sel;
            return list.length ? (list[0].aria || null) : null;
        },

        // --- Документы RmlUi --------------------------------------------------
        /**
         * Открывает .rml-документ и возвращает обёртку с методами документа.
         *   const menu = $.ui.doc('ui/menu.rml').show();
         *   menu.on('btn-play', 'click', () => $.scene.load('level1'));
         */
        doc(path) {
            // Обёртки кэшируются по пути: движок кэширует сам документ, поэтому
            // второй $ui.doc() на тот же файл обязан вернуть тот же объект —
            // иначе слушатели RmlUi повесились бы дважды.
            if (docs.has(path)) return docs.get(path);
            const id = engine.ui.load(path);
            if (id < 0) ctx.log(`$: не удалось загрузить документ "${path}"`);
            const wrapper = makeDoc(id, path);
            docs.set(path, wrapper);
            return wrapper;
        },

        /** Иконка Material Design по имени (2235 штук встроены в движок). */
        icon(name) { return engine.ui.icon(name); },
        hasIcon(name) { return engine.ui.hasIcon(name); },

        /**
         * Поставить иконку Material Design на узел: `$.ui.setIcon('#play', 'play_arrow')`.
         * Отдельная метка с иконкой нужна там, где глиф клеится к тексту и
         * строка перестаёт быть выровненной по центру кнопки.
         */
        setIcon(target, name) {
            const glyph = engine.ui.hasIcon(name) ? engine.ui.icon(name) : '';
            const nodes = typeof target === 'string' ? $(target) : target;
            return nodes.eachNode((_, el) => {
                const node = el;
                node.text = glyph;
                node.size = node.size || 24;
            });
        },
        iconNames() { return engine.ui.iconNames(); },
        iconCount() { return engine.ui.iconCount(); },

        /** Внутреннее: обработка наведения и кликов по ui-узлам. */
        _tick() {
            // Срез ui-узлов держит индекс реестра: нет узлов — цикл пуст, и
            // полного обхода мира здесь больше нет (§5, P2 отчёта).
            const nodes = nodesWithFacet('ui');
            if (nodes.length === 0) return;
            // Модальный диалог забирает ввод целиком: этот проход идёт ПОСЛЕ
            // tickWidgets (и после его проверки модальности), поэтому без
            // своего гейта клик проходил в контролы под затемнением.
            const modal = activeDialog();
            const mx = engine.mouseX;
            const my = engine.mouseY;
            const down = engine.mouseDown(1);
            const pressed = engine.mousePressed(1);
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                // Пока открыт диалог, чужие контролы не получают ни наведения,
                // ни кликов — иначе кнопка под окном срабатывала бы «сквозь».
                if (modal && node !== modal && !isInside(modal, node)) {
                    if (node.hovered) {
                        node.hovered = false;
                        if (node.tag === 'ui.button') node.emit('mouseleave', {});
                    }
                    node.pressed = false;
                    continue;
                }
                const inside = node.visible &&
                    mx >= node.x - node.w / 2 && mx <= node.x + node.w / 2 &&
                    my >= node.y - node.h / 2 && my <= node.y + node.h / 2;
                if (inside !== node.hovered) {
                    node.hovered = inside;
                    if (node.tag === 'ui.button') node.emit(inside ? 'mouseenter' : 'mouseleave', {});
                }
                if (inside && pressed) {
                    node.pressed = true;
                    node.emit('mousedown', { button: 'left' });
                }
                if (node.pressed && !down) {
                    node.pressed = false;
                    node.emit('mouseup', { button: 'left' });
                    if (inside) node.emit('click', { button: 'left' });
                }
            }
        },
    };

    ctx.ui = ui;
    return ui;
}

function makeDoc(id, path) {
    // Пары «элемент + событие», уже подписанные в этом документе.
    const bound = new Set();
    return {
        id,
        path,
        show() { engine.ui.show(id); return this; },
        hide() { engine.ui.hide(id); return this; },
        // Снимаем документ и выкидываем его из кэша: иначе $.ui.doc(path)
        // после unload() вернул бы ту же обёртку с мёртвым id.
        unload() { engine.ui.unload(id); docs.delete(path); return this; },
        visible() { return engine.ui.visible(id); },
        text(element, text) { engine.ui.setText(id, element, String(text)); return this; },
        html(element, html) { engine.ui.setHtml(id, element, html); return this; },
        cls(element, name, add) { engine.ui.setClass(id, element, name, add !== false); return this; },
        style(element, property, value) { engine.ui.setProperty(id, element, property, value); return this; },

        /**
         * Обработчик события элемента документа.
         *
         * RmlUi кэширует документ вместе со слушателями, поэтому повторная
         * подписка на ту же пару «элемент + событие» не выполняется дважды —
         * иначе один клик вызывал бы обработчик несколько раз. Разные
         * элементы подписываются независимо.
         */
        on(element, event, fn) {
            const key = element + '\u0000' + event;
            if (bound.has(key)) {
                ctx.log(`$: "${element}" уже слушает "${event}" в "${path}" — повторная подписка пропущена`);
                return this;
            }
            bound.add(key);
            engine.ui.on(id, element, event, fn);
            return this;
        },

        /** Сколько обработчиков уже повешено — для тестов. */
        listeners() { return [...bound]; },
    };
}
