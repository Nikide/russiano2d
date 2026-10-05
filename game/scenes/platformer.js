// ===========================================================================
// Уровень-платформер на высокоуровневом API.
//
// Уровень задан ASCII-картой: одна клетка = тайл 32x32 пикселя.
//   #  кирпич (статичное тело)      C  ящик (динамическое тело)
//   o  монета (подбирается)          E  враг-патрульный
//   P  точка появления игрока        .  пусто
//
// Что показывает: Box2D, встроенное управление (.controls), подбор предметов,
// события узлов, HUD из узлов <ui.*>, пауза, победа, сохранение результата.
// ===========================================================================

const TILE = 32;
const LEVEL = [
    '........................................',
    '........................................',
    '..........o.o.o.o.......................',
    '........##########......................',
    '..............................o.o.......',
    '...........................########.....',
    '....o.o.................................',
    '..######................................',
    '......................C.................',
    '.........o.......######.................',
    '.......######..........................E',
    '......................o.o.o.............',
    '.##...........................####......',
    '.##..........E..........................',
    '...........######.......................',
    '........................................',
    '....P.......................o.o.o.......',
    '..####....####....####....########......',
    '########################################',
    '########################################',
];

// Кадры атласа: полоса 4 тайла по 32 пикселя (tools/make_atlas.py).
const ATLAS = { src: 'assets/atlas.png', cols: 4, rows: 1, cw: TILE, ch: TILE };

