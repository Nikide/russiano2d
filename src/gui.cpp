// ===========================================================================
// Реализация игрового GUI на RmlUi.
//
// Используются штатные бэкенды RmlUi:
//   Backends/RmlUi_Platform_SDL.cpp      — SystemInterface_SDL
//   Backends/RmlUi_Renderer_SDL_GPU.cpp  — RenderInterface_SDL_GPU
// Их исходники подключаются напрямую в наш исполняемый файл (см. src/CMakeLists.txt),
// потому что мы сами владеем окном и GPU-устройством.
// ===========================================================================

#include "gui.h"

#include "payload.h"

#include "icons.h"

#include <RmlUi/Core.h>

#include "RmlUi_Platform_SDL.h"
#include "RmlUi_Renderer_SDL_GPU.h"

#include <SDL3/SDL.h>

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr int kMaxDocuments = 64;

// ---------------------------------------------------------------------------
// Файловый интерфейс: все пути RmlUi разрешает относительно базового каталога
// игры, а не относительно текущего каталога процесса.
// ---------------------------------------------------------------------------
// Открытый файл из груза: данные лежат в памяти движка, поэтому «дескриптор» —
// это просто позиция чтения. Магия нужна, чтобы отличить такой дескриптор от
// обычного FILE* в одной и той же паре Open/Read/Close.
class MemoryFile {
public:
    static constexpr uint32_t kMagic = 0x4D454D46u;   // "MEMF"

    MemoryFile(const unsigned char *data, size_t size) : data_(data), size_(size) {}

    const unsigned char *data_;
    size_t size_;
    size_t pos_ = 0;
    uint32_t magic_ = kMagic;
};

inline MemoryFile *as_memory(Rml::FileHandle handle)
{
    if (handle == 0) return nullptr;
    auto *file = reinterpret_cast<MemoryFile *>(handle);
    if (!file || file->magic_ != MemoryFile::kMagic) return nullptr;
    return file;
}

inline Rml::FileHandle to_handle(MemoryFile *file)
{
    return reinterpret_cast<Rml::FileHandle>(file);
}

class BasePathFileInterface : public Rml::FileInterface {
public:
    explicit BasePathFileInterface(std::string base) : base_(std::move(base)) {}

    Rml::FileHandle Open(const Rml::String &path) override
    {
        // Груз собранной игры: файл уже в памяти, диск не нужен.
        if (r2d_vfs_has(path.c_str())) {
            size_t size = 0;
            uint8_t *data = r2d_vfs_read(path.c_str(), &size);
            if (data) return to_handle(new MemoryFile(data, size));
        }
        return OpenOnDisk(path);
    }

private:
    Rml::FileHandle OpenOnDisk(const Rml::String &path)
    {
        // Пути документов RmlUi отсчитываются от каталога игры: в проекте это
        // game/ui/menu.rml, а из JS пишут engine.ui.load('ui/menu.rml').
        // Проверяем три варианта по порядку, чтобы работали обе формы записи
        // и чтобы UI можно было держать и вне game/.
        std::string candidates[3];
        const std::string root = base_.empty() ? std::string() : base_ + "/";
        candidates[0] = root + "game/" + path;
        candidates[1] = root + path;
        candidates[2] = path;

        for (const std::string &c : candidates) {
            if (c.empty()) continue;
            std::FILE *f = std::fopen(c.c_str(), "rb");
            if (f) return reinterpret_cast<Rml::FileHandle>(f);
        }

        Rml::Log::Message(Rml::Log::LT_WARNING, "не удалось открыть файл для RmlUi: %s",
                          candidates[0].c_str());
        return reinterpret_cast<Rml::FileHandle>(nullptr);
    }

    void Close(Rml::FileHandle file) override
    {
        if (MemoryFile *mem = as_memory(file)) {
            delete mem;
            return;
        }
        if (file) std::fclose(reinterpret_cast<std::FILE *>(file));
    }

    size_t Read(void *buffer, size_t size, Rml::FileHandle file) override
    {
        if (MemoryFile *mem = as_memory(file)) {
            const size_t left = mem->size_ - mem->pos_;
            const size_t take = size < left ? size : left;
            std::memcpy(buffer, mem->data_ + mem->pos_, take);
            mem->pos_ += take;
            return take;
        }
        if (!file) return 0;
        return std::fread(buffer, 1, size, reinterpret_cast<std::FILE *>(file));
    }

    bool Seek(Rml::FileHandle file, long offset, int origin) override
    {
        if (MemoryFile *mem = as_memory(file)) {
            long base = static_cast<long>(mem->pos_);
            if (origin == SEEK_SET) base = 0;
            else if (origin == SEEK_END) base = static_cast<long>(mem->size_);
            const long target = base + offset;
            if (target < 0 || static_cast<size_t>(target) > mem->size_) return false;
            mem->pos_ = static_cast<size_t>(target);
            return true;
        }
        if (!file) return false;
        return std::fseek(reinterpret_cast<std::FILE *>(file), offset, origin) == 0;
    }

