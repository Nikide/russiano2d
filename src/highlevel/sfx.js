// ===========================================================================
// Звуковая часть удара: $.sfx — то, что СЛЫШНО.
//
// Разделение пространств (task-69, §F docs/VFX_ROADMAP.md):
//   * что слышно → `$.sfx` (этот модуль);
//   * что видно  → `$.vfx` (vfx.js, r2dvfx).
//
// `$.sfx` не рисует ничего и не знает визуальных имён: здесь только звук.
// Пресеты попадания — ОДИН реестр с `$.hits` (объект hits.js), чтобы у удара
// не появилось двух описаний. `$.sfx.presets()` просто читает его.
//
//   $.sfx.play('hit.metal');                    // имя банка → playBank
//   $.sfx.play('crit');                         // пресет $.hits → его sound
//   $.sfx.play('sfx/step.wav', { volume: 0.4 }); // путь → $.sound.play
//   $.sfx.bank('step.wood', ['a.wav', 'b.wav']);
//   $.sfx.playBank('step.wood', { pitchRange: 0.1 });
//
// Звук не дублируется: `playBank` — это `$.sound.playBank`, `play(путь)` —
// `$.sound.play`; модуль только раскладывает три случая по правильному пути.
// ===========================================================================

import { ctx } from './core.js';

/** Пресет без звука — не повод падать, но и не повод молчать. */
function report(where, message, code, extra) {
    const $ = ctx.$;
    const debug = $ && $.debug;
    const data = Object.assign({ subsystem: 'sfx' }, extra || {});
    if (debug && typeof debug.reportError === 'function') {
        debug.reportError(where, message, {
            code, subsystem: 'sfx', recoverable: true, data,
        });
    } else {
        ctx.log('$: ' + message);
    }
}

/** Подсистема `$.sfx`: play/presets/bank/playBank. */
export function installSfx($) {
    // Ссылка на $ нужна и без глобального ctx.$ (юнит-тесты): модуль
    // импортируется без движка.
    const api = $;

    function root() {
        return api || ctx.$;
    }

    function hits() {
        const r = root();
        return r && r.hits ? r.hits : (ctx.hits || null);
    }

    function sound() {
        const r = root();
        if (r && r.sound) return r.sound;
        return ctx.sound || null;
    }

    const sfx = {
        /**
         * Сыграть звук. Три случая, в этом порядке:
         *
         * 1. `opts.bank` задан или имя зарегистрировано как банк
         *    (`$.sound.bankNames()`) → `$.sfx.playBank(name, opts)`;
         * 2. имя — пресет `$.hits` → играется его `sound` (если он пуст,
         *    это громкий отказ `R2D_SFX_PRESET_SILENT`, а не тишина);
         * 3. иначе имя считается путём/именем звука → `$.sound.play`.
         *
         * Возвращает то, что вернул звуковой слой: канал, имя файла банка или
         * `-1`/`null` при отказе.
         */
        play(what, opts) {
            const o = opts || {};
            const s = sound();
            if (!s || typeof s.play !== 'function') {
                report('$.sfx.play', '$.sfx.play: звуковой подсистемы нет ' +
                       '(сборка без аудио?)', 'R2D_SFX_UNAVAILABLE');
                return -1;
            }
            if (what === undefined || what === null || what === '') {
                report('$.sfx.play', '$.sfx.play: не задано имя звука/пресета/банка',
                       'R2D_SFX_NO_TARGET');
                return -1;
            }
            const key = String(what);
            const banks = (typeof s.bankNames === 'function') ? s.bankNames() : [];
            if (o.bank !== undefined) return sfx.playBank(String(o.bank), o);
            if (banks.indexOf(key) >= 0) return sfx.playBank(key, o);

            const h = hits();
            if (h && typeof h.presets === 'function' && h.presets().indexOf(key) >= 0) {
                const spec = (typeof h.spec === 'function') ? h.spec(key, null) : null;
                const name = spec && spec.sound;
                if (!name) {
                    report('$.sfx.play', `$.sfx.play("${key}"): у пресета нет поля sound — ` +
                           'включите его ($.hits.preset) или зовите путь/банк',
                           'R2D_SFX_PRESET_SILENT', { preset: key });
                    return -1;
                }
                try {
                    return s.play(name, o);
                } catch (e) {
                    report('$.sfx.play', `$.sfx.play("${key}"): ${e && e.message ? e.message : e}`,
                           'R2D_SFX_PLAY_FAILED', { preset: key });
                    return -1;
                }
            }
            try {
                return s.play(what, o);
            } catch (e) {
                report('$.sfx.play', `$.sfx.play("${key}"): ${e && e.message ? e.message : e}`,
                       'R2D_SFX_PLAY_FAILED', { sound: key });
                return -1;
            }
        },

        /**
         * Имена пресетов попадания — ОДИН реестр с `$.hits` (никакой копии:
         * иначе пресет удара разъедется с его звуком).
         */
        presets() {
            const h = hits();
            return (h && typeof h.presets === 'function') ? h.presets() : [];
        },

        /** Задать/дополнить пресет: `$.sfx.preset('punch', { sound: 'hit.wav' })`. */
        preset(name, spec) {
            const h = hits();
            if (!h || typeof h.preset !== 'function') {
                report('$.sfx.preset', '$.sfx.preset: нет $.hits (модуль ударов не установлен)',
                       'R2D_SFX_UNAVAILABLE');
                return sfx;
            }
            h.preset(name, spec);
            return sfx;
        },

        /**
         * Описать банк звуков: `$.sfx.bank('step.wood', ['a.wav', 'b.wav'])`.
         * Тонкая обёртка над `$.sound.bank`/`defineBank`; возвращает имя банка
         * или `null`, если список пуст.
         */
        bank(name, filesOrSpec) {
            const s = sound();
            if (!s) {
                report('$.sfx.bank', '$.sfx.bank: звуковой подсистемы нет',
                       'R2D_SFX_UNAVAILABLE');
                return null;
            }
            if (s.bank && typeof s.bank.define === 'function') {
                return s.bank.define(name, filesOrSpec);
            }
            if (typeof s.defineBank === 'function') {
                return s.defineBank(name, filesOrSpec);
            }
            report('$.sfx.bank', '$.sfx.bank: в сборке нет банков звука (installSoundBank)',
                   'R2D_SFX_UNAVAILABLE');
            return null;
        },

        /**
         * Сыграть из банка: `$.sfx.playBank('hit.metal', { pitchRange: 0.9 })`.
         * Возвращает имя выбранного файла или `null` (банка нет / интервал не
         * прошёл). Отсутствие банка — запись `R2D_SFX_UNKNOWN_BANK`, не тишина.
         */
        playBank(name, opts) {
            const s = sound();
            if (!s || typeof s.playBank !== 'function') {
                report('$.sfx.playBank', '$.sfx.playBank: в сборке нет банков звука',
                       'R2D_SFX_UNAVAILABLE');
                return null;
            }
            const key = String(name);
            const known = (typeof s.bankNames === 'function')
                ? s.bankNames().indexOf(key) >= 0 : true;
            if (!known) {
                report('$.sfx.playBank', `$.sfx.playBank("${key}"): нет такого банка — ` +
                       'объявите $.sfx.bank(name, files)', 'R2D_SFX_UNKNOWN_BANK',
                       { bank: key });
                return null;
            }
            return s.playBank(key, opts);
        },
    };

    ctx.sfx = sfx;
    $.sfx = sfx;
    return sfx;
}
