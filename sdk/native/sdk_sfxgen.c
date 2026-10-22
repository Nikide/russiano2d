// ===========================================================================
// r2d sfx-gen <spec.json> — генерация звуковых эффектов для агентов и скриптов.
//
// Конвейер: описание словами или пресет → дескриптор R2D SFX → процедурный синтез → WAV.
//
// Спецификация (JSON):
//   text    — описание словами («короткий высокий прыжок», «big explosion»); выбирает пресет и подкручивает его
//   preset  — coin | laser | explosion | powerup | hurt | jump | blip | random (если нет text)
//   from    — .rfx файл как основа (формат rFXGen)
//   seed    — целое: другой seed — другой вариант того же типа звука
//   mutate  — 0..1: случайная вариация поверх
//   params  — переопределения полей дескриптора: wave ("square"|"saw"|"sine"|"noise"), attack, sustain, punch, decay,
//             freq, minFreq, slide, deltaSlide, vibratoDepth, vibratoSpeed, changeAmount, changeSpeed, duty, dutySweep,
//             repeat, phaserOffset, phaserSweep, lpf, lpfSweep, lpfResonance, hpf, hpfSweep, volume (0..1)
//   out     — куда записать WAV (44100 Гц, моно, 16 бит); rfx — куда записать дескриптор в формате .rfx
//
// Ответ — JSON: параметры (дескриптор), длительность, пик, rms, оценка высоты тона, огибающая по 24 долям
// и ASCII-график: так результат проверяет модель без слуха.
// ===========================================================================
#include "sdk.h"
#include "json.h"
#include "sfxgen.h"

#include <SDL3/SDL.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static int fail(const char *code, const char *msg)
{
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":false,\"code\":");
    r2d_sb_put_json_string(&out, code);
    r2d_sb_puts(&out, ",\"message\":");
    r2d_sb_put_json_string(&out, msg);
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    return 2;
}

static void make_parent(const char *path)
{
    char dir[2048];
    sdk_dirname(path, dir, sizeof dir);
    if (dir[0]) SDL_CreateDirectory(dir);
}

