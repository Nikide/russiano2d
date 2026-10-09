// Реализация компиляции пользовательских шейдеров — см. shader_live.h.
//
// Здесь два внешних инструмента, которые уже собираются вместе с движком:
//   * glslang — GLSL → SPIR-V (валидация синтаксиса и привязок заодно);
//   * spirv-cross — SPIR-V → MSL (Metal не ест SPIR-V).
// На Vulkan/D3D12 достаточно первого шага, поэтому MSL считается только когда
// компиляция запрошена под Metal: движок зовёт компилятор с флагом want_msl.
//
// Файл на C++: оба API — C++, а движок и так собирает C++ (RmlUi, light.cpp).

#include "shader_live.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include <glslang/Public/ResourceLimits.h>
#include <glslang/Public/ShaderLang.h>
#include <SPIRV/GlslangToSpv.h>

#include <spirv_cross_c.h>

#ifndef R2D_ENABLE_LIVE_SHADERS

bool r2d_live_shader_supported(void) { return false; }

const char *r2d_live_shader_preamble(void) { return ""; }

bool r2d_live_shader_compile(const char *fragment_body, R2DLiveShader *out)
{
    (void)fragment_body;
    if (out) {
        std::memset(out, 0, sizeof *out);
        std::snprintf(out->error, sizeof out->error,
                      "эта сборка без компилятора шейдеров (R2D_ENABLE_LIVE_SHADERS=OFF)");
    }
    return false;
}

void r2d_live_shader_free(R2DLiveShader *shader) { if (shader) std::memset(shader, 0, sizeof *shader); }

#else  // R2D_ENABLE_LIVE_SHADERS

// Шапка фиксирует контракт с рендерером: те же привязки, что у встроенного
// sprite_fx, поэтому пользовательский шейдер встаёт в тот же путь отрисовки.
static const char *kPreamble =
    "#version 450\n"
    "layout(set = 2, binding = 0) uniform sampler2D u_texture;\n"
    "layout(set = 3, binding = 0) uniform NodeParams { vec4 p; vec4 c; } u;\n"
    "layout(location = 0) in vec2 v_texcoord;\n"
    "layout(location = 1) in vec4 v_color;\n"
    "layout(location = 0) out vec4 o_color;\n";

// Одноразовая инициализация glslang: внутри — пул аллокаторов, повторный вызов
// без Finish не нужен и не полезен.
static void r2d__glslang_once(void)
{
    static bool ready = false;
    if (!ready) {
        glslang::InitializeProcess();
        ready = true;
    }
}

const char *r2d_live_shader_preamble(void) { return kPreamble; }

bool r2d_live_shader_supported(void) { return true; }

static void r2d__set_error(R2DLiveShader *out, const std::string &text)
{
    if (!out) return;
    std::snprintf(out->error, sizeof out->error, "%s", text.c_str());
}

// SPIR-V → MSL. Нужен только Metal-бэкенду; на остальных платформах не зовём,
// чтобы не тратить время на конвертацию.
static bool r2d__spirv_to_msl(const std::vector<uint32_t> &spirv, char **out_msl,
                              size_t *out_size, std::string *error)
{
    spvc_context ctx = nullptr;
    if (spvc_context_create(&ctx) != SPVC_SUCCESS) {
        *error = "не удалось создать контекст spirv-cross";
        return false;
    }
    bool ok = false;
    spvc_parsed_ir ir = nullptr;
    spvc_compiler compiler = nullptr;
    const char *source = nullptr;

    do {
        if (spvc_context_parse_spirv(ctx, spirv.data(), spirv.size(), &ir) != SPVC_SUCCESS) {
            *error = "spirv-cross не разобрал SPIR-V";
            break;
        }
        if (spvc_context_create_compiler(ctx, SPVC_BACKEND_MSL, ir,
                                         SPVC_CAPTURE_MODE_TAKE_OWNERSHIP, &compiler) != SPVC_SUCCESS) {
            *error = "spirv-cross не создал MSL-компилятор";
            break;
        }
        spvc_compiler_options options = nullptr;
        if (spvc_compiler_create_compiler_options(compiler, &options) != SPVC_SUCCESS) {
            *error = "spirv-cross не отдал опции компилятора";
            break;
        }
        // Те же настройки, что у встроенных шейдеров при сборке:
        // --msl-version 20100 и --msl-decoration-binding.
        spvc_compiler_options_set_uint(options, SPVC_COMPILER_OPTION_MSL_VERSION,
                                       SPVC_MAKE_MSL_VERSION(2, 1, 0));
        spvc_compiler_options_set_bool(options, SPVC_COMPILER_OPTION_MSL_ENABLE_DECORATION_BINDING,
                                       SPVC_TRUE);
        if (spvc_compiler_install_compiler_options(compiler, options) != SPVC_SUCCESS) {
            *error = "spirv-cross не принял опции";
            break;
        }
        if (spvc_compiler_compile(compiler, &source) != SPVC_SUCCESS || !source) {
            *error = "spirv-cross не смог сгенерировать MSL";
            break;
        }
        const size_t len = std::strlen(source);
        char *copy = (char *)std::malloc(len + 1);
        if (!copy) {
            *error = "не хватило памяти на MSL";
            break;
        }
        std::memcpy(copy, source, len + 1);
        *out_msl = copy;
        *out_size = len;
        ok = true;
    } while (false);

    // Контекст владеет и IR, и исходником MSL — освобождаем после копии.
    spvc_context_destroy(ctx);
    return ok;
}

