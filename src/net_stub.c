// ===========================================================================
// Сеть — заглушка (без R2D_ENABLE_NET)
//
// Тот же интерфейс net.h, но сокетов нет: скриптовый слой и $.net не
// обрастают #ifdef, а сборка не тянет SDL3_net. Так же устроен звук
// (audio_stub.c): без зависимости остаётся рабочее API с честным отказом.
// ===========================================================================

#ifndef R2D_ENABLE_NET

#include "net.h"
#include "r2d.h"

static const char *g_error = "транспорт собран без R2D_ENABLE_NET (SDL3_net)";

bool r2d_net_init(void) { return false; }
void r2d_net_shutdown(void) {}
bool r2d_net_available(void) { return false; }
bool r2d_net_listen(int port) { R2D_UNUSED(port); return false; }
bool r2d_net_connect(const char *host, int port) { R2D_UNUSED(host); R2D_UNUSED(port); return false; }
void r2d_net_close(void) {}
int  r2d_net_mode(void) { return 0; }
bool r2d_net_connected(void) { return false; }
const char *r2d_net_error(void) { return g_error; }
const char *r2d_net_local_address(void) { return ""; }
int  r2d_net_local_port(void) { return 0; }
bool r2d_net_send(const char *to, int to_port, const void *data, int size)
{
    R2D_UNUSED(to); R2D_UNUSED(to_port); R2D_UNUSED(data); R2D_UNUSED(size);
    return false;
}
int  r2d_net_poll(R2DNetPacket *out, int max) { R2D_UNUSED(out); R2D_UNUSED(max); return 0; }
void r2d_net_free_packets(R2DNetPacket *packets, int count) { R2D_UNUSED(packets); R2D_UNUSED(count); }
uint64_t r2d_net_bytes_sent(void) { return 0; }
uint64_t r2d_net_bytes_received(void) { return 0; }
uint64_t r2d_net_packets_sent(void) { return 0; }
uint64_t r2d_net_packets_received(void) { return 0; }
void r2d_net_simulate(int loss_percent, int delay_ms, int seed)
{
    R2D_UNUSED(loss_percent); R2D_UNUSED(delay_ms); R2D_UNUSED(seed);
}

#endif // !R2D_ENABLE_NET