int sdk_cmd_sfx_gen(const SdkArgs *a)
{
    const char *spec_path = sdk_arg_positional(a, 0);
    if (!spec_path || !spec_path[0]) return fail("SDK_USAGE", "r2d sfx-gen <spec.json>");
    size_t size = 0;
    char *text = sdk_read_file(spec_path, &size);
    if (!text) return fail("SDK_SFX_SPEC", "не удалось прочитать спецификацию");
    char err[160];
    R2dJson *spec = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!spec || spec->type != R2D_JSON_OBJ) { r2d_json_free(spec); return fail("SDK_SFX_SPEC", "спецификация — не JSON-объект"); }

    static char msg[260];
    int rc = 2;
    int16_t *pcm = NULL;
    R2DSfx fx;
    r2d_sfx_defaults(&fx);
    const uint32_t seed = (uint32_t)r2d_json_int(r2d_json_get(spec, "seed"), 1);
    const char *words = r2d_json_str(r2d_json_get(spec, "text"), "");
    const char *preset = r2d_json_str(r2d_json_get(spec, "preset"), "");
    const char *from = r2d_json_str(r2d_json_get(spec, "from"), "");
    const char *picked = NULL;

    if (from[0]) {
        if (r2d_sfx_load_rfx(from, &fx) != 0) { snprintf(msg, sizeof msg, "from: не удалось прочитать .rfx «%s»", from); goto done; }
        picked = "rfx";
    } else if (words[0]) {
        picked = r2d_sfx_from_text(&fx, words, seed);
        if (!picked) {
            snprintf(msg, sizeof msg, "text: не понял, какой это звук. Назовите тип: монета/coin, выстрел/laser, взрыв/explosion, бонус/powerup, удар/hurt, прыжок/jump, клик/blip — или задайте preset/params");
            goto done;
        }
    } else if (preset[0]) {
        if (r2d_sfx_preset(&fx, preset, seed) != 0) {
            snprintf(msg, sizeof msg, "preset: нет «%s». Есть:", preset);
            for (int i = 0; i < r2d_sfx_preset_count(); ++i) { strncat(msg, " ", sizeof msg - strlen(msg) - 1); strncat(msg, r2d_sfx_preset_name(i), sizeof msg - strlen(msg) - 1); }
            goto done;
        }
        picked = preset;
    } else if (!r2d_json_get(spec, "params")) {
        snprintf(msg, sizeof msg, "нужен text, preset, from или params");
        goto done;
    }
    fx.seed = seed ? seed : 1;
    const double mut = r2d_json_num(r2d_json_get(spec, "mutate"), 0.0);
    if (mut > 0.0) r2d_sfx_mutate(&fx, seed + 101u, (float)mut);

    const R2dJson *params = r2d_json_get(spec, "params");
    if (params && params->type == R2D_JSON_OBJ) {
        int nf = 0;
        const R2DSfxField *fields = r2d_sfx_fields(&nf);
        for (int i = 0; i < params->count; ++i) {
            const char *k = params->keys[i];
            const R2dJson *v = params->items[i];
            if (!strcmp(k, "wave")) {
                int w = v->type == R2D_JSON_NUM ? (int)v->number : r2d_sfx_wave_from_name(r2d_json_str(v, ""));
                if (w < 0 || w > 3) { snprintf(msg, sizeof msg, "params.wave: square, saw, sine или noise"); goto done; }
                fx.wave = w;
                continue;
            }
            if (!strcmp(k, "seed")) { fx.seed = (uint32_t)r2d_json_int(v, 1); continue; }
            int found = 0;
            for (int f = 0; f < nf; ++f) {
                if (strcmp(fields[f].name, k)) continue;
                if (v->type != R2D_JSON_NUM) { snprintf(msg, sizeof msg, "params.%s: нужно число %g…%g", k, fields[f].lo, fields[f].hi); goto done; }
                *(float *)((char *)&fx + fields[f].offset) = (float)v->number;
                found = 1;
                break;
            }
            if (!found) { snprintf(msg, sizeof msg, "params.%s: нет такого поля дескриптора", k); goto done; }
        }
    }
    r2d_sfx_clamp(&fx);

    pcm = (int16_t *)malloc(r2d_sfx_max_samples() * sizeof(int16_t));
    if (!pcm) { snprintf(msg, sizeof msg, "нет памяти"); goto done; }
    const size_t n = r2d_sfx_render(&fx, pcm, r2d_sfx_max_samples());
    if (n == 0) { snprintf(msg, sizeof msg, "синтез дал тишину: проверьте огибающую (sustain/decay) и freq"); goto done; }

    const char *out_path = r2d_json_str(r2d_json_get(spec, "out"), "");
    if (out_path[0]) make_parent(out_path);
    if (out_path[0] && r2d_sfx_write_wav(out_path, pcm, n) != 0) { snprintf(msg, sizeof msg, "не удалось записать WAV (out)"); goto done; }
    const char *rfx_path = r2d_json_str(r2d_json_get(spec, "rfx"), "");
    if (rfx_path[0]) make_parent(rfx_path);
    if (rfx_path[0] && r2d_sfx_save_rfx(rfx_path, &fx) != 0) { snprintf(msg, sizeof msg, "не удалось записать .rfx"); goto done; }

    R2DSfxStats st;
    r2d_sfx_analyze(pcm, n, &st);
    R2dSb o; r2d_sb_init(&o);
    r2d_sb_printf(&o, "{\"ok\":true,\"seconds\":%.3f,\"samples\":%zu,\"rate\":%d,\"peak\":%.3f,\"rms\":%.3f,\"clipped\":%d,\"pitchHz\":%.0f",
                  st.seconds, st.samples, R2D_SFX_RATE, st.peak, st.rms, st.clipped, st.freq_hz);
    if (picked) { r2d_sb_puts(&o, ",\"preset\":"); r2d_sb_put_json_string(&o, picked); }
    if (out_path[0]) { r2d_sb_puts(&o, ",\"out\":"); r2d_sb_put_json_string(&o, out_path); }
    if (rfx_path[0]) { r2d_sb_puts(&o, ",\"rfx\":"); r2d_sb_put_json_string(&o, rfx_path); }
    r2d_sb_puts(&o, ",\"params\":{\"wave\":");
    r2d_sb_put_json_string(&o, r2d_sfx_wave_name(fx.wave));
    {
        int nf = 0;
        const R2DSfxField *fields = r2d_sfx_fields(&nf);
        for (int f = 0; f < nf; ++f) {
            r2d_sb_putc(&o, ','); r2d_sb_put_json_string(&o, fields[f].name); r2d_sb_putc(&o, ':');
            r2d_sb_put_json_number(&o, roundf(*(const float *)((const char *)&fx + fields[f].offset) * 1000.0f) / 1000.0);
        }
    }
    r2d_sb_printf(&o, ",\"seed\":%u}", (unsigned)fx.seed);
    // ASCII-огибающая: 6 строк × 24 столбца — видно форму звука (атака, затухание, обрыв).
    r2d_sb_puts(&o, ",\"envelope\":[");
    for (int row = 0; row < 6; ++row) {
        char line[25];
        const float level = (float)(6 - row) / 6.0f;
        for (int c = 0; c < 24; ++c) line[c] = st.env[c] >= level - 0.0001f ? '#' : (st.env[c] >= level - 1.0f / 6.0f ? '.' : ' ');
        line[24] = 0;
        if (row) r2d_sb_putc(&o, ',');
        r2d_sb_put_json_string(&o, line);
    }
    r2d_sb_puts(&o, "]}");
    printf("%s\n", o.data);
    r2d_sb_free(&o);
    rc = 0;

done:
    free(pcm);
    r2d_json_free(spec);
    if (rc != 0) return fail("SDK_SFX", msg[0] ? msg : "ошибка");
    return rc;
}
