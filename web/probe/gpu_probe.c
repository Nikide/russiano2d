// ---------------------------------------------------------------------------
// Изолированная проверка SDL_GPU с WebGPU-бэкендом в браузере.
//
// Зачем: если движок в браузере виснет, надо знать, чей это дефект — движка или
// самого бэкенда SDL. Эта программа не содержит ни строчки движка: только
// окно, GPU-устройство и очистка кадра в цикле, с отметкой каждого шага.
//
// Сборка (см. docs/WEB_EXPORT.md):
//   emcc web/probe/gpu_probe.c -o /tmp/r2d-web/probe/probe.html \
//        -I/tmp/r2d-web/sdl-install/include -L/tmp/r2d-web/sdl-install/lib -lSDL3 \
//        -sALLOW_MEMORY_GROWTH=1 --use-port=emdawnwebgpu
// ---------------------------------------------------------------------------

#include <SDL3/SDL.h>
#include <stdio.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

static SDL_Window      *window = NULL;
static SDL_GPUDevice   *device = NULL;
static int              frames = 0;

static void step(const char *what, bool ok)
{
    printf("[probe] %s: %s%s%s\n", what, ok ? "ok" : "FAIL",
           ok ? "" : " — ", ok ? "" : SDL_GetError());
    fflush(stdout);
}

static void frame(void)
{
    SDL_GPUCommandBuffer *cmd = SDL_AcquireGPUCommandBuffer(device);
    if (!cmd) {
        printf("[probe] AcquireGPUCommandBuffer: FAIL — %s\n", SDL_GetError());
        emscripten_cancel_main_loop();
        return;
    }

    SDL_GPUTexture *swap = NULL;
    Uint32 w = 0, h = 0;
    if (!SDL_AcquireGPUSwapchainTexture(cmd, window, &swap, &w, &h)) {
        printf("[probe] AcquireGPUSwapchainTexture: FAIL — %s\n", SDL_GetError());
        SDL_CancelGPUCommandBuffer(cmd);
        emscripten_cancel_main_loop();
        return;
    }
    if (!swap) {
        SDL_SubmitGPUCommandBuffer(cmd);
        return;
    }

    SDL_GPUColorTargetInfo target;
    SDL_zero(target);
    target.texture     = swap;
    target.clear_color = (SDL_FColor){ 0.1f, 0.3f, 0.5f, 1.0f };
    target.load_op     = SDL_GPU_LOADOP_CLEAR;
    target.store_op    = SDL_GPU_STOREOP_STORE;

    SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
    SDL_EndGPURenderPass(pass);

    if (!SDL_SubmitGPUCommandBuffer(cmd)) {
        printf("[probe] SubmitGPUCommandBuffer: FAIL — %s\n", SDL_GetError());
        emscripten_cancel_main_loop();
        return;
    }

    if (++frames == 5 || frames % 60 == 0) {
        printf("[probe] кадр %d отрисован (%ux%u)\n", frames, w, h);
        fflush(stdout);
    }
    if (frames >= 120) {
        printf("[probe] PROBE-OK кадров=%d\n", frames);
        fflush(stdout);
        EM_ASM({ window.__r2dStopped = true; });
        emscripten_cancel_main_loop();
    }
}

int main(int argc, char **argv)
{
    (void)argc; (void)argv;

    step("SDL_Init", SDL_Init(SDL_INIT_VIDEO));

    window = SDL_CreateWindow("gpu probe", 640, 360, SDL_WINDOW_RESIZABLE);
    step("SDL_CreateWindow", window != NULL);
    if (!window) return 1;

    device = SDL_CreateGPUDevice(SDL_GPU_SHADERFORMAT_WGSL, true, NULL);
    step("SDL_CreateGPUDevice(WGSL)", device != NULL);
    if (!device) return 1;

    printf("[probe] драйвер: %s\n", SDL_GetGPUDeviceDriver(device));
    step("SDL_ClaimWindowForGPUDevice", SDL_ClaimWindowForGPUDevice(device, window));

#ifdef __EMSCRIPTEN__
    emscripten_set_main_loop(frame, 0, 1);
#else
    while (frames < 120) frame();
#endif
    return 0;
}
