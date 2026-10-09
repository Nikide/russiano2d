// ===========================================================================
// Атласы спрайтов: проверка, канонический вид, создание сеткой.
//
// Формат — Aseprite-совместимый JSON, который уже читает `$.atlas`
// (src/highlevel/atlas.js): `frames` (имя → { frame{x,y,w,h}, duration }),
// `meta.image`, `meta.frameTags` (теги-анимации по индексам кадров),
// `meta.slices` (слайсы с пивотом). Нового формата SDK не вводит: поля, которых
// рантайм не знает (`meta.custom`, `loop` у тега), он просто игнорирует.
//
// Один код на GUI (Sprite Studio), CLI и агента: Studio вызывает `validate`
// этого файла, а `atlas-format` проверяет, что сериализатор Studio на JS
// пишет те же байты, что и C (tests/agent/sdk_atlas_test.py).
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Помощники чтения
// ---------------------------------------------------------------------------
static bool jnum(const R2dJson *v, double *out)
{
    if (!v || v->type != R2D_JSON_NUM || !isfinite(v->number)) return false;
    *out = v->number;
    return true;
}

static bool is_obj(const R2dJson *v) { return v && v->type == R2D_JSON_OBJ; }
static bool is_arr(const R2dJson *v) { return v && v->type == R2D_JSON_ARR; }

// Прямоугольник кадра: из `frame{...}` либо из самой записи (плоский вид).
typedef struct AtlasFrame {
    const char *name;     // указывает внутрь R2dJson
    double x, y, w, h;
    double duration;
    bool   has_duration;
    bool   rotated;
    bool   rect_ok;
} AtlasFrame;

static bool read_box(const R2dJson *box, double *x, double *y, double *w, double *h)
{
    const R2dJson *jw = r2d_json_get(box, "w");
    const R2dJson *jh = r2d_json_get(box, "h");
    if (!jw) jw = r2d_json_get(box, "width");
    if (!jh) jh = r2d_json_get(box, "height");
    return jnum(r2d_json_get(box, "x"), x) && jnum(r2d_json_get(box, "y"), y) && jnum(jw, w) && jnum(jh, h);
}

static void frame_location(R2dSb *sb, const char *name, const char *field)
{
    r2d_sb_puts(sb, "{\"frame\":");
    r2d_sb_put_json_string(sb, name);
    if (field) {
        r2d_sb_puts(sb, ",\"field\":");
        r2d_sb_put_json_string(sb, field);
    }
    r2d_sb_putc(sb, '}');
}

// Собирает кадры из объектного или массивного вида. Возвращает количество.
static int collect_frames(const R2dJson *root, AtlasFrame **out, SdkReport *rep, const char *asset)
{
    *out = NULL;
    const R2dJson *frames = r2d_json_get(root, "frames");
    if (!frames || (!is_obj(frames) && !is_arr(frames))) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_FRAMES", asset, NULL, NULL,
                 "Поле frames отсутствует или не является объектом/массивом");
        return 0;
    }
    const int n = frames->count;
    if (n == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_FRAMES", asset, NULL, NULL, "В атласе нет ни одного кадра");
        return 0;
    }
    AtlasFrame *list = (AtlasFrame *)calloc((size_t)n, sizeof *list);
    if (!list) return 0;
    for (int i = 0; i < n; ++i) {
        AtlasFrame *f = &list[i];
        const R2dJson *entry = frames->items[i];
        f->name = is_obj(frames) ? frames->keys[i] : r2d_json_str(r2d_json_get(entry, "filename"), "");
        const R2dJson *box = is_obj(r2d_json_get(entry, "frame")) ? r2d_json_get(entry, "frame") : entry;
        f->rect_ok = is_obj(entry) && read_box(box, &f->x, &f->y, &f->w, &f->h) && f->w > 0 && f->h > 0;
        if (!f->rect_ok) {
            R2dSb loc;
            r2d_sb_init(&loc);
            frame_location(&loc, f->name, "frame");
            sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_FRAME_RECT", asset, loc.data, NULL,
                     "Кадр «%s»: нужны числа x, y и положительные w, h", f->name);
            r2d_sb_free(&loc);
            continue;
        }
        const R2dJson *jd = r2d_json_get(entry, "duration");
        if (jd) {
            double d = 0;
            if (!jnum(jd, &d) || d <= 0 || d > 600000) {
                R2dSb loc;
                r2d_sb_init(&loc);
                frame_location(&loc, f->name, "duration");
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_DURATION", asset, loc.data, NULL,
                         "Кадр «%s»: duration должна быть числом 1..600000 мс", f->name);
                r2d_sb_free(&loc);
            } else {
                f->duration = d;
                f->has_duration = true;
            }
        }
        const R2dJson *rot = r2d_json_get(box, "rotated");
        const R2dJson *rot2 = r2d_json_get(entry, "rotated");
        f->rotated = (rot && rot->type == R2D_JSON_BOOL && rot->boolean) || (rot2 && rot2->type == R2D_JSON_BOOL && rot2->boolean);
    }
    *out = list;
    return n;
}