    size_t Tell(Rml::FileHandle file) override
    {
        if (MemoryFile *mem = as_memory(file)) return mem->pos_;
        if (!file) return 0;
        return static_cast<size_t>(std::ftell(reinterpret_cast<std::FILE *>(file)));
    }

    size_t Length(Rml::FileHandle file) override
    {
        if (MemoryFile *mem = as_memory(file)) return mem->size_;
        if (!file) return 0;
        std::FILE *f = reinterpret_cast<std::FILE *>(file);
        const long cur = std::ftell(f);
        std::fseek(f, 0, SEEK_END);
        const long end = std::ftell(f);
        std::fseek(f, cur, SEEK_SET);
        return static_cast<size_t>(end < 0 ? 0 : end);
    }

private:
    std::string base_;
};

// ---------------------------------------------------------------------------
// Слушатель события RmlUi, который дёргает JS-функцию через dispatch.
// ---------------------------------------------------------------------------
class JsEventListener : public Rml::EventListener {
public:
    JsEventListener(int callback_id, std::string element_id, std::string event_name)
        : callback_id_(callback_id), element_id_(std::move(element_id)), event_name_(std::move(event_name)) {}

    void ProcessEvent(Rml::Event & /*event*/) override
    {
        if (dispatch_) {
            dispatch_(dispatch_user_, callback_id_, element_id_.c_str(), event_name_.c_str());
        }
    }

    void OnDetach(Rml::Element * /*element*/) override { delete this; }

    static void SetDispatch(R2DGuiEventFn fn, void *user)
    {
        dispatch_ = fn;
        dispatch_user_ = user;
    }

private:
    int         callback_id_;
    std::string element_id_;
    std::string event_name_;

    static R2DGuiEventFn dispatch_;
    static void          *dispatch_user_;
};

R2DGuiEventFn JsEventListener::dispatch_ = nullptr;
void          *JsEventListener::dispatch_user_ = nullptr;

}  // namespace

// ---------------------------------------------------------------------------
// Структура модуля
// ---------------------------------------------------------------------------
struct R2DGui {
    SDL_GPUDevice *device = nullptr;
    SDL_Window    *window = nullptr;

    SystemInterface_SDL   *system = nullptr;
    RenderInterface_SDL_GPU *renderer = nullptr;
    BasePathFileInterface *files = nullptr;

    Rml::Context *context = nullptr;

    Rml::ElementDocument *docs[kMaxDocuments] = {};
    std::string           doc_paths[kMaxDocuments];
    int                   doc_count = 0;

    R2DGuiEventFn dispatch = nullptr;
    void          *dispatch_user = nullptr;

    int width = 0;
    int height = 0;
    bool initialised = false;
};

// ---------------------------------------------------------------------------

