// ===========================================================================
// r2d-sdk — CLI инструментов Russiano2D SDK.
//
//   r2d-sdk <команда> [аргументы]
//
// Все команды печатают один JSON-объект в stdout. Код выхода: 0 — ok,
// 1 — операция выполнена, но есть ошибки данных, 2 — неверное использование.
// ===========================================================================
#include "sdk.h"
#include "sdk_re2d.h"
#include "sdk_bake.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <string.h>

typedef struct Command {
    const char *name;
    int (*fn)(const SdkArgs *);
    const char *help;
} Command;

static int cmd_version(const SdkArgs *a);
static int cmd_commands(const SdkArgs *a);

static const Command k_commands[] = {
    { "version",  cmd_version,      "версия SDK и список команд" },
    { "commands", cmd_commands,     "список команд" },
    { "tools",    sdk_cmd_tools,    "реестр инструментов sdk_tools.json с проверкой" },
    { "assets",   sdk_cmd_assets,   "ассеты проекта по реальной файловой структуре" },
    { "project",  sdk_cmd_project,  "сведения о проекте (project.json, main.js)" },
    { "projects", sdk_cmd_projects, "найти проекты под каталогом" },
    { "validate", sdk_cmd_validate, "проверить ассет, структурная диагностика" },
    { "atlas-grid",   sdk_cmd_atlas_grid,   "создать атлас спрайтов сеткой из картинки" },
    { "atlas-format", sdk_cmd_atlas_format, "привести атлас к каноническому виду" },
    { "atlas-info",   sdk_cmd_atlas_info,   "кадры, теги, слайсы и проверка атласа" },
    { "re2d-info",   sdk_cmd_re2d_info,   "Re2DSprite: PNG v2, части, статистика карт и проверка" },
    { "re2d-debug",  sdk_cmd_re2d_debug,  "Re2DSprite: отладочный вид карт поверхности в PNG" },
    { "re2d-sample", sdk_cmd_re2d_sample, "Re2DSprite: один отсчёт поверхности (ID, XYZ, покрытие, владелец)" },
    { "animation-import", sdk_cmd_animation_import, "FBX humanoid motion → existing Re2DSprite rig animation JSON" },
    { "bake-re2d", sdk_cmd_bake_re2d, "Re2D Baker: GLB/glTF/VRM → Re2DSprite (prop, character)" },
    { "world-compile", sdk_cmd_world_compile, "Re2D World: исходник *.re2dmap → описание для $.re2d.world" },
    { "world-info",    sdk_cmd_world_info,    "Re2D World: статистика, room-over-room, порталы и проверка без записи" },
    { "batch", sdk_cmd_batch, "Пакетный Baker / validation: JSON manifest и сводный report" },
    { "agent", sdk_cmd_agent, "Нативный клиент существующего агентского протокола (JSON session)" },
    { "templates", sdk_cmd_templates, "шаблоны проектов sdk/templates" },
    { "new",       sdk_cmd_new,       "создать проект из шаблона (копирование файлов)" },
    { "engines",   sdk_cmd_engines,   "найденные сборки движка russiano2d" },
    { "run",      sdk_cmd_run,      "запустить игру движком" },
    { "build",    sdk_cmd_build,    "собрать игру в один файл" },
};

static int cmd_commands(const SdkArgs *a)
{
    (void)a;
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"commands\":[");
    for (size_t i = 0; i < sizeof k_commands / sizeof k_commands[0]; ++i) {
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_putc(&out, '{');
        sdk_put_kv_str(&out, "name", k_commands[i].name);
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "help", k_commands[i].help);
        r2d_sb_putc(&out, '}');
    }
    r2d_sb_puts(&out, "]}");
    puts(out.data);
    r2d_sb_free(&out);
    return 0;
}

static int cmd_version(const SdkArgs *a)
{
    (void)a;
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"name\":\"r2d-sdk\",\"version\":\"" SDK_VERSION "\",\"validators\":[");
    for (int i = 0; i < sdk_validator_count(); ++i) {
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_put_json_string(&out, sdk_validator_type(i));
    }
    r2d_sb_puts(&out, "]}");
    puts(out.data);
    r2d_sb_free(&out);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        SdkReport rep;
        sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk <команда> [аргументы]; список — r2d-sdk commands");
        sdk_report_free(&rep);
        return rc;
    }
    SdkArgs args = { argc - 2, (const char **)argv + 2 };
    for (size_t i = 0; i < sizeof k_commands / sizeof k_commands[0]; ++i) {
        if (strcmp(argv[1], k_commands[i].name) == 0) return k_commands[i].fn(&args);
    }
    SdkReport rep;
    sdk_report_init(&rep);
    const int rc = sdk_fail(&rep, "SDK_UNKNOWN_COMMAND", "Неизвестная команда «%s»; список — r2d-sdk commands", argv[1]);
    sdk_report_free(&rep);
    return rc;
}
