// ===========================================================================
// Сеть — транспорт на SDL3_net (реализация)
//
// Только сокеты: сервер, клиент, отправка и приём датаграмм. Ни владения
// узлами, ни снапшотов здесь нет — это $.net в JS (см. net.js).
//
// Особенность SDL3_net: адрес получателя надо ДЕРЖАТЬ, он у каждого пира
// свой. Поэтому сервер запоминает адреса приславших (таблица пиров), а клиент
// один адрес хоста. Так повторный пакет не требует нового разрешения имени:
// NET_ResolveHostname асинхронный, и разрешать его на каждый выстрел нельзя.
// ===========================================================================

#ifdef R2D_ENABLE_NET

#include "net.h"
#include "r2d.h"

#include <SDL3_net/SDL_net.h>
#include <stdarg.h>
#include <string.h>

#define R2D_NET_MAX_PACKET  1200      // безопасный размер датаграммы
#define R2D_NET_MAX_PEERS   64
#define R2D_NET_ERROR_MAX   256
// Сколько отложенных отправок держим (симуляция задержки).
#define R2D_NET_DELAY_MAX   64

struct R2DNet {
    bool initialized;
    int  mode;                 // 0 — выкл, 1 — сервер, 2 — клиент
    NET_DatagramSocket *sock;
    NET_Address *host_addr;    // клиент: адрес хоста
    char host_name[128];
    int  host_port;
    char error[R2D_NET_ERROR_MAX];

    // Пир сервера: адрес, порт и как его звать в сообщениях.
    struct {
        NET_Address *addr;
        int          port;
        char         name[64];
    } peers[R2D_NET_MAX_PEERS];
    int peer_count;

    char local_address[64];
    int  local_port;

    uint64_t bytes_sent, bytes_received, packets_sent, packets_received;

    // Симуляция потерь (тесты): 0 — выключена.
    int sim_loss;
    int sim_delay;      // мс: через сколько отправить
    int sim_jitter;     // мс: случайная добавка [0, jitter)
    uint32_t sim_state;
    // Очередь отложенных отправок. Задержка делается ОЧЕРЕДЬЮ, а не сном:
    // спать в кадре нельзя, поэтому пакет ждёт своего времени и уходит из
    // r2d_net_tick.
    struct {
        uint64_t due_ms;
        int      to_port;
        char     to[64];
        int      size;
        uint8_t *data;
    } delayed[R2D_NET_DELAY_MAX];
    int delayed_count;
};

static R2DNet g_net;

static void r2d__net_error(const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    SDL_vsnprintf(g_net.error, sizeof g_net.error, fmt, args);
    va_end(args);
    R2D_WARN("сеть: %s", g_net.error);
}

static void r2d__net_clear_error(void)
{
    g_net.error[0] = '\0';
}

const char *r2d_net_error(void)
{
    return g_net.error;
}

bool r2d_net_available(void) { return g_net.initialized; }
int  r2d_net_mode(void) { return g_net.mode; }
uint64_t r2d_net_bytes_sent(void) { return g_net.bytes_sent; }
uint64_t r2d_net_bytes_received(void) { return g_net.bytes_received; }
uint64_t r2d_net_packets_sent(void) { return g_net.packets_sent; }
uint64_t r2d_net_packets_received(void) { return g_net.packets_received; }

bool r2d_net_init(void)
{
    if (g_net.initialized) return true;
    if (!NET_Init()) {
        r2d__net_error("NET_Init: %s", SDL_GetError());
        return false;
    }
    SDL_zero(g_net);
    g_net.initialized = true;
    R2D_LOG("сеть: SDL3_net %d готов", NET_Version());
    return true;
}

/** Закрыть сокет, пиров и адрес хоста. Режим сбрасывается. */
static void r2d__net_release(void)
{
    for (int i = 0; i < g_net.peer_count; ++i) {
        if (g_net.peers[i].addr) NET_UnrefAddress(g_net.peers[i].addr);
        g_net.peers[i].addr = NULL;
    }
    g_net.peer_count = 0;
    if (g_net.host_addr) {
        NET_UnrefAddress(g_net.host_addr);
        g_net.host_addr = NULL;
    }
    if (g_net.sock) {
        NET_DestroyDatagramSocket(g_net.sock);
        g_net.sock = NULL;
    }
    g_net.mode = 0;
    g_net.local_address[0] = '\0';
    g_net.local_port = 0;
}