R2DGui *r2d_gui_create(SDL_GPUDevice *device, SDL_Window *window, const char *base_path)
{
    R2DGui *g = new R2DGui();
    g->device = device;
    g->window = window;

    g->files = new BasePathFileInterface(base_path ? base_path : "");

    g->system = new SystemInterface_SDL(window);
    g->renderer = new RenderInterface_SDL_GPU(device, window);

    Rml::SetFileInterface(g->files);
    Rml::SetSystemInterface(g->system);
    Rml::SetRenderInterface(g->renderer);

    if (!Rml::Initialise()) {
        R2D_ERROR("Rml::Initialise() не удалась");
        delete g->renderer; delete g->system; delete g->files; delete g;
        return nullptr;
    }
    g->initialised = true;

    // Иконки Material Design встроены в бинарник: регистрируем их как запасной
    // шрифт, поэтому символы из Private Use Area можно подставлять в любой
    // текст интерфейса, не добавляя их в font-family.
    {
        unsigned int font_size = 0;
        const unsigned char *font_data = r2d_icon_font_data(&font_size);
        if (font_data && font_size > 0) {
            const Rml::Span<const Rml::byte> span(
                reinterpret_cast<const Rml::byte *>(font_data), font_size);
            if (Rml::LoadFontFace(span, "Material Icons", Rml::Style::FontStyle::Normal,
                                  Rml::Style::FontWeight::Normal, /*fallback_face=*/true)) {
                R2D_LOG("RmlUi: иконки Material Design встроены (%d шт.)", r2d_icon_total());
            } else {
                R2D_WARN("RmlUi: не удалось зарегистрировать встроенный шрифт иконок");
            }
        }
    }

    int w = 0, h = 0;
    SDL_GetWindowSizeInPixels(window, &w, &h);
    g->width = w > 0 ? w : 1280;
    g->height = h > 0 ? h : 720;

    g->context = Rml::CreateContext("main", Rml::Vector2i(g->width, g->height));
    if (!g->context) {
        R2D_ERROR("не удалось создать контекст RmlUi");
        Rml::Shutdown();
        delete g->renderer; delete g->system; delete g->files; delete g;
        return nullptr;
    }

    // Шрифты: берём все .ttf из assets/fonts. RmlUi без шрифта рисовать не умеет.
    // В собранной игре шрифты лежат в грузе — их данные должны жить весь
    // процесс, поэтому складываем буферы в статический список.
    {
        static std::vector<std::vector<unsigned char>> loaded_fonts;
        const int payload_files = r2d_vfs_count();
        for (int i = 0; i < payload_files; ++i) {
            const char *p = r2d_vfs_path_at(i);
            if (!p) continue;
            const size_t len = std::strlen(p);
            if (len < 5) continue;
            const char *ext = p + len - 4;
            if (SDL_strcasecmp(ext, ".ttf") != 0 && SDL_strcasecmp(ext, ".otf") != 0) continue;
            if (!std::strstr(p, "assets/fonts/")) continue;

            size_t size = 0;
            uint8_t *data = r2d_vfs_read(p, &size);
            if (!data || size == 0) continue;
            loaded_fonts.emplace_back(data, data + size);
            const auto &buffer = loaded_fonts.back();
            // Данные должны жить до Rml::Shutdown — поэтому буфер хранится в
            // статическом списке, а не освобождается после загрузки.
            if (Rml::LoadFontFace(Rml::Span<const Rml::byte>(buffer.data(), buffer.size()),
                                  "Noto Sans", Rml::Style::FontStyle::Normal,
                                  Rml::Style::FontWeight::Normal)) {
                R2D_LOG("RmlUi: шрифт из груза — %s", p);
            } else {
                R2D_WARN("RmlUi: не удалось загрузить шрифт из груза: %s", p);
            }
        }

        std::string dir = std::string(base_path ? base_path : "") + "/assets/fonts";
        std::vector<std::string> fonts;
        if (SDL_EnumerateDirectory(
                dir.c_str(),
                [](void *userdata, const char *dirname, const char *fname) -> SDL_EnumerationResult {
                    (void)dirname;
                    auto *out = static_cast<std::vector<std::string> *>(userdata);
                    const size_t len = std::strlen(fname);
                    if (len > 4) {
                        const char *ext = fname + len - 4;
                        if (SDL_strcasecmp(ext, ".ttf") == 0 || SDL_strcasecmp(ext, ".otf") == 0) {
                            out->emplace_back(fname);
                        }
                    }
                    return SDL_ENUM_CONTINUE;
                },
                &fonts)) {
            if (fonts.empty() && payload_files > 0) {
                // Шрифты уже загружены из груза: пустой каталог на диске —
                // это норма, а не повод для предупреждения.
            }
            for (const std::string &f : fonts) {
                const std::string full = dir + "/" + f;
                if (!Rml::LoadFontFace(full)) {
                    R2D_WARN("RmlUi: не удалось загрузить шрифт %s", full.c_str());
                } else {
                    R2D_LOG("RmlUi: шрифт %s", f.c_str());
                }
            }
        }
        if (fonts.empty()) {
            R2D_WARN("RmlUi: в %s нет .ttf/.otf — текст не будет отрисован", dir.c_str());
        }
    }

    R2D_LOG("RmlUi готов (версия %s)", Rml::GetVersion().c_str());
    return g;
}

void r2d_gui_destroy(R2DGui *g)
{
    if (!g) return;

    if (g->context) {
        // Закрываем документы до Shutdown.
        for (int i = 0; i < g->doc_count; ++i) {
            if (g->docs[i]) g->context->UnloadDocument(g->docs[i]);
        }
        Rml::RemoveContext("main");
        g->context = nullptr;
    }

    if (g->initialised) {
        Rml::Shutdown();
        g->initialised = false;
    }

    delete g->renderer;
    delete g->system;
    delete g->files;
    delete g;
}

void r2d_gui_process_event(R2DGui *g, const SDL_Event *ev)
{
    if (!g || !g->context || !g->window || !ev) return;
    // InputEventHandler принимает неконстантную ссылку — передаём копию.
    SDL_Event copy = *ev;
    RmlSDL::InputEventHandler(g->context, g->window, copy);
}

void r2d_gui_update(R2DGui *g, int width, int height)
{
    if (!g || !g->context) return;
    if (width > 0 && height > 0 && (width != g->width || height != g->height)) {
        g->width = width;
        g->height = height;
        g->context->SetDimensions(Rml::Vector2i(width, height));
    }
    g->context->Update();
}

