// ===========================================================================
// Физика — песочница Box2D v3 на высокоуровневом API $.
//
//   * земля и две стены — статичные тела (тег <wall>);
//   * ЛКМ по игровой зоне — взрыв в точке клика (радиальный импульс соседним
//     телам) и новый ящик в той же точке;
//   * ПКМ — только взрыв;
//   * кнопки HUD: +10 ящиков, взрыв в центре, очистка, пересоздание уровня,
//     показ контуров тел, три режима гравитации;
//   * персонаж ходит на A/D или стрелках и прыгает Space/W/↑ — толкает ящики.
//
// Физику считает Box2D; здесь только тела, импульсы и картинка. Счётчик тел
// берётся из $.debug.stats(), контуры тел рисует $.gfx.draw — то есть и то и
// другое видно и агенту, и глазами.
// ===========================================================================

// Тайлсет 16x16: 16 колонок x 9 строк, тайл 4 — земля.
const TILES = 'demos/assets/tiles/platformer_tileset_16x16.png';
const TILE_FRAME = { src: TILES, cols: 16, rows: 9, cw: 16, ch: 16 };
const TILE_INDEX = 4;

const CHAR_FRAME = {
    src: 'demos/assets/art/characters/catgirl_green_ak_sprite_sheet.png',
    cols: 8, rows: 9, cw: 48, ch: 64,
};

const SFX = {
    boom: 'demos/assets/audio/sfx/explosion_01.ogg',
    put: 'demos/assets/audio/sfx/pickup_01.ogg',
    jump: 'demos/assets/audio/sfx/jump_01.ogg',
    click: 'demos/assets/audio/sfx/ui_click.ogg',
};

const BOX = 32;              // ящик 32x32 px
const MAX_BOXES = 400;       // с запасом ниже R2D_MAX_BODIES
const HUD_HEIGHT = 140;      // ниже этой линии клик играет, выше — интерфейс
const GROUND_H = 64;         // высота полосы земли у нижнего края
const EXPLOSION_RADIUS = 280;
const EXPLOSION_POWER = 1500;
const MAX_SPARKS = 240;

const GRAVITY = {
    earth: { g: 1600, label: 'Земля' },
    moon: { g: 320, label: 'Луна' },
    zero: { g: 0, label: 'Невесомость' },
};

/** Кегль текста ui-узла (атрибут { size } до отрисовки не доходит). */
function textSize(what, size) {
    $(what).each((i, node) => { node.get(0).size = size; });
}

/** Размер узла: .size() без аргументов — сеттер, читаем поля напрямую. */
function nodeSize(wrapper) {
    const node = wrapper.get(0);
    return node ? { w: node.w, h: node.h } : { w: 0, h: 0 };
}

/**
 * Контур прямоугольника.
 *
 * В $.gfx.draw есть только заливка (.rect) — заливка контуром скрыла бы под
 * собой сами тела, поэтому рамку собираем из четырёх линий.
 */
function strokeRect(g, x, y, w, h, color, width = 2) {
    g.draw.line(x, y, x + w, y, color, width);
    g.draw.line(x, y + h, x + w, y + h, color, width);
    g.draw.line(x, y, x, y + h, color, width);
    g.draw.line(x + w, y, x + w, y + h, color, width);
}