void r2d_net_close(void)
{
    if (!g_net.initialized) return;
    r2d__net_release();
}

void r2d_net_shutdown(void)
{
    if (!g_net.initialized) return;
    r2d__net_release();
    NET_Quit();
    g_net.initialized = false;
}

/** Запомнить адрес приславшего (сервер): по нему потом отвечаем. */
static void r2d__net_remember_peer(NET_Address *address, int port, const char *name)
{
    if (!address) return;
    // Уже знаем — обновляем адрес (он мог смениться после rebind).
    for (int i = 0; i < g_net.peer_count; ++i) {
        if (g_net.peers[i].port == port && g_net.peers[i].name[0]
            && name && SDL_strcmp(g_net.peers[i].name, name) == 0) {
            NET_UnrefAddress(g_net.peers[i].addr);
            g_net.peers[i].addr = NET_RefAddress(address);
            return;
        }
    }
    if (g_net.peer_count >= R2D_NET_MAX_PEERS) {
        R2D_WARN("сеть: таблица пиров полна (%d) — пакет проигнорирован", R2D_NET_MAX_PEERS);
        return;
    }
    g_net.peers[g_net.peer_count].addr = NET_RefAddress(address);
    g_net.peers[g_net.peer_count].port = port;
    SDL_snprintf(g_net.peers[g_net.peer_count].name,
                 sizeof g_net.peers[g_net.peer_count].name, "%s", name ? name : "");
    g_net.peer_count++;
}

bool r2d_net_listen(int port)
{
    if (!r2d_net_init()) return false;
    if (g_net.sock || g_net.host_addr) r2d__net_release();
    r2d__net_clear_error();

    g_net.sock = NET_CreateDatagramSocket(NULL, (Uint16)port, 0);
    if (!g_net.sock) {
        r2d__net_error("не удалось занять порт %d: %s", port, SDL_GetError());
        return false;
    }
    g_net.mode = 1;
    g_net.local_port = port;
    SDL_snprintf(g_net.local_address, sizeof g_net.local_address, "0.0.0.0");
    R2D_LOG("сеть: слушаю порт %d", port);
    return true;
}

bool r2d_net_connect(const char *host, int port)
{
    if (!r2d_net_init()) return false;
    if (!host || !*host) { r2d__net_error("не указан хост"); return false; }
    if (g_net.sock || g_net.host_addr) r2d__net_release();
    r2d__net_clear_error();

    g_net.sock = NET_CreateDatagramSocket(NULL, 0, 0);   // свой свободный порт
    if (!g_net.sock) {
        r2d__net_error("не удалось открыть сокет: %s", SDL_GetError());
        return false;
    }
    g_net.host_addr = NET_ResolveHostname(host);
    if (!g_net.host_addr) {
        r2d__net_error("не удалось начать разрешение имени «%s»: %s", SDL_GetError());
        r2d__net_release();
        return false;
    }
    SDL_strlcpy(g_net.host_name, host, sizeof g_net.host_name);
    g_net.host_port = port;
    g_net.mode = 2;
    R2D_LOG("сеть: подключаюсь к %s:%d", host, port);
    return true;
}

bool r2d_net_connected(void)
{
    if (g_net.mode == 1) return true;          // сервер слушает — он «готов»
    if (g_net.mode != 2 || !g_net.host_addr) return false;
    const NET_Status status = NET_GetAddressStatus(g_net.host_addr);
    if (status == NET_SUCCESS) {
        if (g_net.local_address[0] == '\0') {
            const char *text = NET_GetAddressString(g_net.host_addr);
            SDL_snprintf(g_net.local_address, sizeof g_net.local_address, "%s",
                         text ? text : g_net.host_name);
            R2D_LOG("сеть: подключён к %s:%d", g_net.local_address, g_net.host_port);
        }
        return true;
    }
    if (status == NET_FAILURE) {
        r2d__net_error("хост «%s» не разрешился: %s", SDL_GetError());
        return false;
    }
    return false;                              // ещё разрешается
}

const char *r2d_net_local_address(void) { return g_net.local_address; }
int  r2d_net_local_port(void) { return g_net.local_port; }

