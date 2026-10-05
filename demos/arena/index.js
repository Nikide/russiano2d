// ===========================================================================
// Арена — вертикальный шутер сверху вниз на высокоуровневом API $.
//
// Игрок (маскот Руссиано) бегает по арене на WASD или стрелках и стреляет в
// сторону курсора (ЛКМ или Space). Враги набегают волнами с краёв арены, у
// каждого здоровье, смерть и свой счёт. Здесь же HUD (здоровье, счёт, номер
// волны), экран проигрыша, перезапуск и выход в меню по Escape.
//
// Выстрел — это луч ($.world.raycast) от дула к курсору: укрытия его
// останавливают, поэтому за блоками врагов не достать. Видимую часть выстрела
// рисует трассер $('<bullet>'), который летит ровно до точки попадания.
//
// У трассера намеренно нет тела: $.world.raycast() возвращает ближайшее тело,
// и снаряд с телом перехватывал бы собственные выстрелы игрока. Дешёвая
// альтернатива — считать его позицию в JS: за кадр это один .move().
// ===========================================================================

const MASCOT = {
    src: 'demos/assets/art/mascot/russiano_mascot_sheet_a.png',
    cols: 8, rows: 4, cw: 176, ch: 176,
};
const MASCOT_WALK = { from: 0, to: 7, speed: 10 };
// Последние кадры второй строки листа — маскот падает.
const MASCOT_DEATH = { from: 13, to: 15, speed: 5, loop: false };

// Листы врагов: 8 колонок x 9 строк, кадр 48x64 (demos/assets/art/manifest.json).
const SHEET = { cols: 8, rows: 9, cw: 48, ch: 64 };
const SHEET_WALK = { from: 0, to: 7, speed: 10 };
const SHEET_DEATH = { from: 64, to: 71, speed: 12, loop: false };
const sheet = (file) => ({ src: `demos/assets/art/characters/${file}.png`, ...SHEET });

const ENEMY_TYPES = [
    { file: 'enemy_03_zombie_girl_8x9',     hp: 58, speed: 54, w: 40, h: 52, score: 10, heavy: false },
    { file: 'enemy_06_ninja_assassin_8x9',  hp: 32, speed: 128, w: 36, h: 48, score: 14, heavy: false },
    { file: 'enemy_02_catgirl_scout_8x9',   hp: 40, speed: 104, w: 38, h: 50, score: 12, heavy: false },
    { file: 'enemy_01_armored_soldier_8x9', hp: 96, speed: 44, w: 44, h: 56, score: 20, heavy: true },
    { file: 'enemy_05_fire_demoness_8x9',   hp: 74, speed: 68, w: 40, h: 52, score: 17, heavy: true },
];

const SFX = {
    shoot: 'demos/assets/audio/sfx/shoot_01.ogg',
    hit: 'demos/assets/audio/sfx/enemy_hit.ogg',
    die: 'demos/assets/audio/sfx/enemy_die.ogg',
    boom: 'demos/assets/audio/sfx/explosion_01.ogg',
    hurt: 'demos/assets/audio/sfx/hurt_01.ogg',
    click: 'demos/assets/audio/sfx/ui_click.ogg',
    wave: 'demos/assets/audio/sfx/reload.ogg',
};
const MUSIC = 'demos/assets/audio/music/action.ogg';

const MAX_HP = 100;
const PLAYER_SPEED = 300;
const PLAYER_SIZE = 52;
const PLAYER_HITBOX = 38;
const CONTACT_DAMAGE = 9;
const CONTACT_RANGE = 42;
const IFRAMES_MS = 700;
const FIRE_DELAY = 0.14;
const FIRE_RANGE = 2200;
const BULLET_SPEED = 900;
const BULLET_DAMAGE = 14;
const MAX_ALIVE = 90;

/**
 * Кегль текста ui-узла.
 *
 * Атрибут { size } в $('<ui.label>', { size }) уходит в attrs и до отрисовки
 * не доходит: рисующий код читает отдельное поле узла. Пока это так, ставим
 * поле сами — иначе весь HUD рисуется одним кеглем 20.
 */
function textSize(what, size) {
    $(what).each((i, node) => { node.get(0).size = size; });
}

/**
 * Размер узла.
 *
 * Прочитать размер через .size() нельзя: в движке этот метод объявлен и как
 * геттер, и как сеттер, и побеждает сеттер — .size() без аргументов обнуляет
 * узлу ширину и высоту (и пересоздаёт тело с NaN). Поэтому читаем поля узла.
 */