export default function installLevel($) {
    $.scene.add('platformer', {
        enter($) {
            this.dead = false;
            this.won = false;

            $.world.gravity(0, 1800).color('#141824')
                   .bounds(-160, -320, LEVEL[0].length * TILE + 320, LEVEL.length * TILE + 320);

            const total_coins = this.buildLevel($);
            this.total_coins = total_coins;
            this.coins = total_coins;

            this.buildHud($);

            $.camera.follow('#hero', { smooth: 0.15, offset: [0, -60] });
            $.sound.music('assets/audio/music/action.ogg', { loop: true, volume: 0.25 });
        },

        exit() {
            $.sound.stopMusic(300);
        },

        /** Строит уровень по ASCII-карте. Возвращает число монет. */
        buildLevel($) {
            let coins = 0;

            LEVEL.forEach((row, ty) => {
                for (let tx = 0; tx < row.length; tx++) {
                    const cell = row[tx];
                    const x = tx * TILE + TILE / 2;
                    const y = ty * TILE + TILE / 2;

                    if (cell === '#') {
                        $('<wall>', { class: 'brick' }).at(x, y).size(TILE, TILE)
                            .sprite({ ...ATLAS }).frame(1)
                            .appendTo($.world);
                    } else if (cell === 'C') {
                        $('<rect>', { class: 'crate' }).at(x, y).size(TILE, TILE)
                            .body('dynamic').sprite({ ...ATLAS }).frame(2)
                            .attr({ density: 0.8, friction: 0.5 })
                            .appendTo($.world);
                    } else if (cell === 'o') {
                        coins++;
                        $('<sprite>', { class: 'coin' }).at(x, y).size(18, 18)
                            .sprite({ ...ATLAS }).frame(3)
                            .appendTo($.world)
                            .on('pickup', (e) => {
                                $.sound.playAt('assets/audio/sfx/pickup_01.ogg', e.self);
                                e.self.remove();
                                this.collectCoin($);
                            });
                    } else if (cell === 'E') {
                        $('<enemy>', { class: 'walker' }).at(x, y).size(28, 30)
                            .sprite({ ...ATLAS }).frame(0)
                            .color('#ff8b6b')
                            .appendTo($.world)
                            .attr('dir', 1);
                    } else if (cell === 'P') {
                        $('<player>', { id: 'hero' }).at(x, y).size(26, 30)
                            .sprite({ ...ATLAS }).frame(0)
                            .health(100).controls('both').collision(26, 30)
                            .attr({ jumpForce: 700 })
                            .appendTo($.world)
                            .on('hit', (e) => {
                                $.camera.shake(5, 200);
                                e.self.flash('#ff5555', 150);
                            })
                            .on('death', () => {
                                this.dead = true;
                                $.sound.play('assets/audio/sfx/hurt_01.ogg', { volume: 0.9 });
                            });
                    }
                }
            });

            return coins;
        },

        buildHud($) {
            $('<ui.panel>', { id: 'hud-bg' }).at(150, 34).size(260, 52).appendTo($.ui);
            $('<ui.label>', { id: 'hud-hp', size: 18, color: '#e8f0ff' })
                .at(30, 22).appendTo($.ui);
            $('<ui.label>', { id: 'hud-coins', size: 18, color: '#ffd54a' })
                .at(30, 46).appendTo($.ui);

            $('<ui.panel>', { id: 'overlay' }).at(640, 360).size(1280, 720)
                .color('#000000cc').appendTo($.ui).hide();
            $('<ui.label>', { id: 'overlay-text', size: 40, color: '#ffffff' })
                .at(640, 330).appendTo($.ui).hide();
            $('<ui.label>', { id: 'overlay-hint', size: 20, color: '#9fb3cc' })
                .at(640, 390).appendTo($.ui).hide();
        },

        collectCoin($) {
            this.coins--;
            if (this.coins <= 0 && !this.won) {
                this.won = true;
                const best = $.store.get('best', 0);
                if (this.total_coins > best) $.store.set('best', this.total_coins);
                $.sound.play('assets/audio/sfx/pickup_01.ogg', { volume: 1 });
            }
        },

        showOverlay($, title, hint) {
            $('#overlay').show();
            $('#overlay-text').show().text(title);
            $('#overlay-hint').show().text(hint);
        },

        update(dt, $) {
            const hero = $('#hero');

            // HUD.
            $('#hud-hp').text(`Здоровье: ${Math.max(0, Math.round(hero.hp()))}`);
            $('#hud-coins').text(`Монет: ${this.coins} из ${this.total_coins}`);

            // Патрулирующие враги: идут в свою сторону и разворачиваются у стены.
            $('.walker').each((i, e) => {
                if (!e.alive()) { e.remove(); return; }
                if (e.onWall()) e.attr('dir', -e.attr('dir'));
                e.velocity(e.attr('dir') * 45, e.velocity().y);
                e.flip(e.attr('dir') < 0, false);

                // Касание вредит один раз за кадр: врагов много, а урон должен
                // быть один. Счётчик кадров берём из самого $.
                if (e.distanceTo('#hero') < 34 && e.attr('touch-ok') !== $.time.frame()) {
                    e.attr('touch-ok', $.time.frame());
                    $('#hero').damage(10);
                }
            });

            // Монеты подбираются при близком касании.
            $('.coin').each((i, c) => {
                if (c.distanceTo('#hero') < 30) c.emit('pickup');
            });

            // Управление паузой и экранами.
            if ($.input.pressed('escape')) {
                if (this.dead || this.won) { this.restartOrExit($); return; }
                if ($.time.isPaused()) {
                    $.time.resume();
                    $('#overlay').hide(); $('#overlay-text').hide(); $('#overlay-hint').hide();
                } else {
                    $.time.pause();
                    this.showOverlay($, 'Пауза', 'Esc — продолжить');
                }
            }

            if ((this.dead || this.won) && $.input.pressed('enter')) {
                $.scene.load('menu');
            }

            if (this.dead) this.showOverlay($, 'Вы проиграли', 'Enter — в меню');
            else if (this.won) this.showOverlay($, 'Победа!', 'Enter — в меню');

            // Камера не должна уезжать за пределы уровня.
            $.camera.limits(0, 0, LEVEL[0].length * TILE, LEVEL.length * TILE);
        },

        restartOrExit($) {
            if ($.time.isPaused()) $.time.resume();
            $.scene.load('menu');
        },
    });
}