bool r2d_live_shader_compile(const char *fragment_body, R2DLiveShader *out)
{
    if (!out) return false;
    std::memset(out, 0, sizeof *out);

    if (!fragment_body || !*fragment_body) {
        r2d__set_error(out, "пустой исходник шейдера");
        return false;
    }

    r2d__glslang_once();

    const std::string source = std::string(kPreamble) + fragment_body + "\n";

    glslang::TShader shader(EShLangFragment);
    const char *text = source.c_str();
    const int length = (int)source.size();
    shader.setStringsWithLengths(&text, &length, 1);
    shader.setEnvInput(glslang::EShSourceGlsl, EShLangFragment, glslang::EShClientVulkan, 100);
    shader.setEnvClient(glslang::EShClientVulkan, glslang::EShTargetVulkan_1_1);
    shader.setEnvTarget(glslang::EShTargetSpv, glslang::EShTargetSpv_1_3);

    if (!shader.parse(GetDefaultResources(), 450, false, EShMsgDefault)) {
        r2d__set_error(out, std::string("GLSL не скомпилировался: ") + shader.getInfoLog());
        return false;
    }

    glslang::TProgram program;
    program.addShader(&shader);
    if (!program.link(EShMsgDefault)) {
        r2d__set_error(out, std::string("шейдер не слинковался: ") + program.getInfoLog());
        return false;
    }

    const glslang::TIntermediate *intermediate = program.getIntermediate(EShLangFragment);
    if (!intermediate) {
        r2d__set_error(out, "нет промежуточного представления фрагментного шейдера");
        return false;
    }

    std::vector<uint32_t> spirv;
    glslang::GlslangToSpv(*intermediate, spirv);
    if (spirv.empty()) {
        r2d__set_error(out, "spirv пуст");
        return false;
    }

    const size_t bytes = spirv.size() * sizeof(uint32_t);
    out->spirv = std::malloc(bytes);
    if (!out->spirv) {
        r2d__set_error(out, "не хватило памяти на SPIR-V");
        return false;
    }
    std::memcpy(out->spirv, spirv.data(), bytes);
    out->spirv_size = bytes;

    std::string msl_error;
    if (!r2d__spirv_to_msl(spirv, &out->msl, &out->msl_size, &msl_error)) {
        // SPIR-V уже готов: на Vulkan/D3D12 шейдер рабочий, MSL нужен только
        // Metal. Поэтому это предупреждение, а не отказ.
        std::snprintf(out->error, sizeof out->error, "MSL не собрался: %s", msl_error.c_str());
    } else {
        out->error[0] = '\0';
    }

    out->ok = true;
    return true;
}

void r2d_live_shader_free(R2DLiveShader *shader)
{
    if (!shader) return;
    if (shader->spirv) std::free(shader->spirv);
    if (shader->msl) std::free(shader->msl);
    std::memset(shader, 0, sizeof *shader);
}

#endif  // R2D_ENABLE_LIVE_SHADERS