// Путь картинки относительно каталога JSON. Пусто, если поля нет.
static const char *image_field(const R2dJson *root)
{
    const R2dJson *meta = r2d_json_get(root, "meta");
    const char *image = r2d_json_str(r2d_json_get(meta, "image"), NULL);
    if (!image) image = r2d_json_str(r2d_json_get(root, "image"), NULL);
    return image;
}

// ---------------------------------------------------------------------------
// Проверка
// ---------------------------------------------------------------------------
void sdk_validate_atlas(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return;
    if (!is_obj(root)) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_ROOT", path, NULL, NULL, "Корень атласа должен быть объектом");
        r2d_json_free(root);
        return;
    }

    AtlasFrame *frames = NULL;
    const int n = collect_frames(root, &frames, rep, path);

    // Дубликаты имён (в объектном виде их не бывает после разбора, в массивном — да).
    for (int i = 0; i < n; ++i) {
        for (int k = 0; k < i; ++k) {
            if (frames[i].name[0] && strcmp(frames[i].name, frames[k].name) == 0) {
                R2dSb loc;
                r2d_sb_init(&loc);
                frame_location(&loc, frames[i].name, NULL);
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_DUPLICATE_FRAME", path, loc.data, NULL,
                         "Имя кадра «%s» повторяется", frames[i].name);
                r2d_sb_free(&loc);
                break;
            }
        }
    }

    // Картинка.
    int img_w = 0, img_h = 0;
    bool img_known = false;
    const char *image = image_field(root);
    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);
    if (!image || !image[0]) {
        sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_IMAGE_FIELD", path, NULL, NULL,
                 "Нет meta.image: рантайм возьмёт одноимённый .png рядом с JSON");
    } else {
        char full[2048];
        sdk_join(dir, image, full, sizeof full);
        if (!sdk_file_exists(full)) {
            R2dSb d;
            r2d_sb_init(&d);
            r2d_sb_puts(&d, "{\"image\":");
            r2d_sb_put_json_string(&d, image);
            r2d_sb_putc(&d, '}');
            sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_IMAGE_MISSING", path, NULL, d.data,
                     "Картинка атласа «%s» не найдена рядом с JSON", image);
            r2d_sb_free(&d);
        } else if (!sdk_image_info(full, &img_w, &img_h)) {
            sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_IMAGE_FORMAT", path, NULL, NULL,
                     "Картинка «%s» не читается как PNG/JPG/BMP", image);
        } else {
            img_known = true;
            const R2dJson *size = r2d_json_get(r2d_json_get(root, "meta"), "size");
            double sw = 0, sh = 0;
            if (size && jnum(r2d_json_get(size, "w"), &sw) && jnum(r2d_json_get(size, "h"), &sh) &&
                ((int)sw != img_w || (int)sh != img_h)) {
                char d[160];
                snprintf(d, sizeof d, "{\"meta\":[%d,%d],\"image\":[%d,%d]}", (int)sw, (int)sh, img_w, img_h);
                sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_SIZE_MISMATCH", path, NULL, d,
                         "meta.size %dx%d не совпадает с размером картинки %dx%d", (int)sw, (int)sh, img_w, img_h);
            }
        }
    }

    // Границы и поворот.
    for (int i = 0; i < n; ++i) {
        const AtlasFrame *f = &frames[i];
        if (!f->rect_ok) continue;
        if (f->x < 0 || f->y < 0 || (img_known && (f->x + f->w > img_w || f->y + f->h > img_h))) {
            R2dSb loc, d;
            r2d_sb_init(&loc);
            r2d_sb_init(&d);
            frame_location(&loc, f->name, "frame");
            r2d_sb_printf(&d, "{\"rect\":[%g,%g,%g,%g],\"image\":", f->x, f->y, f->w, f->h);
            if (img_known) r2d_sb_printf(&d, "[%d,%d]}", img_w, img_h);
            else r2d_sb_puts(&d, "null}");
            sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_FRAME_BOUNDS", path, loc.data, d.data,
                     "Кадр «%s» (%g,%g %gx%g) выходит за пределы картинки", f->name, f->x, f->y, f->w, f->h);
            r2d_sb_free(&loc);
            r2d_sb_free(&d);
        }
        if (f->x != floor(f->x) || f->y != floor(f->y) || f->w != floor(f->w) || f->h != floor(f->h)) {
            R2dSb loc;
            r2d_sb_init(&loc);
            frame_location(&loc, f->name, "frame");
            sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_FRAME_FRACTIONAL", path, loc.data, NULL,
                     "Кадр «%s» с дробными координатами: в пиксель-арте кадры режут по целым пикселям", f->name);
            r2d_sb_free(&loc);
        }
        if (f->rotated) {
            R2dSb loc;
            r2d_sb_init(&loc);
            frame_location(&loc, f->name, "rotated");
            sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_ROTATED", path, loc.data, NULL,
                     "Кадр «%s» повёрнут в атласе: рантайм такие кадры пропускает — выгрузите без поворота", f->name);
            r2d_sb_free(&loc);
        }
    }

    // Теги Aseprite (по индексам кадров).
    const R2dJson *meta = r2d_json_get(root, "meta");
    const R2dJson *tags = r2d_json_get(meta, "frameTags");
    if (tags && !is_arr(tags)) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG", path, NULL, NULL, "meta.frameTags должен быть массивом");
    } else if (tags) {
        for (int i = 0; i < tags->count; ++i) {
            const R2dJson *t = tags->items[i];
            const char *name = r2d_json_str(r2d_json_get(t, "name"), "");
            double from = 0, to = 0;
            R2dSb loc;
            r2d_sb_init(&loc);
            r2d_sb_printf(&loc, "{\"tag\":");
            r2d_sb_put_json_string(&loc, name);
            r2d_sb_putc(&loc, '}');
            if (!is_obj(t) || !name[0]) {
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG", path, loc.data, NULL, "Тег #%d: нужен объект с именем", i);
            } else if (!jnum(r2d_json_get(t, "from"), &from) || !jnum(r2d_json_get(t, "to"), &to) ||
                       from != floor(from) || to != floor(to)) {
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG", path, loc.data, NULL, "Тег «%s»: from и to должны быть целыми", name);
            } else if (from < 0 || to < 0 || from >= n || to >= n || from > to) {
                char d[128];
                snprintf(d, sizeof d, "{\"from\":%g,\"to\":%g,\"frames\":%d}", from, to, n);
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG_RANGE", path, loc.data, d,
                         "Тег «%s»: диапазон %g..%g вне кадров 0..%d", name, from, to, n - 1);
            }
            for (int k = 0; k < i; ++k) {
                if (strcmp(r2d_json_str(r2d_json_get(tags->items[k], "name"), ""), name) == 0 && name[0]) {
                    sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG_DUPLICATE", path, loc.data, NULL, "Имя тега «%s» повторяется", name);
                    break;
                }
            }
            const char *dir_name = r2d_json_str(r2d_json_get(t, "direction"), "forward");
            if (strcmp(dir_name, "forward") != 0 && strcmp(dir_name, "reverse") != 0 && strcmp(dir_name, "pingpong") != 0) {
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG", path, loc.data, NULL,
                         "Тег «%s»: direction «%s» не из forward/reverse/pingpong", name, dir_name);
            } else if (strcmp(dir_name, "pingpong") == 0) {
                sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_TAG_PINGPONG", path, loc.data, NULL,
                         "Тег «%s»: рантайм-атлас pingpong не разворачивает — играйте клип через $.anim", name);
            }
            const R2dJson *loop = r2d_json_get(t, "loop");
            if (loop && loop->type != R2D_JSON_BOOL) {
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG", path, loc.data, NULL, "Тег «%s»: loop должен быть true/false", name);
            }
            // Рантайм берёт длительность кадра тега по ПЕРВОМУ кадру (tagInterval).
            if (jnum(r2d_json_get(t, "from"), &from) && jnum(r2d_json_get(t, "to"), &to) && from >= 0 && to < n && from <= to) {
                for (int k = (int)from + 1; k <= (int)to; ++k) {
                    if (frames[k].has_duration && frames[(int)from].has_duration && frames[k].duration != frames[(int)from].duration) {
                        sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_DURATION_MIXED", path, loc.data, NULL,
                                 "Тег «%s»: у кадров разные duration, а рантайм использует длительность первого кадра", name);
                        break;
                    }
                }
            }
            r2d_sb_free(&loc);
        }
    }

    // Простой формат: tags — имя → список имён кадров.
    const R2dJson *simple_tags = r2d_json_get(root, "tags");
    if (!tags && is_obj(simple_tags)) {
        for (int i = 0; i < simple_tags->count; ++i) {
            const R2dJson *list = simple_tags->items[i];
            if (!is_arr(list)) {
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG", path, NULL, NULL, "tags.%s должен быть массивом имён кадров", simple_tags->keys[i]);
                continue;
            }
            for (int k = 0; k < list->count; ++k) {
                const char *fname = r2d_json_str(list->items[k], "");
                bool found = false;
                for (int j = 0; j < n && !found; ++j) found = strcmp(frames[j].name, fname) == 0;
                if (!found) {
                    sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG_FRAME", path, NULL, NULL,
                             "Тег «%s» ссылается на несуществующий кадр «%s»", simple_tags->keys[i], fname);
                }
            }
        }
    }

    // Слайсы с пивотом.
    const R2dJson *slices = r2d_json_get(meta, "slices");
    if (slices && !is_arr(slices)) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_SLICE", path, NULL, NULL, "meta.slices должен быть массивом");
    } else if (slices) {
        for (int i = 0; i < slices->count; ++i) {
            const R2dJson *s = slices->items[i];
            const char *name = r2d_json_str(r2d_json_get(s, "name"), "");
            R2dSb loc;
            r2d_sb_init(&loc);
            r2d_sb_puts(&loc, "{\"slice\":");
            r2d_sb_put_json_string(&loc, name);
            r2d_sb_putc(&loc, '}');
            const R2dJson *keys = r2d_json_get(s, "keys");
            if (!is_obj(s) || !name[0] || !is_arr(keys) || keys->count == 0) {
                sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_SLICE", path, loc.data, NULL, "Слайс #%d: нужны name и непустой keys", i);
            } else {
                for (int k = 0; k < keys->count; ++k) {
                    const R2dJson *key = keys->items[k];
                    double bx, by, bw, bh;
                    if (!read_box(r2d_json_get(key, "bounds"), &bx, &by, &bw, &bh) || bw <= 0 || bh <= 0) {
                        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_SLICE", path, loc.data, NULL,
                                 "Слайс «%s», ключ %d: bounds{x,y,w,h} с положительным размером", name, k);
                        continue;
                    }
                    const R2dJson *pv = r2d_json_get(key, "pivot");
                    if (pv) {
                        double px, py;
                        if (!jnum(r2d_json_get(pv, "x"), &px) || !jnum(r2d_json_get(pv, "y"), &py)) {
                            sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_SLICE", path, loc.data, NULL,
                                     "Слайс «%s», ключ %d: pivot{x,y} должен содержать числа", name, k);
                        } else if (px < bx - bw || px > bx + 2 * bw || py < by - bh || py > by + 2 * bh) {
                            sdk_diag(rep, SDK_WARNING, "SDK_ATLAS_PIVOT_OUTSIDE", path, loc.data, NULL,
                                     "Слайс «%s»: пивот (%g,%g) далеко за пределами рамки", name, px, py);
                        }
                    }
                }
            }
            r2d_sb_free(&loc);
        }
    }

    free(frames);
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// Канонический вид
// ---------------------------------------------------------------------------
static bool in_list(const char *key, const char *const *list, int n)
{
    for (int i = 0; i < n; ++i) if (strcmp(key, list[i]) == 0) return true;
    return false;
}

