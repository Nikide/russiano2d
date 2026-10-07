// ===========================================================================
// Шрифты: stb_truetype → атлас глифов → спрайты в общем батче кадра.
// См. src/font.h — зачем это вместо очереди текста поверх сцены.
// ===========================================================================

#include "font.h"
#include "payload.h"   // r2d_vfs_has/read: шрифты могут лежать в грузе игры

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include <SDL3/SDL.h>

#define STB_TRUETYPE_IMPLEMENTATION
#include <stb_truetype.h>

// ---------------------------------------------------------------------------
// Состояние подсистемы
// ---------------------------------------------------------------------------

typedef struct R2DGlyph {
    int   x, y;        // позиция битмапа в атласе
    int   w, h;        // размер битмапа (может быть 0 — пробел)
    float xoff, yoff;  // смещение от курсора до левого верхнего угла битмапа
    float xadv;        // насколько сдвинуть курсор после глифа
    int   sprite;      // id спрайта в атласе; -1 — ещё не создан
    bool  missing;     // символа нет в шрифте — рисуем пустоту, но двигаем курсор
} R2DGlyph;

enum { R2D_FONT_GLYPH_CACHE = 1024 };

typedef struct R2DGlyphCache {
    unsigned int codepoint;
    float        size;       // точный кегль, для которого растеризован глиф
    int          height;     // округлённый кегль — ключ кэша
    R2DGlyph     glyph;
} R2DGlyphCache;

typedef struct R2DFont {
    char             name[64];
    unsigned char   *data;      // владеемая копия файла шрифта
    size_t           data_size;
    stbtt_fontinfo   info;
    bool             ready;
    R2DGlyphCache    cache[R2D_FONT_GLYPH_CACHE];
    unsigned int     cache_mask;
    struct R2DFont  *next;
} R2DFont;

static struct {
    R2DRenderer *renderer;
    R2DFont     *fonts;
    R2DFont     *default_font;
    char         base_path[2048];

    // Атлас: RGBA8, белый цвет с альфой глифа. Растёт по мере надобности.
    unsigned char *atlas;
    int            atlas_w, atlas_h;
    int            pack_x, pack_y, row_h;
    int            texture;        // id текстуры в рендерере, -1 пока нет
    bool           atlas_dirty;    // нужна полная перезаливка (новая текстура)
    bool           need_upload;    // есть новые глифы, не уехавшие в GPU
    int            synced_y;       // до какой строки атлас уже уехал в GPU

    int  glyph_count;
    int  drawn_total;   // сколько глифов ушло в батч с запуска (тесты)
    int  first_sprite;  // первый спрайт глифа — тесты рисуют его напрямую
    bool inited;
    char pick[4096];   // путь, выбранный перебором каталога шрифтов
} g;

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------

static const R2DGlyph *glyph_get(R2DFont *font, unsigned int codepoint, float size);
static void atlas_sync(void);

static int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Кегль квантуется: атлас на каждый пиксель кегля распух бы, а разница в
// растеризации между 16 и 17 px всё равно незаметна — масштабируем спрайт.
static int size_bucket(float size)
{
    int h = (int)(size + 0.5f);
    if (h < 6) return 6;
    if (h <= 32) return h;
    if (h <= 48) return ((h + 3) / 4) * 4;
    if (h <= 96) return ((h + 7) / 8) * 8;
    return ((h + 15) / 16) * 16;
}

// Разбор UTF-8: возвращает кодпоинт и число прочитанных байт (>= 1).
static unsigned int utf8_next(const char *s, int *advance)
{
    const unsigned char *p = (const unsigned char *)s;
    if (p[0] < 0x80u) { *advance = 1; return p[0]; }
    if ((p[0] & 0xE0u) == 0xC0u && (p[1] & 0xC0u) == 0x80u) {
        *advance = 2;
        return ((unsigned int)(p[0] & 0x1Fu) << 6) | (unsigned int)(p[1] & 0x3Fu);
    }
    if ((p[0] & 0xF0u) == 0xE0u && (p[1] & 0xC0u) == 0x80u && (p[2] & 0xC0u) == 0x80u) {
        *advance = 3;
        return ((unsigned int)(p[0] & 0x0Fu) << 12) |
               ((unsigned int)(p[1] & 0x3Fu) << 6) | (unsigned int)(p[2] & 0x3Fu);
    }
    if ((p[0] & 0xF8u) == 0xF0u && (p[1] & 0xC0u) == 0x80u && (p[2] & 0xC0u) == 0x80u &&
        (p[3] & 0xC0u) == 0x80u) {
        *advance = 4;
        return ((unsigned int)(p[0] & 0x07u) << 18) |
               ((unsigned int)(p[1] & 0x3Fu) << 12) |
               ((unsigned int)(p[2] & 0x3Fu) << 6) | (unsigned int)(p[3] & 0x3Fu);
    }
    *advance = 1;
    return 0xFFFDu;   // невалидный байт — replacement character
}