export default function installPhysics($) {
    $.scene.add('physics', {
        // --- Жизненный цикл --------------------------------------------------

        enter($) {
            const { w, h } = $.gfx.size();
            this.w = w;
            this.h = h;
            this.gravity = 'earth';
            this.outlines = false;
            this.sparks = [];
            this.blast = null;      // { x, y, t, radius } — расходящееся кольцо
            this.stat_timer = 0;

            // Камера в центре окна: мировые координаты совпадают с экранными,
            // и click-в-мир считается без пересчёта.
            $.world.gravity(0, GRAVITY.earth.g).color('#0e1219');
            $.camera.at(w / 2, h / 2).zoom(1).limits(null);

            this.buildLevel($);
            this.buildHud($);
            this.exposeStatus($);
        },

        exit() {
            // Узлы и тела за сценой убирает сам $: смена сцены чистит мир.
            this.blast = null;
            this.sparks.length = 0;
        },

        // --- Уровень ----------------------------------------------------------

        buildLevel($) {
            const w = this.w;
            const h = this.h;

            // Статика и персонаж пересоздаются с нуля: кнопка «Заново» зовёт
            // этот метод повторно, а вторые стены и второй персонаж в мире не
            // нужны. Снос и постройка — одним пакетом: удаления внутри
            // $.batch убираются из реестра одной уборкой, а не по сплайсу на
            // узел (docs/HIGH_LEVEL_API_PERF.md §3.6).
            $.batch(() => {
                $('.ground, .edge, #pusher, .box').remove();

                // Земля и стены: статичные тела, ящики об них останавливаются.
                $('<wall>', { class: 'ground' }).at(w / 2, h - GROUND_H / 2).size(w, GROUND_H)
                    .color('#3a2f22').appendTo($.world);
                $('<wall>', { class: 'edge' }).at(12, h / 2).size(24, h)
                    .color('#232d3d').appendTo($.world);
                $('<wall>', { class: 'edge' }).at(w - 12, h / 2).size(24, h)
                    .color('#232d3d').appendTo($.world);

                // Персонаж: ходит и прыгает встроенным управлением, толкает ящики.
                $('<player>', { id: 'pusher' })
                    .at(w * 0.28, h - 160).size(30, 44)
                    .frames(CHAR_FRAME).frame(0)
                    .controls('both')
                    .attr({ speed: 280, jumpForce: 640 })
                    .appendTo($.world);

                // Стартовая горка ящиков — чтобы физика была видна сразу.
                for (let i = 0; i < 12; i++) {
                    const x = w * 0.62 + (i % 3) * (BOX + 4);
                    const y = h - GROUND_H - 30 - Math.floor(i / 3) * (BOX + 4);
                    this.spawnBox($, x, y, false);
                }
            });
        },

        spawnBox($, x, y, sound = true) {
            if ($('.box').length >= MAX_BOXES) $('.box').first().remove();

            const box = $('<rect>', { class: 'box' })
                .at(this.clamp(x), this.clampY(y))
                .size(BOX, BOX)
                .frames(TILE_FRAME).frame(TILE_INDEX)
                // Плотность и трение читаются в момент создания тела, поэтому
                // атрибуты идут до .body(), а не после.
                .attr({ density: 1.0, friction: 0.45, restitution: 0.03 })
                .body('dynamic')
                .appendTo($.world);

            if (sound) $.sound.play(SFX.put, { volume: 0.5 });
            return box;
        },

        addBoxes($, count) {
            // Пачка ящиков — одним пакетом: реестр и сводки подсистем
            // пересчитываются один раз на всю пачку (docs/HIGH_LEVEL_API_PERF.md §3.6).
            $.batch(() => {
                for (let i = 0; i < count; i++) {
                    const x = this.w / 2 + $.random.range(-160, 160);
                    const y = HUD_HEIGHT + 40 + i * 6;
                    this.spawnBox($, x, y, false);
                }
            });
            $.sound.play(SFX.put, { volume: 0.8 });
        },

        clearBoxes($) {
            $.batch(() => $('.box').remove());
        },

        clamp(x) { return Math.max(40, Math.min(this.w - 40, x)); },
        clampY(y) { return Math.max(HUD_HEIGHT + 20, Math.min(this.h - GROUND_H - 20, y)); },

        // --- Взрыв ------------------------------------------------------------

        /** Радиальный импульс: чем ближе тело к эпицентру, тем сильнее толчок. */
        explode($, cx, cy, radius = EXPLOSION_RADIUS, power = EXPLOSION_POWER) {
            $('.box, #pusher').each((i, body) => {
                const p = body.pos();
                let dx = p.x - cx;
                let dy = p.y - cy;
                let d = Math.hypot(dx, dy);
                if (d > radius) return;
                if (d < 1) { dx = 0; dy = -1; d = 1; }
                const falloff = 1 - d / radius;
                // Импульс в пикселях равен прибавке скорости (масса ящика 1),
                // поэтому падение по расстоянию видно глазом.
                const imp = power * falloff;
                body.applyImpulse((dx / d) * imp, (dy / d) * imp - 0.35 * imp);
            });

            this.blast = { x: cx, y: cy, t: 0, radius };
            this.emitSparks(cx, cy, 26);
            $.camera.shake(11, 280);
            $.sound.play(SFX.boom, { volume: 0.85 });
        },

        emitSparks(x, y, count) {
            // Считаем свободное место, а не «уже больше лимита»: иначе одна
            // вспышка добавляла бы сразу count искр поверх предела.
            const room = MAX_SPARKS - this.sparks.length;
            const n = Math.min(count, Math.max(0, room));
            for (let i = 0; i < n; i++) {
                const ang = $.random.range(0, Math.PI * 2);
                const speed = $.random.range(160, 620);
                this.sparks.push({
                    x, y,
                    vx: Math.cos(ang) * speed,
                    vy: Math.sin(ang) * speed,
                    life: $.random.range(0.25, 0.6),
                    max: 0.6,
                });
            }
        },

        updateSparks(dt) {
            for (let i = this.sparks.length - 1; i >= 0; i--) {
                const s = this.sparks[i];
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.vx *= 0.94;
                s.vy = s.vy * 0.94 + 900 * dt;
                s.life -= dt;
                if (s.life <= 0) this.sparks.splice(i, 1);
            }
            if (this.blast) {
                this.blast.t += dt;
                if (this.blast.t > 0.45) this.blast = null;
            }
        },

        // --- Гравитация -------------------------------------------------------

        setGravity($, key) {
            const preset = GRAVITY[key] || GRAVITY.earth;
            this.gravity = GRAVITY[key] ? key : 'earth';
            $.world.gravity(0, preset.g);
            this.refreshButtons($);
        },

        // --- Интерфейс --------------------------------------------------------

        buildHud($) {
            const buttons = [
                ['add-boxes', '+10 ящиков', () => this.addBoxes($, 10)],
                ['boom', 'Взрыв в центре', () => this.explode($)],
                ['clear', 'Убрать ящики', () => this.clearBoxes($)],
                ['rebuild', 'Заново', () => { this.buildLevel($); this.setGravity($, this.gravity); }],
                ['toggle-outlines', 'Контуры: выкл', () => {
                    this.outlines = !this.outlines;
                    this.refreshButtons($);
                }],
                ['grav-earth', 'Земля', () => this.setGravity($, 'earth')],
                ['grav-moon', 'Луна', () => this.setGravity($, 'moon')],
                ['grav-zero', 'Невесомость', () => this.setGravity($, 'zero')],
            ];

            buttons.forEach(([id, text, action], i) => {
                const col = i % 4;
                const row = Math.floor(i / 4);
                $('<ui.button>', { id, text })
                    .at(120 + col * 200, 34 + row * 52)
                    .size(184, 40)
                    .appendTo($.ui)
                    .on('click', () => {
                        $.sound.play(SFX.click, { volume: 0.4 });
                        action();
                    });
            });

            $('<ui.label>', { id: 'stats', color: '#8fd1ff' }).at(24, 124).appendTo($.ui);
            $('<ui.label>', {
                id: 'hint', color: '#63758d',
                text: 'ЛКМ — взрыв и ящик в точке клика · ПКМ — только взрыв · A/D — идти · Space — прыжок · Esc — в меню',
            }).at(24, 692).appendTo($.ui);

            textSize('#stats', 17);
            textSize('#hint', 15);
            buttons.forEach(([id]) => textSize(`#${id}`, 16));

            this.refreshButtons($);
        },

        refreshButtons($) {
            $('#toggle-outlines').text(this.outlines ? 'Контуры: вкл' : 'Контуры: выкл');
        },

        exposeStatus($) {
            $.agent.expose('physics', () => {
                const stats = $.debug.stats();
                return {
                    gravity: GRAVITY[this.gravity].label,
                    boxes: $('.box').length,
                    bodies: stats.bodies,
                    nodes: stats.nodes,
                    outlines: this.outlines,
                };
            });
        },

        // --- Кадр -------------------------------------------------------------

        update(dt, $) {
            if ($.input.pressed('escape')) {
                $.sound.play(SFX.click, { volume: 0.5 });
                $.scene.load('launcher');
                return;
            }

            const mouse = $.input.mouseWorld();
            const in_area = mouse.y > HUD_HEIGHT;

            // ЛКМ: сначала толкаем соседей, потом ставим новый ящик — иначе он
            // получил бы импульс в упор и улетел раньше, чем его увидят.
            if (in_area && $.input.mousePressed('left')) {
                this.explode($, mouse.x, mouse.y, EXPLOSION_RADIUS, EXPLOSION_POWER * 0.7);
                this.spawnBox($, mouse.x, mouse.y);
            } else if (in_area && $.input.mousePressed('right')) {
                this.explode($, mouse.x, mouse.y);
            }

            // Прыжок персонажа: встроенное управление двигает тело, но звук
            // прыжка — дело игры.
            if ($('#pusher').onFloor() && ($.input.pressed('space') || $.input.pressed('w') || $.input.pressed('up'))) {
                $.sound.play(SFX.jump, { volume: 0.4 });
            }

            this.updateSparks(dt);

            this.stat_timer += dt;
            if (this.stat_timer >= 0.15) {
                this.stat_timer = 0;
                const stats = $.debug.stats();
                $('#stats').text(
                    `Тел: ${stats.bodies}  ·  ящиков: ${$('.box').length}  ·  узлов: ${stats.nodes}`
                    + `  ·  FPS: ${Math.round(stats.fps)}  ·  гравитация: ${GRAVITY[this.gravity].label}`);
            }
        },

        // --- Отрисовка --------------------------------------------------------

        render($) {
            const g = $.gfx;

            // Кромка земли — чтобы пол читался даже на тёмном фоне.
            g.draw.line(0, this.h - GROUND_H, this.w, this.h - GROUND_H, '#6d5535', 2);

            // Контуры тел: то, что физика считает прямоугольниками.
            if (this.outlines) {
                $('.box, .ground, .edge, #pusher').each((i, body) => {
                    const p = $.camera.worldToScreen(body.pos());
                    const zoom = $.camera.zoom();
                    const s = nodeSize(body);
                    strokeRect(g, p.x - (s.w * zoom) / 2, p.y - (s.h * zoom) / 2,
                               s.w * zoom, s.h * zoom,
                               body.hasClass('box') ? '#7fd1ff' : '#4a7fbf', 2);
                });
            }

            // Кольцо и искры взрыва.
            if (this.blast) {
                const p = $.camera.worldToScreen({ x: this.blast.x, y: this.blast.y });
                const k = this.blast.t / 0.45;
                g.draw.ring(p.x, p.y, this.blast.radius * (0.15 + k * 0.85), '#ffb457', 3);
            }
            for (const s of this.sparks) {
                const p = $.camera.worldToScreen(s);
                g.draw.circle(p.x, p.y, 3, s.life > 0.3 ? '#ffd873' : '#ff8b6b');
            }

            // Прицел: видно, куда придётся взрыв.
            const m = $.input.mouse();
            if (m.y > HUD_HEIGHT) {
                g.draw.ring(m.x, m.y, 26, '#ff8b6b', 2);
                g.draw.line(m.x - 34, m.y, m.x - 12, m.y, '#ff8b6b');
                g.draw.line(m.x + 12, m.y, m.x + 34, m.y, '#ff8b6b');
            }
        },
    });
}
