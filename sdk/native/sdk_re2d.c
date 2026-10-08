// ===========================================================================
// Re2DSprite: проверка `*.character.json` и анимаций, команды re2d-info /
// re2d-debug / re2d-sample.
//
// Правила — зеркало рантайма (`validateRotDefinition`, `validateRotAnimations`
// в src/highlevel/rotsprite.js): всё, что рантайм отвергает, здесь ошибка с
// кодом, всё, что он принимает, — не ошибка. Паритет проверяет
// tests/agent/sdk_re2dsprite_test.py, который гоняет оба валидатора на
// одинаковых правках. QuickJS в инструментах SDK запрещён, поэтому правила
// продублированы в C — это осознанная цена (docs/SDK.md §1).
// ===========================================================================
#include "sdk_re2d.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Ctx {
    const char *asset;
    SdkReport  *rep;
} Ctx;

static const char *const FACE_EYES[] = { "open", "half", "closed", "happy", NULL };
static const char *const FACE_MOUTH[] = { "closed", "open", "smile", "talk", NULL };
static const char *const FACE_BROWS[] = { "neutral", "angry", "sad", "surprised", NULL };

static const char *const *face_values(const char *key)
{
    if (strcmp(key, "eyes") == 0) return FACE_EYES;
    if (strcmp(key, "mouth") == 0) return FACE_MOUTH;
    if (strcmp(key, "brows") == 0) return FACE_BROWS;
    return NULL;
}

static bool in_list(const char *const *list, const char *v)
{
    for (int i = 0; list && list[i]; ++i) if (strcmp(list[i], v) == 0) return true;
    return false;
}