// ---------------------------------------------------------------------------
// Атлас
// ---------------------------------------------------------------------------

static bool atlas_reserve(int w, int h)
{
    if (g.atlas && w <= g.atlas_w && h <= g.atlas_h) return true;

    int new_w = g.atlas ? g.atlas_w : 256;
    int new_h = g.atlas ? g.atlas_h : 256;
    while (new_w < w && new_w < 2048) new_w *= 2;
    while (new_h < h && new_h < 4096) new_h *= 2;
    if (new_w < w || new_h < h) {
        R2D_ERROR("шрифт: атлас глифов переполнен (%dx%d)", w, h);
        return false;
    }

    unsigned char *buffer = (unsigned char *)calloc((size_t)new_w * (size_t)new_h * 4u, 1);
    if (!buffer) {
        R2D_ERROR("шрифт: нет памяти под атлас %dx%d", new_w, new_h);
        return false;
    }
    if (g.atlas) {
        // Копируем построчно: ширина изменилась, сплошная копия не подходит.
        for (int y = 0; y < g.pack_y && y < g.atlas_h; ++y) {
            memcpy(buffer + (size_t)y * new_w * 4u, g.atlas + (size_t)y * g.atlas_w * 4u,
                   (size_t)g.atlas_w * 4u);
        }
        free(g.atlas);
    }
    g.atlas = buffer;
    g.atlas_w = new_w;
    g.atlas_h = new_h;
    g.atlas_dirty = true;   // текстуру создадим/перезальём в начале кадра
    return true;
}

// Находит место под битмап w×h в атласе. Простая полочная упаковка: глифы
// одного кегля почти одинаковой высоты, поэтому ложится плотно.
static bool atlas_place(int w, int h, int *out_x, int *out_y)
{
    if (w <= 0 || h <= 0) { *out_x = 0; *out_y = 0; return true; }
    if (g.pack_x + w > g.atlas_w) {
        g.pack_x = 0;
        g.pack_y += g.row_h + 1;
        g.row_h = 0;
    }
    if (g.pack_y + h > g.atlas_h) {
        if (!atlas_reserve(g.atlas_w, g.pack_y + h + 8)) return false;
    }
    *out_x = g.pack_x;
    *out_y = g.pack_y;
    g.pack_x += w + 1;
    if (h > g.row_h) g.row_h = h;
    return true;
}

// ---------------------------------------------------------------------------
// Глифы
// ---------------------------------------------------------------------------