/** Потерять пакет по симуляции? Сид детерминированный (xorshift). */
static bool r2d__net_drop(void)
{
    if (g_net.sim_loss <= 0) return false;
    uint32_t x = g_net.sim_state ? g_net.sim_state : 1u;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    g_net.sim_state = x;
    const int roll = (int)(x % 100u);
    return roll < g_net.sim_loss;
}

static bool r2d__net_send_now(const char *to, int to_port, const void *data, int size);

void r2d_net_simulate(int loss_percent, int delay_ms, int seed, int jitter_ms)
{
    g_net.sim_loss = loss_percent < 0 ? 0 : (loss_percent > 100 ? 100 : loss_percent);
    g_net.sim_delay = delay_ms > 0 ? delay_ms : 0;
    g_net.sim_jitter = jitter_ms > 0 ? jitter_ms : 0;
    g_net.sim_state = (uint32_t)(seed ? seed : 1);
    if (g_net.sim_loss > 0 || g_net.sim_delay > 0 || g_net.sim_jitter > 0) {
        R2D_LOG("сеть: симуляция потерь %d%%, задержка %d мс, разброс %d мс, сид %d",
                g_net.sim_loss, g_net.sim_delay, g_net.sim_jitter, seed);
    }
}

int r2d_net_delayed_count(void) { return g_net.delayed_count; }

/** Следующее случайное число симуляции (тот же xorshift, что и у потерь). */
static uint32_t r2d__net_sim_rand(void)
{
    uint32_t x = g_net.sim_state ? g_net.sim_state : 1u;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    g_net.sim_state = x;
    return x;
}

int r2d_net_tick(void)
{
    if (!g_net.initialized || g_net.delayed_count <= 0) return 0;
    const uint64_t now = SDL_GetTicks();
    int sent = 0;
    for (int i = 0; i < g_net.delayed_count; ) {
        if (g_net.delayed[i].due_ms > now) { ++i; continue; }
        // Созрел: отправляем по-настоящему (потери уже решены при постановке).
        const char *to = g_net.delayed[i].to[0] ? g_net.delayed[i].to : NULL;
        r2d__net_send_now(to, g_net.delayed[i].to_port,
                          g_net.delayed[i].data, g_net.delayed[i].size);
        free(g_net.delayed[i].data);
        g_net.delayed[i] = g_net.delayed[g_net.delayed_count - 1];
        g_net.delayed_count--;
        sent++;
    }
    return sent;
}

// РЕАЛЬНАЯ отправка: без симуляции. Потери и задержка решаются в r2d_net_send.
static bool r2d__net_send_now(const char *to, int to_port, const void *data, int size)
{
    if (!g_net.initialized || !g_net.sock || !data || size <= 0) return false;
    if (size > R2D_NET_MAX_PACKET) {
        r2d__net_error("пакет слишком велик: %d байт", size);
        return false;
    }

    if (g_net.mode == 2) {
        // Клиент шлёт хосту. Адрес уже разрешён при подключении: звать
        // NET_ResolveHostname на каждый пакет нельзя — он асинхронный.
        if (!g_net.host_addr) return false;
        if (!NET_SendDatagram(g_net.sock, g_net.host_addr,
                              (Uint16)(to_port > 0 ? to_port : g_net.host_port), data, size)) {
            r2d__net_error("отправка хосту не удалась: %s", SDL_GetError());
            return false;
        }
        g_net.packets_sent++;
        g_net.bytes_sent += (uint64_t)size;
        return true;
    }

    if (g_net.mode != 1) return false;

    const bool named = to && *to;
    bool any = false;
    for (int i = 0; i < g_net.peer_count; ++i) {
        // Названному пиру — только ему; без имени шлём всем известным
        // (широковещание о начале рейда).
        if (named) {
            if (to_port > 0 && g_net.peers[i].port != to_port) continue;
            // Пир находится и по сохранённому имени, и по адресу: имя могло
            // быть записано как «127.0.0.1» при ответе сервера.
            const char *text = NET_GetAddressString(g_net.peers[i].addr);
            const bool by_name = g_net.peers[i].name[0] && SDL_strcmp(g_net.peers[i].name, to) == 0;
            const bool by_address = text && SDL_strcmp(text, to) == 0;
            if (!by_name && !by_address) continue;
        }
        if (!NET_SendDatagram(g_net.sock, g_net.peers[i].addr,
                              (Uint16)g_net.peers[i].port, data, size)) {
            r2d__net_error("отправка не удалась: %s", SDL_GetError());
            continue;
        }
        any = true;
        g_net.packets_sent++;
        g_net.bytes_sent += (uint64_t)size;
        if (named) return true;
    }
    return any;
}