static void E(Ctx *c, const char *code, const char *where, const char *fmt, ...)
{
    char msg[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    R2dSb loc;
    r2d_sb_init(&loc);
    r2d_sb_puts(&loc, "{\"path\":");
    r2d_sb_put_json_string(&loc, where ? where : "");
    r2d_sb_putc(&loc, '}');
    sdk_diag(c->rep, SDK_ERROR, code, c->asset, loc.data, NULL, "%s", msg);
    r2d_sb_free(&loc);
}

static void W(Ctx *c, const char *code, const char *where, const char *fmt, ...)
{
    char msg[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    R2dSb loc;
    r2d_sb_init(&loc);
    r2d_sb_puts(&loc, "{\"path\":");
    r2d_sb_put_json_string(&loc, where ? where : "");
    r2d_sb_putc(&loc, '}');
    sdk_diag(c->rep, SDK_WARNING, code, c->asset, loc.data, NULL, "%s", msg);
    r2d_sb_free(&loc);
}

// --- Примитивы рантайма ----------------------------------------------------
static bool is_num(const R2dJson *v) { return v && v->type == R2D_JSON_NUM; }
static bool finite_num(const R2dJson *v) { return is_num(v) && isfinite(v->number) && fabs(v->number) <= 1e6; }
static bool present(const R2dJson *v) { return v && v->type != R2D_JSON_NULL; }

static bool name_ok(const R2dJson *v)
{
    if (!v || v->type != R2D_JSON_STR || !v->string || !v->string[0] || strlen(v->string) > 80) return false;
    return strcmp(v->string, "__proto__") != 0 && strcmp(v->string, "constructor") != 0 && strcmp(v->string, "prototype") != 0;
}

static bool vector_ok(const R2dJson *v)
{
    if (!v || v->type != R2D_JSON_ARR || v->count != 3) return false;
    for (int i = 0; i < 3; ++i) if (!finite_num(v->items[i])) return false;
    return true;
}

// Необязательный вектор из трёх конечных чисел (отсутствует/null — допустимо).
static void check_vector(Ctx *c, const R2dJson *obj, const char *key, const char *base)
{
    const R2dJson *v = r2d_json_get(obj, key);
    if (!present(v)) return;
    if (!vector_ok(v)) {
        char where[160];
        snprintf(where, sizeof where, "%s.%s", base, key);
        E(c, "SDK_RE2D_VECTOR", where, "%s: нужны три конечных числа", where);
    }
}

static void check_name(Ctx *c, const R2dJson *v, const char *where)
{
    if (!name_ok(v)) E(c, "SDK_RE2D_NAME", where, "%s: имя — непустая строка до 80 символов (не __proto__/constructor/prototype)", where);
}

// ---------------------------------------------------------------------------
// Пути: относительно JSON модели, как relativeAsset рантайма (но по настоящей ФС)
// ---------------------------------------------------------------------------
static void resolve_asset(const char *model_path, const char *rel, char *out, size_t cap)
{
    char joined[2048];
    if (rel[0] == '/' || (strlen(rel) > 1 && rel[1] == ':')) {
        snprintf(joined, sizeof joined, "%s", rel);
    } else {
        char dir[1536];
        sdk_dirname(model_path, dir, sizeof dir);
        sdk_join(dir, rel, joined, sizeof joined);
    }
    // Сворачиваем «.» и «..».
    char *parts[128];
    int n = 0;
    char buf[2048];
    snprintf(buf, sizeof buf, "%s", joined);
    const bool abs = buf[0] == '/';
    char *save = NULL;
    for (char *tok = strtok_r(buf, "/", &save); tok && n < 128; tok = strtok_r(NULL, "/", &save)) {
        if (strcmp(tok, ".") == 0 || !tok[0]) continue;
        if (strcmp(tok, "..") == 0 && n > 0 && strcmp(parts[n - 1], "..") != 0) { --n; continue; }
        parts[n++] = tok;
    }
    out[0] = '\0';
    if (abs) strncat(out, "/", cap - 1);
    for (int i = 0; i < n; ++i) {
        if (i) strncat(out, "/", cap - strlen(out) - 1);
        strncat(out, parts[i], cap - strlen(out) - 1);
    }
}

// ---------------------------------------------------------------------------
// Анимации (зеркало validateRotAnimations)
// ---------------------------------------------------------------------------
static bool regex_channel(const char *s)
{
    // ^(rotation|translation)\.[xyz]$
    const char *dot = strchr(s, '.');
    if (!dot || dot[2] != '\0') return false;
    const size_t head = (size_t)(dot - s);
    if (!((head == 8 && strncmp(s, "rotation", 8) == 0) || (head == 11 && strncmp(s, "translation", 11) == 0))) return false;
    return dot[1] == 'x' || dot[1] == 'y' || dot[1] == 'z';
}

static void validate_animations(Ctx *c, const R2dJson *a, const R2dJson *bones, int *clip_count, char clip_names[64][81])
{
    *clip_count = 0;
    const R2dJson *clips = r2d_json_get(a, "clips");
    if (!a || a->type != R2D_JSON_OBJ || !is_num(r2d_json_get(a, "version")) || r2d_json_get(a, "version")->number != 1 ||
        !clips || clips->type != R2D_JSON_OBJ || clips->count > 64) {
        E(c, "SDK_RE2D_ANIM_ROOT", "animations", "Анимации: version=1 и clips — объект не более чем с 64 клипами");
        return;
    }
    for (int i = 0; i < clips->count; ++i) {
        const R2dJson *clip = clips->items[i];
        char where[200];
        snprintf(where, sizeof where, "clips.%s", clips->keys[i]);
        if (*clip_count < 64) snprintf(clip_names[(*clip_count)++], 81, "%s", clips->keys[i]);
        if (!clips->keys[i][0] || strlen(clips->keys[i]) > 80 || strcmp(clips->keys[i], "__proto__") == 0 ||
            strcmp(clips->keys[i], "constructor") == 0 || strcmp(clips->keys[i], "prototype") == 0) {
            E(c, "SDK_RE2D_NAME", where, "Имя клипа «%s» недопустимо", clips->keys[i]);
        }
        const R2dJson *dur = r2d_json_get(clip, "duration");
        const R2dJson *loop = r2d_json_get(clip, "loop");
        const R2dJson *tracks = r2d_json_get(clip, "tracks");
        if (!finite_num(dur) || dur->number <= 0) {
            E(c, "SDK_RE2D_ANIM_CLIP", where, "Клип «%s»: duration — конечное число > 0", clips->keys[i]);
            continue;
        }
        if (!loop || loop->type != R2D_JSON_BOOL || !tracks || tracks->type != R2D_JSON_ARR || tracks->count > 256) {
            E(c, "SDK_RE2D_ANIM_CLIP", where, "Клип «%s»: нужны loop (true/false) и tracks (до 256)", clips->keys[i]);
            continue;
        }
        const double duration = dur->number;
        char used[256][180];
        int nused = 0;
        for (int t = 0; t < tracks->count; ++t) {
            const R2dJson *tr = tracks->items[t];
            char tw[260];
            snprintf(tw, sizeof tw, "%s.tracks[%d]", where, t);
            const char *target = r2d_json_str(r2d_json_get(tr, "target"), "");
            const char *channel = r2d_json_str(r2d_json_get(tr, "channel"), "");
            const bool face = strcmp(target, "face") == 0;
            bool bone_ok = false;
            for (int b = 0; bones && b < bones->count; ++b) {
                if (strcmp(r2d_json_str(r2d_json_get(bones->items[b], "name"), ""), target) == 0) { bone_ok = true; break; }
            }
            const bool channel_ok = face ? face_values(channel) != NULL : regex_channel(channel);
            if (!(face || bone_ok) || !channel_ok) {
                E(c, "SDK_RE2D_ANIM_TRACK", tw, "Трек: цель «%s» должна быть face или кость, канал «%s» — rotation|translation.x|y|z (для face — eyes|mouth|brows)", target, channel);
                continue;
            }
            char id[180];
            snprintf(id, sizeof id, "%s:%s", target, channel);
            bool dup = false;
            for (int u = 0; u < nused; ++u) if (strcmp(used[u], id) == 0) { dup = true; break; }
            if (dup) { E(c, "SDK_RE2D_ANIM_DUPLICATE", tw, "Повтор трека %s в клипе «%s»", id, clips->keys[i]); continue; }
            if (nused < 256) snprintf(used[nused++], 180, "%s", id);

            const char *interp = r2d_json_str(r2d_json_get(tr, "interpolation"), face ? "step" : "linear");
            if ((strcmp(interp, "linear") != 0 && strcmp(interp, "step") != 0) || (face && strcmp(interp, "step") != 0)) {
                E(c, "SDK_RE2D_ANIM_INTERPOLATION", tw, "interpolation: linear или step (у face — только step)");
            }
            const R2dJson *keys = r2d_json_get(tr, "keys");
            if (!keys || keys->type != R2D_JSON_ARR || keys->count < 1 || keys->count > 1024) {
                E(c, "SDK_RE2D_ANIM_KEYS", tw, "keys: от 1 до 1024 ключей [время, значение]");
                continue;
            }
            double previous = -1;
            for (int k = 0; k < keys->count; ++k) {
                const R2dJson *key = keys->items[k];
                char kw[300];
                snprintf(kw, sizeof kw, "%s.keys[%d]", tw, k);
                if (!key || key->type != R2D_JSON_ARR || key->count != 2) { E(c, "SDK_RE2D_ANIM_KEYS", kw, "Ключ — пара [время, значение]"); break; }
                if (!finite_num(key->items[0])) { E(c, "SDK_RE2D_ANIM_KEY_TIME", kw, "Время ключа — конечное число"); break; }
                const double time = key->items[0]->number;
                if (time < 0 || time > duration || time <= previous) {
                    char d[128];
                    snprintf(d, sizeof d, "{\"time\":%g,\"duration\":%g,\"previous\":%g}", time, duration, previous);
                    sdk_diag(c->rep, SDK_ERROR, "SDK_RE2D_ANIM_KEY_ORDER", c->asset, NULL, d,
                             "%s: время %g должно строго возрастать в 0..%g (предыдущее %g)", kw, time, duration, previous);
                    break;
                }
                previous = time;
                if (face) {
                    const char *value = key->items[1] && key->items[1]->type == R2D_JSON_STR ? key->items[1]->string : "";
                    if (!in_list(face_values(channel), value)) { E(c, "SDK_RE2D_ANIM_KEY_VALUE", kw, "Значение «%s» недопустимо для face.%s", value, channel); break; }
                } else if (!finite_num(key->items[1])) {
                    E(c, "SDK_RE2D_ANIM_KEY_VALUE", kw, "Значение ключа — конечное число");
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Описание модели (зеркало validateRotDefinition + from())
// ---------------------------------------------------------------------------
void sdk_validate_re2d_character(const char *path, SdkReport *rep)
{
    Ctx cx = { path, rep };
    Ctx *c = &cx;
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return;
    if (root->type != R2D_JSON_OBJ) {
        E(c, "SDK_RE2D_ROOT", "", "Корень описания должен быть объектом");
        r2d_json_free(root);
        return;
    }
    const R2dJson *ver = r2d_json_get(root, "version");
    if (!is_num(ver) || ver->number != 1) E(c, "SDK_RE2D_VERSION", "version", "version должен быть числом 1");
    const R2dJson *atlas = r2d_json_get(root, "atlas");
    const bool atlas_ok = atlas && atlas->type == R2D_JSON_STR && atlas->string && atlas->string[0];
    if (!atlas_ok) E(c, "SDK_RE2D_ATLAS", "atlas", "atlas — путь к PNG v2, строка");
    const R2dJson *style = r2d_json_get(root, "style");
    if (present(style) && !(style->type == R2D_JSON_STR && (strcmp(style->string, "anime") == 0 || strcmp(style->string, "pixel") == 0))) {
        E(c, "SDK_RE2D_STYLE", "style", "style — anime или pixel");
    }

    const R2dJson *rig = r2d_json_get(root, "rig");
    const R2dJson *bones = r2d_json_get(rig, "bones");
    const R2dJson *parts = r2d_json_get(rig, "parts");
    const bool rig_ok = rig && rig->type == R2D_JSON_OBJ && bones && bones->type == R2D_JSON_ARR && bones->count >= 1 && bones->count <= 64 &&
                        parts && parts->type == R2D_JSON_ARR && parts->count >= 1 && parts->count <= 254;
    if (!rig_ok) {
        E(c, "SDK_RE2D_RIG", "rig", "rig: 1..64 bones и 1..254 parts (массивы)");
        r2d_json_free(root);
        return;
    }

    bool declared[256] = { 0 };
    for (int i = 0; i < bones->count; ++i) {
        const R2dJson *b = bones->items[i];
        char w[120];
        snprintf(w, sizeof w, "rig.bones[%d]", i);
        const R2dJson *nm = r2d_json_get(b, "name");
        check_name(c, nm, w);
        if (name_ok(nm)) {
            for (int k = 0; k < i; ++k) {
                if (strcmp(r2d_json_str(r2d_json_get(bones->items[k], "name"), ""), nm->string) == 0) {
                    E(c, "SDK_RE2D_BONE_DUPLICATE", w, "Кость «%s» повторяется: имена уникальны", nm->string);
                    break;
                }
            }
        }
        const R2dJson *parent = r2d_json_get(b, "parent");
        if (present(parent)) {
            bool found = false;
            for (int k = 0; k < i && !found; ++k) {
                found = parent->type == R2D_JSON_STR && strcmp(r2d_json_str(r2d_json_get(bones->items[k], "name"), ""), parent->string) == 0;
            }
            if (!found) E(c, "SDK_RE2D_BONE_PARENT", w, "%s: родитель должен существовать и идти раньше ребёнка", w);
        }
        check_vector(c, b, "pivot", w);
        check_vector(c, b, "portraitPivot", w);
    }

    #define BONE_EXISTS(name_value, out) do { out = false; \
        for (int bi = 0; bi < bones->count && !(out); ++bi) \
            out = (name_value) && (name_value)->type == R2D_JSON_STR && \
                  strcmp(r2d_json_str(r2d_json_get(bones->items[bi], "name"), ""), (name_value)->string) == 0; } while (0)

    for (int i = 0; i < parts->count; ++i) {
        const R2dJson *p = parts->items[i];
        char w[120];
        snprintf(w, sizeof w, "rig.parts[%d]", i);
        const R2dJson *idv = r2d_json_get(p, "id");
        const bool id_ok = is_num(idv) && idv->number == floor(idv->number) && idv->number >= 1 && idv->number <= 254;
        if (!id_ok) {
            E(c, "SDK_RE2D_PART_ID", w, "%s: id — целое 1..254", w);
        } else {
            const int id = (int)idv->number;
            if (declared[id]) E(c, "SDK_RE2D_PART_ID", w, "%s: id %d повторяется", w, id);
            declared[id] = true;
        }
        bool bone_ok;
        BONE_EXISTS(r2d_json_get(p, "bone"), bone_ok);
        if (!bone_ok) E(c, "SDK_RE2D_PART_BONE", w, "%s: bone «%s» не описана в rig.bones", w, r2d_json_str(r2d_json_get(p, "bone"), ""));
        const R2dJson *sel = r2d_json_get(p, "selector");
        if (present(sel)) {
            if (sel->type != R2D_JSON_STR || !face_values(sel->string)) {
                E(c, "SDK_RE2D_SELECTOR", w, "%s: selector — eyes, mouth или brows", w);
            } else {
                const R2dJson *var = r2d_json_get(p, "variant");
                if (!is_num(var) || var->number != floor(var->number) || var->number < 0 || var->number > 3) {
                    E(c, "SDK_RE2D_SELECTOR", w, "%s: у selector нужен variant 0..3", w);
                }
            }
        }
        for (int kk = 0; kk < 2; ++kk) {
            const char *key = kk ? "oneSided" : "portrait";
            const R2dJson *bv = r2d_json_get(p, key);
            if (present(bv) && bv->type != R2D_JSON_BOOL) E(c, "SDK_RE2D_PART_FLAG", w, "%s.%s — boolean", w, key);
        }
        for (int kk = 0; kk < 2; ++kk) {
            const char *key = kk ? "portraitBind" : "bind";
            const R2dJson *bind = r2d_json_get(p, key);
            if (bind && bind->type == R2D_JSON_OBJ) {
                char bw[160];
                snprintf(bw, sizeof bw, "%s.%s", w, key);
                check_vector(c, bind, "scale", bw);
                check_vector(c, bind, "translation", bw);
                check_vector(c, bind, "rotation", bw);
            }
        }
    }

    // groups
    const R2dJson *groups = r2d_json_get(root, "groups");
    if (present(groups) && groups->type == R2D_JSON_OBJ) {
        for (int i = 0; i < groups->count; ++i) {
            const R2dJson *list = groups->items[i];
            char w[160];
            snprintf(w, sizeof w, "groups.%s", groups->keys[i]);
            bool ok = list && list->type == R2D_JSON_ARR && list->count >= 1;
            for (int k = 0; ok && k < list->count; ++k) {
                const R2dJson *e = list->items[k];
                const int id = is_num(e) ? (int)e->number : 0;
                if (!is_num(e) || e->number != id || id < 1 || id > 254 || !declared[id]) ok = false;
                for (int j = 0; ok && j < k; ++j) if (is_num(list->items[j]) && list->items[j]->number == e->number) ok = false;
            }
            if (!ok) E(c, "SDK_RE2D_GROUP", w, "%s: непустой список уникальных ID описанных частей", w);
        }
    }

    // joints
    const R2dJson *joints = r2d_json_get(rig, "joints");
    if (present(joints)) {
        if (joints->type != R2D_JSON_ARR || joints->count > 128) {
            E(c, "SDK_RE2D_JOINT", "rig.joints", "rig.joints — массив до 128");
        } else {
            for (int i = 0; i < joints->count; ++i) {
                const R2dJson *j = joints->items[i];
                char w[120];
                snprintf(w, sizeof w, "rig.joints[%d]", i);
                bool bone_ok;
                BONE_EXISTS(r2d_json_get(j, "bone"), bone_ok);
                bool dup = false;
                for (int k = 0; k < i; ++k) dup = dup || strcmp(r2d_json_str(r2d_json_get(joints->items[k], "name"), ""), r2d_json_str(r2d_json_get(j, "name"), "")) == 0;
                if (!name_ok(r2d_json_get(j, "name")) || dup || !bone_ok) E(c, "SDK_RE2D_JOINT", w, "%s: уникальное имя и существующая bone", w);
                check_vector(c, j, "point", w);
            }
        }
    }

    // controls
    const R2dJson *controls = r2d_json_get(rig, "controls");
    if (present(controls) && controls->type == R2D_JSON_OBJ) {
        for (int i = 0; i < controls->count; ++i) {
            const R2dJson *ct = controls->items[i];
            char w[160];
            snprintf(w, sizeof w, "rig.controls.%s", controls->keys[i]);
            bool bone_ok;
            BONE_EXISTS(r2d_json_get(ct, "bone"), bone_ok);
            const char *axis = r2d_json_str(r2d_json_get(ct, "axis"), "");
            if (!bone_ok || !(strcmp(axis, "x") == 0 || strcmp(axis, "y") == 0 || strcmp(axis, "z") == 0)) {
                E(c, "SDK_RE2D_CONTROL", w, "%s: bone должна существовать, axis — x, y или z", w);
            }
        }
    }

    // projection
    const R2dJson *proj = r2d_json_get(root, "projection");
    for (int kk = 0; kk < 2; ++kk) {
        const char *key = kk ? "portraitScale" : "bodyScale";
        const R2dJson *v = proj ? r2d_json_get(proj, key) : NULL;
        if (present(v) && (!finite_num(v) || v->number <= 0 || v->number > 8)) {
            char w[80];
            snprintf(w, sizeof w, "projection.%s", key);
            E(c, "SDK_RE2D_PROJECTION", w, "%s — число в (0, 8]", w);
        }
    }

    // sockets
    const R2dJson *sockets = r2d_json_get(rig, "sockets");
    if (present(sockets)) {
        if (sockets->type != R2D_JSON_ARR || sockets->count > 128) {
            E(c, "SDK_RE2D_SOCKET", "rig.sockets", "rig.sockets — массив до 128");
        } else {
            for (int i = 0; i < sockets->count; ++i) {
                const R2dJson *s = sockets->items[i];
                char w[120];
                snprintf(w, sizeof w, "rig.sockets[%d]", i);
                bool bone_ok;
                BONE_EXISTS(r2d_json_get(s, "bone"), bone_ok);
                bool dup = false;
                for (int k = 0; k < i; ++k) dup = dup || strcmp(r2d_json_str(r2d_json_get(sockets->items[k], "name"), ""), r2d_json_str(r2d_json_get(s, "name"), "")) == 0;
                if (!name_ok(r2d_json_get(s, "name")) || dup || !bone_ok) E(c, "SDK_RE2D_SOCKET", w, "%s: уникальное имя и существующая bone", w);
                check_vector(c, s, "point", w);
                check_vector(c, s, "rotation", w);
                const R2dJson *pt = r2d_json_get(s, "portrait");
                if (present(pt) && pt->type != R2D_JSON_BOOL) E(c, "SDK_RE2D_SOCKET", w, "%s.portrait — boolean", w);
            }
        }
    }

    // defaults
    const R2dJson *defaults = r2d_json_get(root, "defaults");
    const R2dJson *dbody = defaults ? r2d_json_get(defaults, "body") : NULL;
    if (present(dbody) && dbody->type != R2D_JSON_BOOL) E(c, "SDK_RE2D_DEFAULTS", "defaults.body", "defaults.body — boolean");
    const R2dJson *drig = defaults ? r2d_json_get(defaults, "rig") : NULL;
    if (drig && drig->type == R2D_JSON_OBJ) {
        for (int i = 0; i < drig->count; ++i) {
            if (!(drig->items[i] && (drig->items[i]->type == R2D_JSON_BOOL || (is_num(drig->items[i]) && isfinite(drig->items[i]->number))))) {
                char w[120];
                snprintf(w, sizeof w, "defaults.rig.%s", drig->keys[i]);
                E(c, "SDK_RE2D_DEFAULTS", w, "%s — конечное число", w);
            }
        }
    }
    const R2dJson *dexpr = defaults ? r2d_json_get(defaults, "expression") : NULL;
    if (dexpr && dexpr->type == R2D_JSON_OBJ) {
        for (int i = 0; i < dexpr->count; ++i) {
            const char *key = dexpr->keys[i];
            const char *value = dexpr->items[i] && dexpr->items[i]->type == R2D_JSON_STR ? dexpr->items[i]->string : "";
            if (face_values(key) && !in_list(face_values(key), value)) {
                char w[120];
                snprintf(w, sizeof w, "defaults.expression.%s", key);
                E(c, "SDK_RE2D_DEFAULTS", w, "%s: «%s» недопустимо", w, value);
            }
        }
    }

    // emotions
    const R2dJson *emotions = r2d_json_get(root, "emotions");
    if (present(emotions) && emotions->type == R2D_JSON_OBJ) {
        for (int i = 0; i < emotions->count; ++i) {
            const R2dJson *em = emotions->items[i];
            char w[120];
            snprintf(w, sizeof w, "emotions.%s", emotions->keys[i]);
            if (!emotions->keys[i][0] || strlen(emotions->keys[i]) > 80 || strcmp(emotions->keys[i], "__proto__") == 0 ||
                strcmp(emotions->keys[i], "constructor") == 0 || strcmp(emotions->keys[i], "prototype") == 0) {
                E(c, "SDK_RE2D_NAME", w, "Имя эмоции «%s» недопустимо", emotions->keys[i]);
            }
            for (int k = 0; em && em->type == R2D_JSON_OBJ && k < em->count; ++k) {
                const char *value = em->items[k] && em->items[k]->type == R2D_JSON_STR ? em->items[k]->string : "";
                if (!face_values(em->keys[k]) || !in_list(face_values(em->keys[k]), value)) {
                    E(c, "SDK_RE2D_EMOTION", w, "%s.%s: «%s» недопустимо", w, em->keys[k], value);
                }
            }
        }
    }

    // анимации: внешний файл либо объект
    int clip_count = 0;
    char clip_names[64][81];
    const R2dJson *anims = r2d_json_get(root, "animations");
    R2dJson *anim_owned = NULL;
    const R2dJson *anim_doc = NULL;
    if (anims && anims->type == R2D_JSON_STR) {
        char anim_path[2048];
        resolve_asset(path, anims->string, anim_path, sizeof anim_path);
        if (!sdk_file_exists(anim_path)) {
            E(c, "SDK_RE2D_ANIM_MISSING", "animations", "Файл анимаций «%s» не найден (%s)", anims->string, anim_path);
        } else {
            SdkReport sub;
            sdk_report_init(&sub);
            anim_owned = sdk_load_json(anim_path, &sub);
            if (!anim_owned) E(c, "SDK_RE2D_ANIM_MISSING", "animations", "Файл анимаций «%s» не читается как JSON", anims->string);
            sdk_report_free(&sub);
            anim_doc = anim_owned;
        }
    } else if (present(anims)) {
        anim_doc = anims;
    }
    if (anim_doc) validate_animations(c, anim_doc, bones, &clip_count, clip_names);
    const R2dJson *dmotion = defaults ? r2d_json_get(defaults, "motion") : NULL;
    if (clip_count > 0 && present(dmotion)) {
        bool found = false;
        for (int i = 0; i < clip_count && !found; ++i) found = dmotion->type == R2D_JSON_STR && strcmp(clip_names[i], dmotion->string) == 0;
        if (!found) E(c, "SDK_RE2D_DEFAULTS", "defaults.motion", "defaults.motion «%s» — не клип из animations", dmotion->type == R2D_JSON_STR ? dmotion->string : "?");
    }
    r2d_json_free(anim_owned);

    // equipment и variants: пути и сокеты.
    const R2dJson *equipment = r2d_json_get(root, "equipment");
    for (int i = 0; equipment && equipment->type == R2D_JSON_OBJ && i < equipment->count; ++i) {
        const R2dJson *e = equipment->items[i];
        char w[160];
        snprintf(w, sizeof w, "equipment.%s", equipment->keys[i]);
        const char *model = r2d_json_str(r2d_json_get(e, "model"), NULL);
        const char *socket = r2d_json_str(r2d_json_get(e, "socket"), NULL);
        if (!model || !socket) { E(c, "SDK_RE2D_EQUIPMENT", w, "%s: нужны model и socket (строки)", w); continue; }
        bool socket_ok = false;
        for (int k = 0; sockets && sockets->type == R2D_JSON_ARR && k < sockets->count; ++k) {
            socket_ok = socket_ok || strcmp(r2d_json_str(r2d_json_get(sockets->items[k], "name"), ""), socket) == 0;
        }
        if (!socket_ok) E(c, "SDK_RE2D_EQUIPMENT_SOCKET", w, "%s: сокет «%s» не описан в rig.sockets", w, socket);
        char full[2048];
        resolve_asset(path, model, full, sizeof full);
        if (!sdk_file_exists(full)) W(c, "SDK_RE2D_EQUIPMENT_MISSING", w, "%s: модель «%s» не найдена (%s)", w, model, full);
    }
    const R2dJson *variants = r2d_json_get(root, "variants");
    for (int i = 0; variants && variants->type == R2D_JSON_OBJ && i < variants->count; ++i) {
        const R2dJson *grp = variants->items[i];
        for (int k = 0; grp && grp->type == R2D_JSON_OBJ && k < grp->count; ++k) {
            if (!grp->items[k] || grp->items[k]->type != R2D_JSON_STR) continue;
            char full[2048], w[200];
            snprintf(w, sizeof w, "variants.%s.%s", variants->keys[i], grp->keys[k]);
            resolve_asset(path, grp->items[k]->string, full, sizeof full);
            if (!sdk_file_exists(full)) W(c, "SDK_RE2D_VARIANT_MISSING", w, "%s: PNG донора «%s» не найден", w, grp->items[k]->string);
        }
    }

    // PNG v2.
    if (atlas_ok) {
        char png_path[2048];
        resolve_asset(path, atlas->string, png_path, sizeof png_path);
        if (!sdk_file_exists(png_path)) {
            R2dSb d;
            r2d_sb_init(&d);
            r2d_sb_puts(&d, "{\"atlas\":");
            r2d_sb_put_json_string(&d, atlas->string);
            r2d_sb_puts(&d, ",\"resolved\":");
            r2d_sb_put_json_string(&d, png_path);
            r2d_sb_putc(&d, '}');
            sdk_diag(rep, SDK_ERROR, "SDK_RE2D_ATLAS_MISSING", path, NULL, d.data, "PNG атласа «%s» не найден (%s)", atlas->string, png_path);
            r2d_sb_free(&d);
        } else {
            Re2dPng png;
            if (!re2d_png_open(png_path, &png)) {
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D_PNG_FORMAT", png_path, NULL, NULL, "Файл «%s» не читается как PNG", atlas->string);
            } else {
                Re2dStats st;
                re2d_stats(&png, &st);
                re2d_validate_png(png_path, &png, &st, declared, rep);
                re2d_png_close(&png);
            }
        }
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------
static void emit(R2dSb *out)
{
    puts(out->data);
    fflush(stdout);
}

static bool model_atlas_path(const char *model, char *out, size_t cap, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(model, rep);
    if (!root) return false;
    const char *atlas = r2d_json_str(r2d_json_get(root, "atlas"), NULL);
    if (!atlas) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_ATLAS", model, NULL, NULL, "В описании нет поля atlas");
        r2d_json_free(root);
        return false;
    }
    resolve_asset(model, atlas, out, cap);
    r2d_json_free(root);
    return true;
}

// Общий разбор: <png | character.json> → путь PNG и (необязательно) путь модели.
static bool resolve_inputs(const SdkArgs *a, char *png_path, size_t cap, const char **model_out, SdkReport *rep)
{
    const char *input = sdk_arg_positional(a, 0);
    *model_out = sdk_arg_value(a, "--model");
    if (!input) return false;
    if (sdk_ends_with(input, ".character.json") || sdk_ends_with(input, ".json")) {
        *model_out = input;
        return model_atlas_path(input, png_path, cap, rep);
    }
    snprintf(png_path, cap, "%s", input);
    return true;
}

int sdk_cmd_re2d_info(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *input = sdk_arg_positional(a, 0);
    if (!input) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk re2d-info <файл.character.json | атлас.png> [--model описание.json]");
        sdk_report_free(&rep);
        return rc;
    }
    char png_path[2048] = "";
    const char *model = NULL;
    const bool ok_input = resolve_inputs(a, png_path, sizeof png_path, &model, &rep);
    Re2dPng png;
    bool opened = ok_input && re2d_png_open(png_path, &png);
    if (ok_input && !opened) sdk_diag(&rep, SDK_ERROR, "SDK_RE2D_PNG_FORMAT", png_path, NULL, NULL, "PNG не найден или не читается: %s", png_path);

    R2dSb out;
    r2d_sb_init(&out);
    Re2dStats st;
    Re2dOwners owners;
    re2d_owners_load(model, &owners);
    if (opened) {
        re2d_stats(&png, &st);
        re2d_validate_png(png_path, &png, &st, model ? owners.declared : NULL, &rep);
    }
    r2d_sb_printf(&out, "{\"ok\":%s,", opened && rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "atlas", opened ? png_path : NULL);
    if (opened) {
        r2d_sb_printf(&out, ",\"png\":{\"w\":%d,\"h\":%d,\"k\":%d,\"sizeOk\":%s,\"headerOk\":%s,\"sub\":%s,\"bld\":%s},", png.w, png.h, png.k,
                      png.size_ok ? "true" : "false", png.header_ok ? "true" : "false", png.sub ? "true" : "false", png.bld ? "true" : "false");
        r2d_sb_printf(&out, "\"samples\":{\"active\":%d,\"anchors\":%d,\"holes\":%d,\"isolated\":%d,\"seams\":%d,\"staleId\":%d,\"overlapMax\":%d},",
                      st.active, st.anchors, st.holes, st.isolated, st.seams, st.stale_id, st.overlap_max);
        r2d_sb_puts(&out, "\"parts\":[");
        int n = 0;
        for (int id = 1; id <= 254; ++id) {
            if (!st.per_id[id] && !owners.declared[id]) continue;
            if (n++) r2d_sb_putc(&out, ',');
            r2d_sb_printf(&out, "{\"id\":%d,\"samples\":%d,\"declared\":%s,\"bone\":", id, st.per_id[id], owners.declared[id] ? "true" : "false");
            if (owners.declared[id]) r2d_sb_put_json_string(&out, owners.bones[id]);
            else r2d_sb_puts(&out, "null");
            r2d_sb_putc(&out, '}');
        }
        r2d_sb_puts(&out, "],");
        re2d_png_close(&png);
    } else {
        r2d_sb_puts(&out, ",\"png\":null,\"samples\":null,\"parts\":[],");
    }
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);
    const int rc = opened && rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_re2d_debug(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *out_path = sdk_arg_value(a, "--out");
    const char *mode_name = sdk_arg_value(a, "--mode");
    if (!sdk_arg_positional(a, 0) || !out_path || !mode_name) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk re2d-debug <png | character.json> --mode material|part|owner|x|y|z|coverage|group|overlap --out файл.png [--scale 1..16] [--model описание.json]");
        sdk_report_free(&rep);
        return rc;
    }
    const int mode = re2d_mode_from_name(mode_name);
    if (mode < 0) {
        const int rc = sdk_fail(&rep, "SDK_RE2D_MODE", "Неизвестный режим «%s»", mode_name);
        sdk_report_free(&rep);
        return rc;
    }
    char png_path[2048] = "";
    const char *model = NULL;
    if (!resolve_inputs(a, png_path, sizeof png_path, &model, &rep)) {
        R2dSb o;
        r2d_sb_init(&o);
        r2d_sb_puts(&o, "{\"ok\":false,");
        sdk_report_put(&rep, &o);
        r2d_sb_putc(&o, '}');
        emit(&o);
        r2d_sb_free(&o);
        sdk_report_free(&rep);
        return 1;
    }
    const char *scale_arg = sdk_arg_value(a, "--scale");
    const int scale = scale_arg ? atoi(scale_arg) : 3;
    Re2dPng png;
    bool ok = false;
    int w = 0, h = 0;
    if (!re2d_png_open(png_path, &png)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_RE2D_PNG_FORMAT", png_path, NULL, NULL, "PNG не найден или не читается: %s", png_path);
    } else if (!png.size_ok || !png.header_ok) {
        sdk_diag(&rep, SDK_ERROR, png.size_ok ? "SDK_RE2D_PNG_HEADER" : "SDK_RE2D_PNG_SIZE", png_path, NULL, NULL,
                 "Это не PNG Re2DSprite v2: отладочный вид строится по картам поверхности");
    } else {
        Re2dOwners owners;
        re2d_owners_load(model, &owners);
        uint8_t *img = re2d_debug_image(&png, mode, &owners, scale, &w, &h);
        if (!img) {
            sdk_diag(&rep, SDK_ERROR, "SDK_RE2D_DEBUG", png_path, NULL, NULL, "Не удалось построить вид (scale 1..16)");
        } else {
            char dir[1024];
            sdk_dirname(out_path, dir, sizeof dir);
            if (!sdk_is_dir(dir)) SDL_CreateDirectory(dir);
            ok = sdk_image_write_png(out_path, img, w, h);
            if (!ok) sdk_diag(&rep, SDK_ERROR, "SDK_WRITE_FAILED", out_path, NULL, NULL, "Не удалось записать %s", out_path);
            free(img);
        }
        re2d_png_close(&png);
    }
    R2dSb o;
    r2d_sb_init(&o);
    r2d_sb_printf(&o, "{\"ok\":%s,", ok ? "true" : "false");
    sdk_put_kv_str(&o, "mode", mode_name);
    r2d_sb_putc(&o, ',');
    sdk_put_kv_str(&o, "out", ok ? out_path : NULL);
    r2d_sb_printf(&o, ",\"w\":%d,\"h\":%d,\"scale\":%d,\"mapW\":%d,\"mapH\":%d,", w, h, scale, RE2D_MAP_W, RE2D_MAP_H);
    sdk_report_put_counts(&rep, &o);
    r2d_sb_putc(&o, ',');
    sdk_report_put(&rep, &o);
    r2d_sb_putc(&o, '}');
    emit(&o);
    r2d_sb_free(&o);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}

int sdk_cmd_re2d_sample(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *xs = sdk_arg_value(a, "--x");
    const char *ys = sdk_arg_value(a, "--y");
    if (!sdk_arg_positional(a, 0) || !xs || !ys) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk re2d-sample <png | character.json> --x mx --y my [--model описание.json]");
        sdk_report_free(&rep);
        return rc;
    }
    char png_path[2048] = "";
    const char *model = NULL;
    bool ok = resolve_inputs(a, png_path, sizeof png_path, &model, &rep);
    Re2dPng png;
    Re2dSample s;
    memset(&s, 0, sizeof s);
    if (ok && !re2d_png_open(png_path, &png)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_RE2D_PNG_FORMAT", png_path, NULL, NULL, "PNG не найден или не читается: %s", png_path);
        ok = false;
    } else if (ok) {
        const int mx = atoi(xs), my = atoi(ys);
        if (!png.size_ok || mx < 0 || my < 0 || mx >= RE2D_MAP_W || my >= RE2D_MAP_H) {
            sdk_diag(&rep, SDK_ERROR, "SDK_RE2D_SAMPLE_RANGE", png_path, NULL, NULL, "Отсчёт (%d,%d) вне карты %dx%d", mx, my, RE2D_MAP_W, RE2D_MAP_H);
            ok = false;
        } else {
            re2d_sample(&png, mx, my, &s);
        }
        re2d_png_close(&png);
    }
    Re2dOwners owners;
    re2d_owners_load(model, &owners);
    R2dSb o;
    r2d_sb_init(&o);
    r2d_sb_printf(&o, "{\"ok\":%s,", ok ? "true" : "false");
    if (ok) {
        r2d_sb_printf(&o, "\"sample\":{\"mx\":%d,\"my\":%d,\"id\":%d,\"group\":%d,\"id2\":%d,\"coverage\":%d,\"x\":%g,\"y\":%g,\"z\":%g,\"alphaOk\":%s,"
                          "\"color\":[%d,%d,%d,%d],\"bone\":",
                      s.mx, s.my, s.id, s.group, s.id2, s.coverage, s.x, s.y, s.z, s.alpha_ok ? "true" : "false", s.r, s.g, s.b, s.a);
        if (s.id >= 1 && s.id <= 254 && owners.declared[s.id]) r2d_sb_put_json_string(&o, owners.bones[s.id]);
        else r2d_sb_puts(&o, "null");
        r2d_sb_puts(&o, "},");
    } else {
        r2d_sb_puts(&o, "\"sample\":null,");
    }
    sdk_report_put_counts(&rep, &o);
    r2d_sb_putc(&o, ',');
    sdk_report_put(&rep, &o);
    r2d_sb_putc(&o, '}');
    emit(&o);
    r2d_sb_free(&o);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}