void r2d_gui_render(R2DGui *g, SDL_GPUCommandBuffer *cmd, SDL_GPUTexture *swapchain,
                     uint32_t width, uint32_t height)
{
    if (!g || !g->context || !g->renderer || !swapchain) return;

    g->renderer->BeginFrame(cmd, swapchain, width, height);
    g->context->Render();
    g->renderer->EndFrame();
}

// ---------------------------------------------------------------------------
// Документы
// ---------------------------------------------------------------------------

int r2d_gui_load_document(R2DGui *g, const char *path)
{
    if (!g || !g->context || !path) return -1;

    for (int i = 0; i < g->doc_count; ++i) {
        if (g->doc_paths[i] == path && g->docs[i]) return i;
    }
    if (g->doc_count >= kMaxDocuments) {
        R2D_ERROR("RmlUi: достигнут лимит документов (%d)", kMaxDocuments);
        return -1;
    }

    Rml::ElementDocument *doc = g->context->LoadDocument(path);
    if (!doc) {
        R2D_ERROR("RmlUi: не удалось загрузить документ '%s'", path);
        return -1;
    }

    // По умолчанию документ скрыт: сцена сама решает, когда его показать.
    doc->Hide();

    const int id = g->doc_count++;
    g->docs[id] = doc;
    g->doc_paths[id] = path;
    return id;
}

static Rml::ElementDocument *r2d__doc(R2DGui *g, int doc)
{
    if (!g || doc < 0 || doc >= g->doc_count) return nullptr;
    return g->docs[doc];
}

void r2d_gui_show(R2DGui *g, int doc)
{
    if (Rml::ElementDocument *d = r2d__doc(g, doc)) d->Show();
}

void r2d_gui_hide(R2DGui *g, int doc)
{
    if (Rml::ElementDocument *d = r2d__doc(g, doc)) d->Hide();
}

void r2d_gui_unload(R2DGui *g, int doc)
{
    if (!g || !g->context || doc < 0 || doc >= g->doc_count) return;
    if (g->docs[doc]) {
        g->context->UnloadDocument(g->docs[doc]);
        g->docs[doc] = nullptr;
    }
    g->doc_paths[doc].clear();
}

bool r2d_gui_document_visible(const R2DGui *g, int doc)
{
    if (!g || doc < 0 || doc >= g->doc_count || !g->docs[doc]) return false;
    return g->docs[doc]->IsVisible();
}

static Rml::Element *r2d__element(R2DGui *g, int doc, const char *element_id)
{
    Rml::ElementDocument *d = r2d__doc(g, doc);
    if (!d || !element_id) return nullptr;
    Rml::Element *el = d->GetElementById(element_id);
    if (!el) {
        R2D_WARN("RmlUi: в документе #%d нет элемента '%s'", doc, element_id);
    }
    return el;
}

void r2d_gui_set_text(R2DGui *g, int doc, const char *element_id, const char *text)
{
    if (Rml::Element *el = r2d__element(g, doc, element_id)) {
        el->SetInnerRML(text ? text : "");
    }
}

void r2d_gui_set_html(R2DGui *g, int doc, const char *element_id, const char *html)
{
    // SetInnerRML одинаково годится и для текста, и для разметки.
    if (Rml::Element *el = r2d__element(g, doc, element_id)) {
        el->SetInnerRML(html ? html : "");
    }
}

void r2d_gui_set_class(R2DGui *g, int doc, const char *element_id, const char *class_name, bool add)
{
    if (Rml::Element *el = r2d__element(g, doc, element_id)) {
        el->SetClass(class_name ? class_name : "", add);
    }
}

void r2d_gui_set_property(R2DGui *g, int doc, const char *element_id,
                           const char *property, const char *value)
{
    if (Rml::Element *el = r2d__element(g, doc, element_id)) {
        el->SetProperty(property ? property : "", value ? value : "");
    }
}

bool r2d_gui_add_listener(R2DGui *g, int doc, const char *element_id,
                           const char *event_name, int callback_id)
{
    Rml::Element *el = r2d__element(g, doc, element_id);
    if (!el) return false;

    JsEventListener::SetDispatch(g->dispatch, g->dispatch_user);
    // RmlUi забирает слушателя во владение и удалит его сам (OnDetach).
    el->AddEventListener(event_name ? event_name : "click",
                         new JsEventListener(callback_id, element_id ? element_id : "",
                                             event_name ? event_name : "click"));
    return true;
}

void r2d_gui_set_event_dispatch(R2DGui *g, R2DGuiEventFn fn, void *user)
{
    if (!g) return;
    g->dispatch = fn;
    g->dispatch_user = user;
    JsEventListener::SetDispatch(fn, user);
}

int r2d_gui_document_count(const R2DGui *g)
{
    return g ? g->doc_count : 0;
}