static const R2DGlyph *glyph_rasterize(R2DFont *font, unsigned int cp, float size, int height)
{
    const int slot = (int)(cp & (unsigned int)(R2D_FONT_GLYPH_CACHE - 1));
    for (int probe = 0; probe < R2D_FONT_GLYPH_CACHE; ++probe) {
        R2DGlyphCache *entry = &font->cache[(slot + probe) & (R2D_FONT_GLYPH_CACHE - 1)];
        if (entry->codepoint == 0) {
            // Пустая ячейка — вставляем сюда.
            const int glyph = stbtt_FindGlyphIndex(&font->info, (int)cp);
            const float scale = stbtt_ScaleForPixelHeight(&font->info, size);

            entry->codepoint = cp;
            entry->height = height;
            entry->size = size;
            R2DGlyph *out = &entry->glyph;
            memset(out, 0, sizeof *out);
            out->sprite = -1;

            int advance = 0;
            int bearing = 0;
            stbtt_GetGlyphHMetrics(&font->info, glyph, &advance, &bearing);
            out->xadv = (float)advance * scale;

            if (glyph == 0) {
                // Символа нет: курсор двигаем, пустоту рисуем — так строка не
                // «слипается» и поведение совпадает у всех шрифтов.
                out->missing = true;
                g.glyph_count++;
                return out;
            }

            int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
            stbtt_GetGlyphBitmapBox(&font->info, glyph, scale, scale, &x0, &y0, &x1, &y1);
            const int bw = x1 - x0;
            const int bh = y1 - y0;
            out->xoff = (float)x0;
            out->yoff = (float)y0;
            out->w = bw;
            out->h = bh;

            if (bw > 0 && bh > 0) {
                int px = 0, py = 0;
                if (!atlas_place(bw, bh, &px, &py)) {
                    out->missing = true;
                    g.glyph_count++;
                    return out;
                }
                unsigned char *bitmap = (unsigned char *)malloc((size_t)bw * (size_t)bh);
                if (!bitmap) {
                    out->missing = true;
                    g.glyph_count++;
                    return out;
                }
                stbtt_MakeGlyphBitmap(&font->info, bitmap, bw, bh, bw, scale, scale, glyph);
                for (int y = 0; y < bh; ++y) {
                    for (int x = 0; x < bw; ++x) {
                        const unsigned char alpha = bitmap[(size_t)y * bw + x];
                        if (!alpha) continue;   // атлас уже прозрачный
                        unsigned char *dst = g.atlas +
                            ((size_t)(py + y) * (size_t)g.atlas_w + (size_t)(px + x)) * 4u;
                        dst[0] = 255; dst[1] = 255; dst[2] = 255;
                        // Максимум, а не замена: перекрытие возможно на
                        // округлении, и «стереть» соседний глиф нельзя.
                        if (alpha > dst[3]) dst[3] = alpha;
                    }
                }
                free(bitmap);
                out->x = px;
                out->y = py;
                // Атлас мог только что вырасти: текстура обязана существовать
                // до того, как спрайт глифа будет создан (r2d_sprite_create с
                // текстурой -1 отказывает, и текст молча исчезает).
                g.need_upload = true;
                atlas_sync();
            }
            g.glyph_count++;
            return out;
        }
        if (entry->codepoint == cp && entry->height == height) return &entry->glyph;
    }

    // Кэш забит: перезаписываем ячейку по базовому индексу — атлас при этом не
    // чистим, старые глифы остаются валидными.
    R2DGlyphCache *entry = &font->cache[slot];
    entry->codepoint = 0;
    return glyph_rasterize(font, cp, size, height);
}

static const R2DGlyph *glyph_get(R2DFont *font, unsigned int cp, float size)
{
    if (!font || !font->ready) return NULL;
    const int height = size_bucket(size);
    return glyph_rasterize(font, cp, size, height);
}

// ---------------------------------------------------------------------------
// Синхронизация атласа с GPU
// ---------------------------------------------------------------------------

static void atlas_sync(void)
{
    R2DRenderer *r = g.renderer;
    if (!r || !g.atlas) return;

    if (g.atlas_dirty) {
        // Атлас вырос: старую текстуру освободить нельзя (нет API выгрузки),
        // поэтому создаём новую и заливаем её целиком. Рост случается редко.
        if (g.texture >= 0) g.texture = -1;
    }

    if (g.texture < 0) {
        g.texture = r2d_texture_create_rgba(r, g.atlas, g.atlas_w, g.atlas_h);
        if (g.texture < 0) {
            R2D_ERROR("шрифт: не удалось создать текстуру атласа %dx%d", g.atlas_w, g.atlas_h);
            return;
        }
        g.atlas_dirty = false;
        g.need_upload = false;
        g.synced_y = g.pack_y;
        return;
    }

    // Атлас вырос — текстуру создали заново, и она пустая: заливаем целиком.
    if (g.atlas_dirty) {
        r2d_texture_upload_region(r, g.texture, 0, 0, g.atlas_w, g.atlas_h,
                                  g.atlas, g.atlas_w * 4);
        g.atlas_dirty = false;
        g.need_upload = false;
        g.synced_y = g.pack_y;
        return;
    }

    // Новые глифы за прошлый кадр: заливаем атлас целиком.
    //
    // Полосками было бы дешевле, но «новые глифы» — это не один диапазон
    // строк: глифы разных кеглей ложатся в разные полки, и часть строк
    // оставалась незалитой (текст рисовался наполовину). Атлас 256×256 —
    // это 256 КБ, заливка раз в кадр дешевле, чем невидимые буквы.
    if (g.need_upload) {
        r2d_texture_upload_region(r, g.texture, 0, 0, g.atlas_w, g.atlas_h,
                                  g.atlas, g.atlas_w * 4);
        g.need_upload = false;
        g.synced_y = g.pack_y;
    }
    (void)clampi;
}