// Дописывает «"k": v» для ключей, которых нет в known, через запятую.
static void put_extras(R2dSb *sb, const R2dJson *obj, const char *const *known, int nknown, bool *first)
{
    for (int i = 0; obj && i < obj->count; ++i) {
        if (in_list(obj->keys[i], known, nknown)) continue;
        if (!*first) r2d_sb_puts(sb, ", ");
        *first = false;
        r2d_sb_put_json_string(sb, obj->keys[i]);
        r2d_sb_puts(sb, ": ");
        sdk_json_put_compact(sb, obj->items[i]);
    }
}

static void put_member(R2dSb *sb, const char *key, const R2dJson *v, bool *first)
{
    if (!v) return;
    if (!*first) r2d_sb_puts(sb, ", ");
    *first = false;
    r2d_sb_put_json_string(sb, key);
    r2d_sb_puts(sb, ": ");
    sdk_json_put_compact(sb, v);
}

// Прямоугольник: x, y, w, h в каноническом порядке + прочие ключи.
static void put_box(R2dSb *sb, const R2dJson *box)
{
    static const char *const known[] = { "x", "y", "w", "h", "width", "height" };
    r2d_sb_putc(sb, '{');
    bool first = true;
    double v;
    const char *keys[4] = { "x", "y", "w", "h" };
    const char *alt[4] = { "x", "y", "width", "height" };
    for (int i = 0; i < 4; ++i) {
        const R2dJson *j = r2d_json_get(box, keys[i]);
        if (!j) j = r2d_json_get(box, alt[i]);
        if (!j || !jnum(j, &v)) continue;
        put_member(sb, keys[i], j, &first);
    }
    put_extras(sb, box, known, 6, &first);
    r2d_sb_putc(sb, '}');
}