function nodeSize(wrapper) {
    const node = wrapper.get(0);
    return node ? { w: node.w, h: node.h } : { w: 0, h: 0 };
}

export default function installArena($) {
    $.scene.add('arena', {
        // --- Жизненный цикл --------------------------------------------------

        enter($) {
            const { w, h } = $.gfx.size();
            this.w = w;
            this.h = h;
            this.state = 'play';
            this.score = 0;
            this.kills = 0;
            this.wave = 0;
            this.to_spawn = 0;
            this.spawn_timer = 0;
            this.wave_break = 0;
            this.fire_cd = 0;
            this.muzzle = 0;
            this.aim = { x: w / 2, y: h / 2 };

            // Арена сверху вниз: гравитации нет, камера стоит в центре окна,
            // поэтому мировые координаты совпадают с экранными.
            $.world.gravity(0, 0).color('#080b12').bounds(0, 0, w, h, { thickness: 64 });
            $.camera.at(w / 2, h / 2).zoom(1).limits(null);

            this.buildArena($, w, h);
            this.buildPlayer($, w, h);
            this.buildHud($);
            this.exposeStatus($);

            $.sound.music(MUSIC, { loop: true, volume: 0.25 });
            this.nextWave($);
        },

        exit() {
            this.state = 'idle';
            $.sound.stopMusic(300);
        },

        // --- Мир -------------------------------------------------------------

        /** Укрытия: за ними врагов не видно, а выстрел в них упирается. */
        buildArena($, w, h) {
            const cover = [
                [w * 0.24, h * 0.34, 150, 44],
                [w * 0.76, h * 0.34, 150, 44],
                [w * 0.29, h * 0.70, 44, 150],
                [w * 0.71, h * 0.70, 44, 150],
            ];
            for (const [x, y, cw, ch] of cover) {
                $('<wall>', { class: 'cover' }).at(x, y).size(cw, ch)
                    .color('#1b2a40').appendTo($.world);
            }
        },

        buildPlayer($, w, h) {
            $('<player>', { id: 'hero' })
                .at(w / 2, h - 120)
                .size(PLAYER_SIZE, PLAYER_SIZE)
                .frames(MASCOT)
                .animate(MASCOT_WALK)
                .health(MAX_HP)
                .collision(PLAYER_HITBOX, PLAYER_HITBOX)
                .appendTo($.world)
                .on('hit', (e) => {
                    $.camera.shake(5, 180);
                    e.self.flash('#ff6b6b', 160);
                })
                .on('death', () => this.gameOver($));
        },

        buildHud($) {
            $('<ui.panel>', { id: 'hud-hp-bg' }).at(196, 40).size(360, 62).appendTo($.ui);
            $('<ui.bar>', { id: 'hp', w: 320, h: 24, value: MAX_HP, max: MAX_HP })
                .at(180, 40).appendTo($.ui);
            $('<ui.label>', { id: 'score', color: '#ffd54a', align: 'right' })
                .at(1250, 32).appendTo($.ui);
            $('<ui.label>', { id: 'wave', color: '#8fd1ff', align: 'right' })
                .at(1250, 64).appendTo($.ui);
            $('<ui.label>', { id: 'enemies', color: '#7d8fa8', align: 'right' })
                .at(1250, 92).appendTo($.ui);
            $('<ui.label>', {
                id: 'hint', color: '#63758d',
                text: 'WASD или стрелки — бежать · ЛКМ или Space — огонь · Esc — в меню',
            }).at(24, 692).appendTo($.ui);

            // Экран проигрыша создаётся сразу и живёт спрятанным: показать его
            // в момент смерти дешевле, чем строить интерфейс по ходу боя.
            $('<ui.panel>', { id: 'over', w: this.w, h: this.h })
                .at(this.w / 2, this.h / 2).color('#000000cc').appendTo($.ui).hide();
            $('<ui.label>', {
                id: 'over-title', text: 'Арена пройдена не до конца',
                color: '#ff8b6b', align: 'center',
            }).at(this.w / 2, this.h / 2 - 120).appendTo($.ui).hide();
            $('<ui.label>', { id: 'over-stats', color: '#e8f0ff', align: 'center' })
                .at(this.w / 2, this.h / 2 - 56).appendTo($.ui).hide();
            $('<ui.label>', {
                id: 'over-hint', color: '#9fb3cc', align: 'center',
                text: 'Enter — ещё раз · Esc — в меню',
            }).at(this.w / 2, this.h / 2 + 96).appendTo($.ui).hide();

            $('<ui.button>', { id: 'btn-restart', text: 'Ещё раз' })
                .at(this.w / 2 - 130, this.h / 2 + 20).size(220, 56).appendTo($.ui).hide()
                .on('click', () => {
                    $.sound.play(SFX.click, { volume: 0.5 });
                    $.scene.restart();
                });
            $('<ui.button>', { id: 'btn-menu', text: 'В меню' })
                .at(this.w / 2 + 130, this.h / 2 + 20).size(220, 56).appendTo($.ui).hide()
                .on('click', () => {
                    $.sound.play(SFX.click, { volume: 0.5 });
                    $.scene.load('launcher');
                });

            textSize('#hp', 17);
            textSize('#score', 24);
            textSize('#wave', 20);
            textSize('#enemies', 16);
            textSize('#hint', 15);
            textSize('#over-title', 46);
            textSize('#over-stats', 22);
            textSize('#over-hint', 16);
        },

        /** Волны и счёт — в снимке мира, чтобы за игрой следил агент. */
        exposeStatus($) {
            $.agent.expose('arena', () => ({
                state: this.state,
                wave: this.wave,
                score: this.score,
                kills: this.kills,
                hp: Math.round($('#hero').hp()),
                enemies: $('.enemy:alive').length,
                to_spawn: this.to_spawn,
            }));
        },

        // --- Волны -----------------------------------------------------------

        nextWave($) {
            this.wave++;
            this.to_spawn = 4 + this.wave * 3;
            this.spawn_timer = 0.4;
            this.wave_break = 2.2;
            $.sound.play(SFX.wave, { volume: 0.3 });
        },

        spawnEnemy($) {
            if ($('.enemy:alive').length >= MAX_ALIVE) return;

            // Первые волны — только лёгкие враги, дальше подтягиваются тяжёлые.
            const pool = this.wave < 2 ? 2 : this.wave < 4 ? 3 : ENEMY_TYPES.length;
            const type = ENEMY_TYPES[$.random.int(0, pool - 1)];

            // Внутри арены: за её стенами тела врагов упёрлись бы в границу.
            const pad = 34;
            const edge = $.random.int(0, 3);
            let x;
            let y;
            if (edge === 0) { x = $.random.range(pad, this.w - pad); y = pad; }
            else if (edge === 1) { x = this.w - pad; y = $.random.range(pad, this.h - pad); }
            else if (edge === 2) { x = $.random.range(pad, this.w - pad); y = this.h - pad; }
            else { x = pad; y = $.random.range(pad, this.h - pad); }

            const hp = Math.max(1, Math.round(type.hp * (1 + (this.wave - 1) * 0.18)));
            const speed = type.speed * Math.min(1.5, 1 + (this.wave - 1) * 0.04);

            const enemy = $('<enemy>', { class: 'enemy mob' })
                .at(x, y)
                .size(type.w, type.h)
                .frames(sheet(type.file))
                .animate(SHEET_WALK)
                .health(hp)
                .collision(type.w * 0.8, type.h * 0.8)
                .attr({ speed, score: type.score, heavy: type.heavy, hp_max: hp })
                .appendTo($.world);

            enemy.on('death', () => this.killEnemy($, enemy));
        },

        updateWave(dt, $) {
            if (this.to_spawn > 0) {
                this.spawn_timer -= dt;
                if (this.spawn_timer <= 0) {
                    this.spawnEnemy($);
                    this.to_spawn--;
                    this.spawn_timer = Math.max(0.18, 0.7 - this.wave * 0.04);
                }
                return;
            }
            if ($('.enemy:alive').length === 0) {
                this.wave_break -= dt;
                if (this.wave_break <= 0) this.nextWave($);
            }
        },

        // --- Кадр -------------------------------------------------------------

        update(dt, $) {
            if ($.input.pressed('escape')) {
                $.sound.play(SFX.click, { volume: 0.5 });
                $.scene.load('launcher');
                return;
            }
            if (this.state !== 'play' && $.input.pressed('enter')) {
                $.scene.restart();
                return;
            }

            this.aim = $.input.mouseWorld();
            this.fire_cd = Math.max(0, this.fire_cd - dt);
            this.muzzle = Math.max(0, this.muzzle - dt);

            this.updateBullets(dt, $);
            this.updateWave(dt, $);
            this.updateEnemies(dt, $);
            if (this.state === 'play') {
                this.movePlayer($);
                this.updateShooting($);
            }
            this.updateHud($);
        },

        movePlayer($) {
            const hero = $('#hero');
            if (!hero.length) return;
            const v = $.input.vec('both');
            hero.velocity(v.x * PLAYER_SPEED, v.y * PLAYER_SPEED);
            hero.flip(this.aim.x < hero.pos().x, false);
        },

        updateShooting($) {
            if (this.fire_cd > 0) return;
            if (!($.input.mouseDown('left') || $.input.down('space'))) return;
            this.fire($);
            this.fire_cd = FIRE_DELAY;
            this.muzzle = 0.06;
            $.sound.play(SFX.shoot, { volume: 0.45 });
        },

        /** Выстрел: луч от дула к курсору, затем трассер до точки попадания. */
        fire($) {
            const hero = $('#hero');
            const p = hero.pos();
            const dx = this.aim.x - p.x;
            const dy = this.aim.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            // Небольшой разброс — очередь не идёт идеально прямой линией.
            const ang = Math.atan2(dy / d, dx / d) + ($.random.next() - 0.5) * 0.06;
            const dir = { x: Math.cos(ang), y: Math.sin(ang) };

            const from = { x: p.x + dir.x * 34, y: p.y + dir.y * 34 };
            const to = { x: from.x + dir.x * FIRE_RANGE, y: from.y + dir.y * FIRE_RANGE };

            const hit = $.world.raycast(from, to);
            const range = hit ? hit.distance : FIRE_RANGE;
            const target = this.nodeOfHit($, hit);
            if (target && target.hasClass('enemy') && target.alive()) {
                target.damage(BULLET_DAMAGE);
                $.sound.play(SFX.hit, { volume: 0.35 });
                $.camera.shake(2, 60);
            }
            this.tracer($, from, dir, range);
        },

        tracer($, from, dir, range) {
            $('<bullet>', { class: 'tracer' })
                .at(from.x, from.y)
                .size(10, 10)
                .color('#ffe08a')
                .body(null)                       // см. шапку файла
                .data({ vx: dir.x * BULLET_SPEED, vy: dir.y * BULLET_SPEED, life: range / BULLET_SPEED })
                .appendTo($.world);
        },

        updateBullets(dt, $) {
            $('.tracer').each((i, b) => {
                const life = b.data('life') - dt;
                if (life <= 0) { b.remove(); return; }
                b.data('life', life);
                b.move(b.data('vx') * dt, b.data('vy') * dt);
            });
        },

        updateEnemies(dt, $) {
            const hero_alive = $('#hero').alive();
            $('.enemy').each((i, e) => {
                if (!e.alive()) return;            // смерть обрабатывает killEnemy
                e.moveTowards('#hero', e.attr('speed') || 60);
                e.flip(e.pos().x > $('#hero').pos().x, false);
                if (!hero_alive || this.state !== 'play') return;
                if (e.distanceTo('#hero') < CONTACT_RANGE) this.hurtPlayer($);
            });
        },

        hurtPlayer($) {
            const hero = $('#hero');
            const before = hero.hp();
            hero.damage(CONTACT_DAMAGE);
            if (hero.hp() === before) return;      // неуязвим или уже мёртв
            hero.invulnerable(IFRAMES_MS);
            $.sound.play(SFX.hurt, { volume: 0.6 });
        },

        killEnemy($, enemy) {
            if (enemy.attr('dead')) return;
            enemy.attr('dead', true);
            this.score += enemy.attr('score') || 10;
            this.kills++;
            enemy.stopAnim().animate(SHEET_DEATH);
            enemy.velocity(0, 0);
            $.sound.play(SFX.die, { volume: 0.5 });
            if (enemy.attr('heavy')) $.sound.play(SFX.boom, { volume: 0.4 });
            // Тело прокрутит анимацию падения и уйдёт из мира.
            enemy.on('animEnd', () => enemy.remove());
        },

        gameOver($) {
            if (this.state !== 'play') return;
            this.state = 'dead';

            const hero = $('#hero');
            hero.velocity(0, 0).stopAnim().animate(MASCOT_DEATH);
            $.camera.shake(14, 450);
            $.sound.play(SFX.boom, { volume: 0.9 });

            $('#over-stats').text(`Очки: ${this.score}   ·   Волна: ${this.wave}   ·   Убито: ${this.kills}`);
            $('#over').show();
            $('#over-title').show();
            $('#over-stats').show();
            $('#over-hint').show();
            $('#btn-restart').show();
            $('#btn-menu').show();
        },

        updateHud($) {
            const hp = Math.max(0, Math.round($('#hero').hp()));
            $.ui.bar('#hp', hp, MAX_HP);
            $('#hp').text(`${hp} / ${MAX_HP}`);
            $('#score').text(`Очки: ${this.score}`);
            $('#wave').text(`Волна ${this.wave}`);
            $('#enemies').text(`Врагов: ${$('.enemy:alive').length + this.to_spawn}`);
        },

        // --- Отрисовка --------------------------------------------------------

        render($) {
            const g = $.gfx;
            const w = this.w;
            const h = this.h;

            // Сетка и рамка арены.
            for (let x = 80; x < w; x += 80) g.draw.line(x, 0, x, h, '#131a26');
            for (let y = 80; y < h; y += 80) g.draw.line(0, y, w, y, '#131a26');
            g.draw.rect(0, 0, w, 6, '#ffd873');
            g.draw.rect(0, h - 6, w, 6, '#ffd873');
            g.draw.rect(0, 0, 6, h, '#ffd873');
            g.draw.rect(w - 6, 0, 6, h, '#ffd873');

            // Укрытия и полоски здоровья врагов.
            $('.cover').each((i, c) => {
                const r = this.screenRect($, c);
                g.draw.rect(r.x, r.y, r.w, r.h, '#2e4462');
            });
            $('.enemy:alive').each((i, e) => {
                // Максимум здоровья у узла не читается через $: держим его в
                // attrs (hp_max) — там же, где остальные параметры врага.
                const max = e.attr('hp_max') || 1;
                if (e.hp() >= max) return;
                const r = this.screenRect($, e);
                const frac = Math.max(0, e.hp() / max);
                g.draw.rect(r.x, r.y - 10, r.w, 5, '#14161e');
                g.draw.rect(r.x, r.y - 10, r.w * frac, 5, '#e65a5a');
            });

            // Трассеры выстрелов.
            $('.tracer').each((i, b) => {
                const p = this.toScreen($, b.pos());
                const vx = b.data('vx');
                const vy = b.data('vy');
                const len = Math.hypot(vx, vy) || 1;
                g.draw.line(p.x, p.y, p.x - (vx / len) * 18, p.y - (vy / len) * 18, '#ffd873', 3);
                g.draw.circle(p.x, p.y, 4, '#fff6cf');
            });

            // Вспышка выстрела и прицел.
            const hero = $('#hero');
            if (this.muzzle > 0 && hero.length) {
                const p = this.toScreen($, hero.pos());
                const a = this.toScreen($, this.aim);
                const dx = a.x - p.x;
                const dy = a.y - p.y;
                const d = Math.hypot(dx, dy) || 1;
                g.draw.circle(p.x + (dx / d) * 34, p.y + (dy / d) * 34, 11, '#fff2b8');
            }
            const m = $.input.mouse();
            g.draw.line(m.x - 12, m.y, m.x + 12, m.y, '#ffd873');
            g.draw.line(m.x, m.y - 12, m.x, m.y + 12, '#ffd873');
            g.draw.circle(m.x, m.y, 3, '#ffffff');
        },

        // --- Прослойки над $ --------------------------------------------------

        /**
         * Узел, в чьё тело попал луч.
         *
         * $.world.raycast() сейчас отдаёт только id тела: карта «тело → узел»
         * внутри $.world не заполняется, поэтому hit.node всегда null. Пока
         * это так, узел ищем сами — по id тела среди узлов мира.
         */
        nodeOfHit($, hit) {
            if (!hit) return null;
            if (hit.node) return $(hit.node);
            if (!(hit.body >= 0)) return null;
            const node = $.world.all().toArray().find((n) => n.body === hit.body);
            return node ? $(node) : null;
        },

        toScreen($, point) { return $.camera.worldToScreen(point); },

        screenRect($, node) {
            const p = this.toScreen($, node.pos());
            const zoom = $.camera.zoom();
            const s = nodeSize(node);
            return { x: p.x - (s.w * zoom) / 2, y: p.y - (s.h * zoom) / 2, w: s.w * zoom, h: s.h * zoom };
        },
    });
}