// Регистрирует спрайты всех уже растеризованных глифов: спрайт — это
// прямоугольник текстуры, и его id нужен для батча. Идемпотентно.
static int glyph_sprite(R2DGlyph *glyph)
{
    if (glyph->w <= 0 || glyph->h <= 0) return -1;
    if (glyph->sprite >= 0) return glyph->sprite;

    glyph->sprite = r2d_sprite_create(g.renderer, g.texture,
                                      (float)glyph->x, (float)glyph->y,
                                      (float)glyph->w, (float)glyph->h);
    if (glyph->sprite >= 0 && g.first_sprite < 0) g.first_sprite = glyph->sprite;
    return glyph->sprite;
}

// ---------------------------------------------------------------------------
// Публичный API
// ---------------------------------------------------------------------------

// Первый найденный .ttf/.otf в каталоге: колбэк SDL_EnumerateDirectory.
static SDL_EnumerationResult SDLCALL r2d__pick_font(void *userdata, const char *dirname,
                                                    const char *fname)
{
    char *out = (char *)userdata;
    if (out[0]) return SDL_ENUM_SUCCESS;   // уже нашли
    const size_t len = SDL_strlen(fname);
    if (len < 5) return SDL_ENUM_CONTINUE;
    const char *ext = fname + len - 4;
    if (SDL_strcasecmp(ext, ".ttf") != 0 && SDL_strcasecmp(ext, ".otf") != 0) {
        return SDL_ENUM_CONTINUE;
    }
    SDL_snprintf(out, 4096, "%s/%s", dirname, fname);
    return SDL_ENUM_SUCCESS;
}

// Ищет .ttf/.otf в грузе игры или на диске и грузит первый как «default».
// Без этого игра обязана сама звать $.font.load (или engine.loadFont), а текст
// до этого не рисуется вовсе — молчаливое «чёрное ничто» вместо подписи.
static void autoload_default_font(void)
{
    // 1. Груз игры: перебираем его содержимое на assets/fonts/*.ttf|otf.
    const int files = r2d_vfs_count();
    for (int i = 0; i < files; ++i) {
        const char *path = r2d_vfs_path_at(i);
        if (!path) continue;
        const size_t len = SDL_strlen(path);
        if (len < 5) continue;
        if (!SDL_strstr(path, "assets/fonts/")) continue;
        const char *ext = path + len - 4;
        if (SDL_strcasecmp(ext, ".ttf") != 0 && SDL_strcasecmp(ext, ".otf") != 0) continue;
        if (r2d_font_load("default", path)) return;
    }

    // 2. Диск: обычный случай разработки (assets/fonts рядом с игрой).
    if (!g.base_path[0]) return;
    char dir[4096];
    SDL_snprintf(dir, sizeof dir, "%s/assets/fonts", g.base_path);

    // Каталог перебираем через SDL: файл нужен первый подходящий. Имя
    // складывается в статический буфер, потому что колбэк не имеет контекста.
    g.pick[0] = '\0';
    SDL_EnumerateDirectory(dir, r2d__pick_font, g.pick);
    if (g.pick[0]) r2d_font_load("default", g.pick);
}

bool r2d_font_init(R2DRenderer *renderer, const char *base_path)
{
    r2d_font_shutdown();
    memset(&g, 0, sizeof g);
    g.renderer = renderer;
    g.texture = -1;
    g.first_sprite = -1;
    if (base_path) {
        SDL_snprintf(g.base_path, sizeof g.base_path, "%s", base_path);
    }
    // Атлас создаём сразу: atlas_sync() выходит, пока его нет, а текстура
    // нужна до первого спрайта глифа (r2d_sprite_create с текстурой -1
    // отказывает, и текст молча не рисуется).
    if (!atlas_reserve(256, 256)) {
        R2D_ERROR("шрифт: не удалось выделить атлас глифов");
        return false;
    }

    g.inited = true;
    autoload_default_font();
    return true;
}

void r2d_font_shutdown(void)
{
    R2DFont *font = g.fonts;
    while (font) {
        R2DFont *next = font->next;
        free(font->data);
        free(font);
        font = next;
    }
    free(g.atlas);
    memset(&g, 0, sizeof g);
    g.texture = -1;
}