static void put_frame_entry(R2dSb *sb, const R2dJson *entry)
{
    static const char *const known_wrap[] = { "frame", "duration" };
    static const char *const known_flat[] = { "x", "y", "w", "h", "width", "height", "duration" };
    r2d_sb_putc(sb, '{');
    bool first = true;
    const R2dJson *wrapped = r2d_json_get(entry, "frame");
    r2d_sb_puts(sb, "\"frame\": ");
    put_box(sb, is_obj(wrapped) ? wrapped : entry);
    first = false;
    put_member(sb, "duration", r2d_json_get(entry, "duration"), &first);
    if (is_obj(wrapped)) put_extras(sb, entry, known_wrap, 2, &first);
    else put_extras(sb, entry, known_flat, 7, &first);
    r2d_sb_putc(sb, '}');
}

static void put_tag(R2dSb *sb, const R2dJson *t)
{
    static const char *const known[] = { "name", "from", "to", "direction", "loop" };
    r2d_sb_putc(sb, '{');
    bool first = true;
    for (int i = 0; i < 5; ++i) put_member(sb, known[i], r2d_json_get(t, known[i]), &first);
    put_extras(sb, t, known, 5, &first);
    r2d_sb_putc(sb, '}');
}

static void put_slice(R2dSb *sb, const R2dJson *s)
{
    static const char *const known[] = { "name", "color", "keys" };
    static const char *const key_known[] = { "frame", "bounds", "pivot" };
    r2d_sb_putc(sb, '{');
    bool first = true;
    put_member(sb, "name", r2d_json_get(s, "name"), &first);
    put_member(sb, "color", r2d_json_get(s, "color"), &first);
    const R2dJson *keys = r2d_json_get(s, "keys");
    if (keys) {
        if (!first) r2d_sb_puts(sb, ", ");
        first = false;
        r2d_sb_puts(sb, "\"keys\": [");
        for (int i = 0; i < keys->count; ++i) {
            const R2dJson *k = keys->items[i];
            if (i) r2d_sb_puts(sb, ", ");
            r2d_sb_putc(sb, '{');
            bool kf = true;
            put_member(sb, "frame", r2d_json_get(k, "frame"), &kf);
            if (r2d_json_get(k, "bounds")) {
                if (!kf) r2d_sb_puts(sb, ", ");
                kf = false;
                r2d_sb_puts(sb, "\"bounds\": ");
                put_box(sb, r2d_json_get(k, "bounds"));
            }
            const R2dJson *pv = r2d_json_get(k, "pivot");
            if (pv) {
                if (!kf) r2d_sb_puts(sb, ", ");
                kf = false;
                r2d_sb_puts(sb, "\"pivot\": ");
                sdk_json_put_compact(sb, pv);
            }
            put_extras(sb, k, key_known, 3, &kf);
            r2d_sb_putc(sb, '}');
        }
        r2d_sb_putc(sb, ']');
    }
    put_extras(sb, s, known, 3, &first);
    r2d_sb_putc(sb, '}');
}

