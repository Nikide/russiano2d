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

import { ctx, query, packColor } from './core.js';

// Кэш обёрток документов RmlUi: путь → обёртка (см. ui.doc()).
const docs = new Map();

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
        iconNames() { return engine.ui.iconNames(); },
        iconCount() { return engine.ui.iconCount(); },

        /** Внутреннее: обработка наведения и кликов по ui-узлам. */
        _tick() {
            const mx = engine.mouseX;
            const my = engine.mouseY;
            const down = engine.mouseDown(1);
            const pressed = engine.mousePressed(1);
            for (const node of ctx.nodes) {
                if (!node.attrs.ui) continue;
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