// Читает файл целиком: либо из груза игры, либо с диска.
static unsigned char *read_font_file(const char *path, size_t *out_size)
{
    unsigned char *data = NULL;
    size_t size = 0;

    if (r2d_vfs_has(path)) {
        data = r2d_vfs_read(path, &size);
    }
    if (!data) {
        data = (unsigned char *)SDL_LoadFile(path, &size);
    }
    if (!data && g.base_path[0]) {
        char full[4096];
        SDL_snprintf(full, sizeof full, "%s/%s", g.base_path, path);
        if (r2d_vfs_has(full)) data = r2d_vfs_read(full, &size);
        if (!data) data = (unsigned char *)SDL_LoadFile(full, &size);
    }
    if (!data) return NULL;
    *out_size = size;
    return data;
}

bool r2d_font_load(const char *name, const char *path)
{
    if (!g.inited || !name || !path) return false;

    size_t size = 0;
    unsigned char *data = read_font_file(path, &size);
    if (!data || size == 0) {
        R2D_WARN("шрифт: не найден файл %s", path);
        free(data);
        return false;
    }

    R2DFont *font = NULL;
    for (R2DFont *it = g.fonts; it; it = it->next) {
        if (SDL_strcmp(it->name, name) == 0) { font = it; break; }
    }
    if (!font) {
        font = (R2DFont *)calloc(1, sizeof *font);
        if (!font) { free(data); return false; }
        font->next = g.fonts;
        g.fonts = font;
    } else {
        free(font->data);
        memset(font->cache, 0, sizeof font->cache);
    }

    SDL_snprintf(font->name, sizeof font->name, "%s", name);
    font->data = data;
    font->data_size = size;

    const int offset = stbtt_GetFontOffsetForIndex(data, 0);
    if (offset < 0 || !stbtt_InitFont(&font->info, data, offset)) {
        R2D_WARN("шрифт: %s не разобрался как TrueType", path);
        font->ready = false;
        if (g.default_font == font) g.default_font = NULL;
        return false;
    }
    font->ready = true;
    if (!g.default_font) g.default_font = font;

    R2D_LOG("шрифт \"%s\": %s (%.1f КБ)", name, path, (double)size / 1024.0);
    return true;
}

const char *r2d_font_default(void) { return g.default_font ? g.default_font->name : NULL; }

int r2d_font_count(void)
{
    int n = 0;
    for (R2DFont *it = g.fonts; it; it = it->next) {
        if (it->ready) n++;
    }
    return n;
}

const char *r2d_font_name_at(int index)
{
    int i = 0;
    for (R2DFont *it = g.fonts; it; it = it->next) {
        if (!it->ready) continue;
        if (i == index) return it->name;
        i++;
    }
    return NULL;
}

static R2DFont *font_by_name(const char *family)
{
    if (!family || !*family) return g.default_font;
    for (R2DFont *it = g.fonts; it; it = it->next) {
        if (it->ready && SDL_strcmp(it->name, family) == 0) return it;
    }
    return g.default_font;
}

void r2d_font_begin_frame(void)
{
    if (!g.inited) return;
    atlas_sync();
}

void r2d_font_end_frame(void)
{
    // Кадр закончился: следующий begin_frame дозаливает то, что добавилось.
}