// Массив объектов: по элементу на строке.
static void put_lines(R2dSb *sb, const char *indent, const R2dJson *arr, void (*one)(R2dSb *, const R2dJson *))
{
    if (!arr || arr->count == 0) {
        r2d_sb_puts(sb, "[]");
        return;
    }
    r2d_sb_puts(sb, "[\n");
    for (int i = 0; i < arr->count; ++i) {
        r2d_sb_printf(sb, "%s  ", indent);
        one(sb, arr->items[i]);
        r2d_sb_puts(sb, i + 1 < arr->count ? ",\n" : "\n");
    }
    r2d_sb_printf(sb, "%s]", indent);
}

static bool frames_canonicalizable(const R2dJson *root, SdkReport *rep, const char *asset)
{
    if (!is_obj(root)) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_ROOT", asset, NULL, NULL, "Корень атласа должен быть объектом");
        return false;
    }
    const R2dJson *frames = r2d_json_get(root, "frames");
    if (!is_obj(frames)) {
        sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_FORMAT_UNSUPPORTED", asset, NULL, NULL,
                 "Канонический вид есть только у атласа с frames-объектом (имя → кадр); массивный вид TexturePacker не переписывается");
        return false;
    }
    return true;
}

char *sdk_atlas_canonical(const R2dJson *root, SdkReport *rep, const char *asset)
{
    if (!frames_canonicalizable(root, rep, asset)) return NULL;
    static const char *const meta_known[] = { "app", "version", "image", "size", "frameTags", "slices", "custom" };
    static const char *const root_known[] = { "meta", "frames" };

    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_puts(&sb, "{\n");
    bool first_root = true;

    const R2dJson *meta = r2d_json_get(root, "meta");
    if (meta) {
        r2d_sb_puts(&sb, "  \"meta\": {\n");
        bool first = true;
        for (int i = 0; i < 7; ++i) {
            const R2dJson *v = r2d_json_get(meta, meta_known[i]);
            if (!v) continue;
            if (!first) r2d_sb_puts(&sb, ",\n");
            first = false;
            r2d_sb_printf(&sb, "    \"%s\": ", meta_known[i]);
            if (strcmp(meta_known[i], "frameTags") == 0 && is_arr(v)) put_lines(&sb, "    ", v, put_tag);
            else if (strcmp(meta_known[i], "slices") == 0 && is_arr(v)) put_lines(&sb, "    ", v, put_slice);
            else sdk_json_put_compact(&sb, v);
        }
        for (int i = 0; i < meta->count; ++i) {
            if (in_list(meta->keys[i], meta_known, 7)) continue;
            if (!first) r2d_sb_puts(&sb, ",\n");
            first = false;
            r2d_sb_puts(&sb, "    ");
            r2d_sb_put_json_string(&sb, meta->keys[i]);
            r2d_sb_puts(&sb, ": ");
            sdk_json_put_compact(&sb, meta->items[i]);
        }
        r2d_sb_puts(&sb, first ? "  }" : "\n  }");
        first_root = false;
    }

    const R2dJson *frames = r2d_json_get(root, "frames");
    if (!first_root) r2d_sb_puts(&sb, ",\n");
    r2d_sb_puts(&sb, "  \"frames\": ");
    if (frames->count == 0) {
        r2d_sb_puts(&sb, "{}");
    } else {
        r2d_sb_puts(&sb, "{\n");
        for (int i = 0; i < frames->count; ++i) {
            r2d_sb_puts(&sb, "    ");
            r2d_sb_put_json_string(&sb, frames->keys[i]);
            r2d_sb_puts(&sb, ": ");
            put_frame_entry(&sb, frames->items[i]);
            r2d_sb_puts(&sb, i + 1 < frames->count ? ",\n" : "\n");
        }
        r2d_sb_puts(&sb, "  }");
    }

    for (int i = 0; i < root->count; ++i) {
        if (in_list(root->keys[i], root_known, 2)) continue;
        r2d_sb_puts(&sb, ",\n  ");
        r2d_sb_put_json_string(&sb, root->keys[i]);
        r2d_sb_puts(&sb, ": ");
        sdk_json_put_compact(&sb, root->items[i]);
    }
    r2d_sb_puts(&sb, "\n}\n");
    return r2d_sb_take(&sb);
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------
static void emit(R2dSb *out)
{
    puts(out->data);
    fflush(stdout);
}

// Относительный путь `to` от каталога `from_dir` (оба — как переданы в CLI).
static void relative_path(const char *from_dir, const char *to, char *out, size_t cap)
{
    char to_dir[1024];
    sdk_dirname(to, to_dir, sizeof to_dir);
    if (strcmp(from_dir, to_dir) == 0) {
        snprintf(out, cap, "%s", sdk_basename(to));
        return;
    }
    const size_t lf = strlen(from_dir);
    if (strncmp(to, from_dir, lf) == 0 && to[lf] == '/') {
        snprintf(out, cap, "%s", to + lf + 1);
        return;
    }
    // Общий префикс по сегментам.
    size_t common = 0, i = 0;
    while (from_dir[i] && to[i] && from_dir[i] == to[i]) {
        if (from_dir[i] == '/') common = i + 1;
        ++i;
    }
    int ups = 0;
    for (size_t k = common; from_dir[k]; ++k) if (from_dir[k] == '/') ups++;
    if (from_dir[common]) ups++;
    out[0] = '\0';
    for (int u = 0; u < ups; ++u) strncat(out, "../", cap - strlen(out) - 1);
    strncat(out, to + common, cap - strlen(out) - 1);
}

// Разбор «idle:0-3,walk:4-9» → массив тегов в JSON-тексте.
static bool tags_from_spec(const char *spec, int frame_count, R2dSb *json, SdkReport *rep)
{
    char buf[1024];
    snprintf(buf, sizeof buf, "%s", spec);
    bool first = true;
    char *save = NULL;
    for (char *item = strtok_r(buf, ",", &save); item; item = strtok_r(NULL, ",", &save)) {
        char *colon = strchr(item, ':');
        int from = 0, to = 0;
        if (!colon || sscanf(colon + 1, "%d-%d", &from, &to) != 2) {
            sdk_diag(rep, SDK_ERROR, "SDK_USAGE", NULL, NULL, NULL, "Тег «%s»: ожидалось имя:от-до (например idle:0-3)", item);
            return false;
        }
        *colon = '\0';
        if (from < 0 || to < from || to >= frame_count) {
            char d[128];
            snprintf(d, sizeof d, "{\"from\":%d,\"to\":%d,\"frames\":%d}", from, to, frame_count);
            sdk_diag(rep, SDK_ERROR, "SDK_ATLAS_TAG_RANGE", NULL, NULL, d, "Тег «%s»: диапазон %d..%d вне кадров 0..%d",
                     item, from, to, frame_count - 1);
            return false;
        }
        if (!first) r2d_sb_putc(json, ',');
        first = false;
        r2d_sb_puts(json, "{\"name\":");
        r2d_sb_put_json_string(json, item);
        r2d_sb_printf(json, ",\"from\":%d,\"to\":%d,\"direction\":\"forward\",\"loop\":true}", from, to);
    }
    return true;
}

int sdk_cmd_atlas_grid(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *png = sdk_arg_positional(a, 0);
    const char *out_path = sdk_arg_value(a, "--out");
    if (!png || !out_path) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk atlas-grid <картинка> --out <файл.atlas.json> (--cols N --rows N | --cell WxH) "
            "[--prefix имя] [--duration мс] [--tags idle:0-3,walk:4-9]");
        sdk_report_free(&rep);
        return rc;
    }
    int w = 0, h = 0;
    if (!sdk_image_info(png, &w, &h)) {
        const int rc = sdk_fail(&rep, "SDK_ATLAS_IMAGE_MISSING", "Картинка не найдена или не читается: %s", png);
        sdk_report_free(&rep);
        return rc;
    }

    int cols = 0, rows = 0, cw = 0, ch = 0;
    const char *cell = sdk_arg_value(a, "--cell");
    if (cell) {
        if (sscanf(cell, "%dx%d", &cw, &ch) != 2 || cw <= 0 || ch <= 0) {
            const int rc = sdk_fail(&rep, "SDK_USAGE", "--cell ожидает WxH (например 32x32), получено «%s»", cell);
            sdk_report_free(&rep);
            return rc;
        }
        cols = w / cw;
        rows = h / ch;
    } else {
        const char *c = sdk_arg_value(a, "--cols");
        const char *r = sdk_arg_value(a, "--rows");
        cols = c ? atoi(c) : 0;
        rows = r ? atoi(r) : 0;
        if (cols <= 0 || rows <= 0) {
            const int rc = sdk_fail(&rep, "SDK_USAGE", "Нужны --cell WxH либо --cols N и --rows N");
            sdk_report_free(&rep);
            return rc;
        }
        cw = w / cols;
        ch = h / rows;
    }
    if (cols <= 0 || rows <= 0 || cw <= 0 || ch <= 0 || cols * rows > 4096) {
        const int rc = sdk_fail(&rep, "SDK_ATLAS_GRID", "Сетка %dx%d из картинки %dx%d некорректна (1..4096 кадров)", cols, rows, w, h);
        sdk_report_free(&rep);
        return rc;
    }
    if (cw * cols != w || ch * rows != h) {
        char d[160];
        snprintf(d, sizeof d, "{\"image\":[%d,%d],\"cell\":[%d,%d],\"grid\":[%d,%d]}", w, h, cw, ch, cols, rows);
        sdk_diag(&rep, SDK_WARNING, "SDK_ATLAS_GRID_REMAINDER", png, NULL, d,
                 "Картинка %dx%d не делится на клетки %dx%d нацело: остаток справа/снизу не попадёт в кадры", w, h, cw, ch);
    }

    const char *prefix_arg = sdk_arg_value(a, "--prefix");
    char prefix[128];
    if (prefix_arg) {
        snprintf(prefix, sizeof prefix, "%s", prefix_arg);
    } else {
        snprintf(prefix, sizeof prefix, "%s", sdk_basename(png));
        char *dot = strrchr(prefix, '.');
        if (dot) *dot = '\0';
    }
    const char *dur_arg = sdk_arg_value(a, "--duration");
    const int duration = dur_arg ? atoi(dur_arg) : 100;
    if (duration < 1 || duration > 600000) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "--duration должна быть 1..600000 мс");
        sdk_report_free(&rep);
        return rc;
    }

    char json_dir[1024], rel[1024];
    sdk_dirname(out_path, json_dir, sizeof json_dir);
    relative_path(json_dir, png, rel, sizeof rel);

    R2dSb doc;
    r2d_sb_init(&doc);
    r2d_sb_puts(&doc, "{\"meta\":{\"app\":\"r2d-sdk\",\"image\":");
    r2d_sb_put_json_string(&doc, rel);
    r2d_sb_printf(&doc, ",\"size\":{\"w\":%d,\"h\":%d}", w, h);
    const char *tags = sdk_arg_value(a, "--tags");
    if (tags) {
        R2dSb tag_json;
        r2d_sb_init(&tag_json);
        const bool ok = tags_from_spec(tags, cols * rows, &tag_json, &rep);
        if (ok) r2d_sb_printf(&doc, ",\"frameTags\":[%s]", tag_json.data ? tag_json.data : "");
        r2d_sb_free(&tag_json);
        if (!ok) {
            R2dSb out;
            r2d_sb_init(&out);
            r2d_sb_puts(&out, "{\"ok\":false,");
            sdk_report_put_counts(&rep, &out);
            r2d_sb_putc(&out, ',');
            sdk_report_put(&rep, &out);
            r2d_sb_putc(&out, '}');
            emit(&out);
            r2d_sb_free(&out);
            r2d_sb_free(&doc);
            sdk_report_free(&rep);
            return 1;
        }
    }
    r2d_sb_puts(&doc, "},\"frames\":{");
    int index = 0;
    for (int r = 0; r < rows; ++r) {
        for (int c = 0; c < cols; ++c, ++index) {
            if (index) r2d_sb_putc(&doc, ',');
            char name[160];
            snprintf(name, sizeof name, "%s_%d", prefix, index);
            r2d_sb_put_json_string(&doc, name);
            r2d_sb_printf(&doc, ":{\"frame\":{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d},\"duration\":%d}",
                          c * cw, r * ch, cw, ch, duration);
        }
    }
    r2d_sb_puts(&doc, "}}");

    char err[128];
    R2dJson *root = r2d_json_parse(doc.data, err, sizeof err);
    r2d_sb_free(&doc);
    char *text = root ? sdk_atlas_canonical(root, &rep, out_path) : NULL;
    r2d_json_free(root);
    bool written = false;
    if (text) {
        char dir[1024];
        sdk_dirname(out_path, dir, sizeof dir);
        if (!sdk_is_dir(dir)) {
            SDL_CreateDirectory(dir);
        }
        written = sdk_write_file(out_path, text, strlen(text));
        if (!written) sdk_diag(&rep, SDK_ERROR, "SDK_WRITE_FAILED", out_path, NULL, NULL, "Не удалось записать %s", out_path);
        free(text);
    }
    if (written) sdk_validate_atlas(out_path, &rep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", written && rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "out", out_path);
    r2d_sb_printf(&out, ",\"frames\":%d,\"cols\":%d,\"rows\":%d,\"cell\":[%d,%d],\"image\":{", cols * rows, cols, rows, cw, ch);
    sdk_put_kv_str(&out, "path", rel);
    r2d_sb_printf(&out, ",\"w\":%d,\"h\":%d},", w, h);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);
    const int rc = written && rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_atlas_format(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *path = sdk_arg_positional(a, 0);
    if (!path) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk atlas-format <файл.atlas.json> [--write] [--text]");
        sdk_report_free(&rep);
        return rc;
    }
    R2dJson *root = sdk_load_json(path, &rep);
    char *text = root ? sdk_atlas_canonical(root, &rep, path) : NULL;
    char *old = root ? sdk_read_file(path, NULL) : NULL;
    const bool changed = text && old && strcmp(text, old) != 0;
    bool wrote = false;
    if (text && changed && sdk_arg_flag(a, "--write")) {
        wrote = sdk_write_file(path, text, strlen(text));
        if (!wrote) sdk_diag(&rep, SDK_ERROR, "SDK_WRITE_FAILED", path, NULL, NULL, "Не удалось записать %s", path);
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", text && rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "asset", path);
    r2d_sb_printf(&out, ",\"changed\":%s,\"written\":%s,\"bytes\":%zu,", changed ? "true" : "false",
                  wrote ? "true" : "false", text ? strlen(text) : (size_t)0);
    if (text && sdk_arg_flag(a, "--text")) {
        sdk_put_kv_str(&out, "text", text);
        r2d_sb_putc(&out, ',');
    }
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);
    const int rc = text && rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    free(text);
    free(old);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_atlas_info(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *path = sdk_arg_positional(a, 0);
    if (!path) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk atlas-info <файл.atlas.json>");
        sdk_report_free(&rep);
        return rc;
    }
    R2dJson *root = sdk_load_json(path, &rep);
    R2dSb out;
    r2d_sb_init(&out);
    AtlasFrame *frames = NULL;
    int n = 0;
    if (root && is_obj(root)) n = collect_frames(root, &frames, &rep, path);
    sdk_validate_atlas(path, &rep);

    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "asset", path);
    r2d_sb_puts(&out, ",\"image\":");
    const char *image = root ? image_field(root) : NULL;
    if (image) {
        char dir[1024], full[2048];
        sdk_dirname(path, dir, sizeof dir);
        sdk_join(dir, image, full, sizeof full);
        int w = 0, h = 0;
        const bool known = sdk_image_info(full, &w, &h);
        r2d_sb_putc(&out, '{');
        sdk_put_kv_str(&out, "path", image);
        r2d_sb_printf(&out, ",\"exists\":%s,\"w\":%d,\"h\":%d}", sdk_file_exists(full) ? "true" : "false", known ? w : 0, known ? h : 0);
    } else {
        r2d_sb_puts(&out, "null");
    }
    r2d_sb_puts(&out, ",\"frames\":[");
    for (int i = 0; i < n; ++i) {
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_putc(&out, '{');
        sdk_put_kv_str(&out, "name", frames[i].name);
        r2d_sb_printf(&out, ",\"x\":%g,\"y\":%g,\"w\":%g,\"h\":%g,\"duration\":", frames[i].x, frames[i].y, frames[i].w, frames[i].h);
        if (frames[i].has_duration) r2d_sb_printf(&out, "%g", frames[i].duration);
        else r2d_sb_puts(&out, "null");
        r2d_sb_putc(&out, '}');
    }
    r2d_sb_puts(&out, "],\"tags\":");
    const R2dJson *tags = root ? r2d_json_get(r2d_json_get(root, "meta"), "frameTags") : NULL;
    if (tags) sdk_json_put_compact(&out, tags);
    else r2d_sb_puts(&out, "[]");
    r2d_sb_puts(&out, ",\"slices\":[");
    const R2dJson *slices = root ? r2d_json_get(r2d_json_get(root, "meta"), "slices") : NULL;
    for (int i = 0; slices && i < slices->count; ++i) {
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_put_json_string(&out, r2d_json_str(r2d_json_get(slices->items[i], "name"), ""));
    }
    r2d_sb_puts(&out, "],");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);
    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    free(frames);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}