bool r2d_net_send(const char *to, int to_port, const void *data, int size)
{
    if (!g_net.initialized || !g_net.sock || !data || size <= 0) return false;
    if (size > R2D_NET_MAX_PACKET) {
        r2d__net_error("пакет слишком велик: %d байт", size);
        return false;
    }

    // Потери: пакет считается отправленным, но не уходит. Так игру не отличить
    // от честной отправки — это и нужно от симуляции.
    if (r2d__net_drop()) {
        g_net.packets_sent++;
        g_net.bytes_sent += (uint64_t)size;
        return true;
    }

    // Задержка: кладём в очередь, реально уйдёт из r2d_net_tick. Спать в кадре
    // нельзя, поэтому задержка — это именно отложенная отправка.
    if (g_net.sim_delay > 0 || g_net.sim_jitter > 0) {
        if (g_net.delayed_count >= R2D_NET_DELAY_MAX) {
            static bool logged = false;
            if (!logged) {
                logged = true;
                R2D_WARN("сеть: очередь отложенных пакетов переполнена (%d) — "
                         "задержка слишком велика для этого темпа",
                         R2D_NET_DELAY_MAX);
            }
            return false;
        }
        uint8_t *copy = (uint8_t *)malloc((size_t)size);
        if (!copy) return false;
        SDL_memcpy(copy, data, (size_t)size);
        const int slot = g_net.delayed_count++;
        g_net.delayed[slot].size = size;
        g_net.delayed[slot].data = copy;
        g_net.delayed[slot].to_port = to_port;
        SDL_snprintf(g_net.delayed[slot].to, sizeof g_net.delayed[slot].to, "%s",
                     to ? to : "");
        int wait_ms = g_net.sim_delay;
        if (g_net.sim_jitter > 0) wait_ms += (int)(r2d__net_sim_rand() % (uint32_t)g_net.sim_jitter);
        g_net.delayed[slot].due_ms = SDL_GetTicks() + (uint64_t)wait_ms;
        return true;
    }

    return r2d__net_send_now(to, to_port, data, size);
}

int r2d_net_poll(R2DNetPacket *out, int max)
{
    if (!g_net.initialized || !g_net.sock || !out || max <= 0) return 0;
    // Созревшие отложенные отправки уходят здесь: poll зовётся раз в кадр.
    r2d_net_tick();
    int count = 0;
    while (count < max) {
        NET_Datagram *dgram = NULL;
        if (!NET_ReceiveDatagram(g_net.sock, &dgram) || !dgram) break;
        const char *from = NET_GetAddressString(dgram->addr);
        SDL_snprintf(out[count].from, sizeof out[count].from, "%s", from ? from : "");
        out[count].from_port = (int)dgram->port;
        out[count].size = dgram->buflen;
        out[count].data = (uint8_t *)SDL_malloc((size_t)dgram->buflen);
        if (out[count].data && dgram->buflen > 0) {
            SDL_memcpy(out[count].data, dgram->buf, (size_t)dgram->buflen);
        } else if (!out[count].data) {
            out[count].size = 0;
        }
        // Сервер запоминает приславшего: ему потом отвечать.
        if (g_net.mode == 1) r2d__net_remember_peer(dgram->addr, (int)dgram->port, out[count].from);
        g_net.packets_received++;
        g_net.bytes_received += (uint64_t)dgram->buflen;
        NET_DestroyDatagram(dgram);
        count++;
    }
    return count;
}

void r2d_net_free_packets(R2DNetPacket *packets, int count)
{
    if (!packets) return;
    for (int i = 0; i < count; ++i) {
        if (packets[i].data) SDL_free(packets[i].data);
        packets[i].data = NULL;
        packets[i].size = 0;
    }
}

#endif // R2D_ENABLE_NET