// Общая раскладка строки: измерение и рисование идут одним кодом, иначе они
// расходятся на кернинге и пробелах.
static void layout_line(const char *text, float size, float scale, R2DFont *font,
                        float x, float y, int align, int draw, uint32_t color, float angle,
                        float *out_w, float *out_h, int *out_glyphs)
{
    // Текстура атласа должна существовать ДО создания спрайтов глифов:
    // r2d_sprite_create с текстурой -1 отказывает, и текст молча исчезает.
    atlas_sync();

    const float unit = stbtt_ScaleForPixelHeight(&font->info, size);
    int ascent = 0, descent = 0, line_gap = 0;
    stbtt_GetFontVMetrics(&font->info, &ascent, &descent, &line_gap);
    const float asc = (float)ascent * unit;
    const float desc = (float)descent * unit;

    // Ширина заранее: для центрирования и выравнивания вправо.
    float width = 0.0f;
    unsigned int prev = 0;
    for (const char *p = text; *p;) {
        int adv = 1;
        const unsigned int cp = utf8_next(p, &adv);
        const R2DGlyph *glyph = glyph_get(font, cp, size);
        if (!glyph) break;
        if (prev) width += (float)stbtt_GetCodepointKernAdvance(&font->info, (int)prev, (int)cp) * unit;
        width += glyph->xadv;
        prev = cp;
        p += adv;
    }
    // Строка не должна «обрубаться» последним боковым выносом: берём ширину
    // курсора, это стандартное поведение измерения текста.
    // Масштаб применяется и к измерению: текст в сцене живёт в мировых
    // единицах, а на экран попадает через зум камеры.
    if (out_w) *out_w = width * scale;
    if (out_h) *out_h = (asc - desc) * scale;

    if (!draw) return;

    float pen = x;
    if (align == R2D_TEXT_ALIGN_CENTER) pen -= width * 0.5f;
    else if (align == R2D_TEXT_ALIGN_RIGHT) pen -= width;

    const float cos_a = cosf(angle);
    const float sin_a = sinf(angle);

    prev = 0;
    int drawn = 0;
    for (const char *p = text; *p;) {
        int adv = 1;
        const unsigned int cp = utf8_next(p, &adv);
        const R2DGlyph *glyph = glyph_get(font, cp, size);
        if (!glyph) break;
        if (prev) pen += (float)stbtt_GetCodepointKernAdvance(&font->info, (int)prev, (int)cp) * unit;

        if (glyph->w > 0 && glyph->h > 0) {
            // Спрайт создаём лениво: атлас к этому моменту уже залит в GPU.
            R2DGlyph *mutable_glyph = (R2DGlyph *)glyph;
            const int sprite = glyph_sprite(mutable_glyph);
            if (sprite >= 0) {
                const float gx = x + (pen - x + glyph->xoff) * scale;
                const float gy = y + (asc + glyph->yoff) * scale;
                // Масштаб: глиф растеризован под округлённый кегль, а рисуем
                // точным — разница до полупикселя, зато один атлас.
                const float s = (size / (float)size_bucket(size)) * scale;
                const float w = (float)glyph->w * s;
                const float h = (float)glyph->h * s;
                // Поворот вокруг точки привязки строки.
                const float ox = gx + w * 0.5f - x;
                const float oy = gy + h * 0.5f - y;
                const float rx = x + ox * cos_a - oy * sin_a;
                const float ry = y + ox * sin_a + oy * cos_a;
                r2d_batch_add(g.renderer, sprite, rx, ry, w, h, angle, color);
                g.drawn_total++;
                drawn++;
            }
        }
        pen += glyph->xadv;
        prev = cp;
        p += adv;
    }
    if (out_glyphs) *out_glyphs = drawn;
}

int r2d_font_draw(const char *text, float x, float y, float size, uint32_t color,
                  int align, const char *family, float angle, float scale)
{
    if (!g.inited || !text || !*text) return 0;
    R2DFont *font = font_by_name(family);
    if (!font) return 0;
    if (size < 4.0f) size = 4.0f;
    if (scale <= 0.0f) scale = 1.0f;

    int glyphs = 0;
    // Растеризуем и раскладываем; в батч попадают только готовые глифы.
    // Символ, растеризованный прямо сейчас, уедет в GPU в начале следующего
    // кадра — первый кадр нового кегля может не показать часть букв.
    layout_line(text, size, scale, font, x, y, align, 1, color, angle, NULL, NULL, &glyphs);
    return glyphs;
}

bool r2d_font_measure(const char *text, float size, const char *family,
                      float *out_w, float *out_h)
{
    if (out_w) *out_w = 0.0f;
    if (out_h) *out_h = 0.0f;
    if (!g.inited || !text) return false;
    R2DFont *font = font_by_name(family);
    if (!font) return false;
    if (size < 4.0f) size = 4.0f;
    layout_line(text, size, 1.0f, font, 0.0f, 0.0f, R2D_TEXT_ALIGN_LEFT, 0, 0xFFFFFFFF,
                0.0f, out_w, out_h, NULL);
    return true;
}

int r2d_font_drawn_total(void) { return g.drawn_total; }
int r2d_font_tex_id(void) { return g.texture; }
int r2d_font_first_sprite(void) { return g.first_sprite; }

int r2d_font_atlas_opaque(void)
{
    int opaque = 0;
    if (g.atlas) {
        const int total = g.atlas_w * g.atlas_h;
        for (int i = 0; i < total; ++i) if (g.atlas[i * 4 + 3]) opaque++;
    }
    return opaque;
}

void r2d_font_stats(int *glyph_count, int *atlas_w, int *atlas_h)
{
    if (glyph_count) *glyph_count = g.glyph_count;
    if (atlas_w) *atlas_w = g.atlas_w;
    if (atlas_h) *atlas_h = g.atlas_h;
}
