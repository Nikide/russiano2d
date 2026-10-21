// ENet implementation is private to the runtime. Game scripts only use $.net.
#ifdef R2D_ENABLE_NET

#include "net.h"
#include "r2d.h"

#define ENET_IMPLEMENTATION
#include "enet.h"

#include <SDL3/SDL.h>
#include <stdarg.h>
#include <string.h>

#define R2D_NET_CHANNELS 4
#define R2D_NET_MAX_PEERS 256
#define R2D_NET_MAX_PACKET (4 * 1024 * 1024)
#define R2D_NET_MAX_ERROR 256

typedef struct R2DNet {
    bool initialized;
    ENetHost *host;
    char error[R2D_NET_MAX_ERROR];
    int port;
    uint32_t next_peer_id;
    uint64_t bytes_sent, bytes_received, packets_sent, packets_received;
} R2DNet;

static R2DNet g_net;

static void net_error(const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    SDL_vsnprintf(g_net.error, sizeof g_net.error, fmt, args);
    va_end(args);
    R2D_WARN("сеть: %s", g_net.error);
}

bool r2d_net_init(void)
{
    if (g_net.initialized) return true;
    if (enet_initialize() != 0) {
        net_error("ENet не смог инициализировать сетевую подсистему");
        return false;
    }
    SDL_zero(g_net);
    g_net.initialized = true;
    g_net.next_peer_id = 1;
    R2D_LOG("сеть: ENet готов");
    return true;
}

bool r2d_net_available(void) { return g_net.initialized || r2d_net_init(); }
bool r2d_net_is_open(void) { return g_net.host != NULL; }
const char *r2d_net_error(void) { return g_net.error; }
int r2d_net_port(void) { return g_net.port; }
uint64_t r2d_net_bytes_sent(void) { return g_net.bytes_sent; }
uint64_t r2d_net_bytes_received(void) { return g_net.bytes_received; }
uint64_t r2d_net_packets_sent(void) { return g_net.packets_sent; }
uint64_t r2d_net_packets_received(void) { return g_net.packets_received; }

static uint32_t peer_token(ENetPeer *peer)
{
    return peer ? (uint32_t)(uintptr_t)peer->data : 0;
}

static uint32_t assign_peer_token(ENetPeer *peer)
{
    if (!peer) return 0;
    uint32_t token = peer_token(peer);
    if (token) return token;
    token = g_net.next_peer_id++;
    if (!token) token = g_net.next_peer_id++;
    peer->data = (void *)(uintptr_t)token;
    return token;
}

bool r2d_net_open(int listen_port, int max_peers)
{
    if (!r2d_net_init()) return false;
    if (g_net.host) {
        if (listen_port == 0 || listen_port == g_net.port) return true;
        net_error("транспорт уже открыт на порту %d", g_net.port);
        return false;
    }
    if (listen_port < 0 || listen_port > 65535) {
        net_error("порт должен быть в диапазоне 0..65535");
        return false;
    }
    int peers = max_peers;
    if (peers < 1) peers = 8;
    if (peers > R2D_NET_MAX_PEERS) peers = R2D_NET_MAX_PEERS;

    ENetAddress address;
    const ENetAddress *bind_address = NULL;
    if (listen_port > 0) {
        SDL_zero(address);
        address.host = ENET_HOST_ANY;
        address.port = (enet_uint16)listen_port;
        bind_address = &address;
    }
    g_net.host = enet_host_create(bind_address, (size_t)peers,
                                  R2D_NET_CHANNELS, 0, 0);
    if (!g_net.host) {
        net_error("не удалось открыть ENet host%s%d",
                  listen_port ? " на порту " : "", listen_port);
        return false;
    }
    g_net.port = listen_port;
    g_net.error[0] = '\0';
    return true;
}

bool r2d_net_connect(const char *host, int port)
{
    if (!host || !*host || port < 1 || port > 65535) {
        net_error("для подключения нужны адрес и порт 1..65535");
        return false;
    }
    if (!g_net.host && !r2d_net_open(0, 8)) return false;
    ENetAddress address;
    SDL_zero(address);
    if (enet_address_set_host(&address, host) != 0) {
        net_error("не удалось разрешить адрес «%s»", host);
        return false;
    }
    address.port = (enet_uint16)port;
    if (!enet_host_connect(g_net.host, &address, R2D_NET_CHANNELS, 0)) {
        net_error("нет свободного слота для нового соединения");
        return false;
    }
    g_net.error[0] = '\0';
    return true;
}

static ENetPeer *find_peer(uint32_t id)
{
    if (!g_net.host || id == 0) return NULL;
    for (ENetPeer *p = g_net.host->peers; p < g_net.host->peers + g_net.host->peerCount; ++p) {
        if (peer_token(p) == id && p->state == ENET_PEER_STATE_CONNECTED) return p;
    }
    return NULL;
}

bool r2d_net_disconnect(uint32_t peer_id)
{
    ENetPeer *peer = find_peer(peer_id);
    if (!peer) return false;
    enet_peer_disconnect(peer, 0);
    enet_host_flush(g_net.host);
    return true;
}

void r2d_net_close(void)
{
    if (!g_net.host) return;
    enet_host_destroy(g_net.host);
    g_net.host = NULL;
    g_net.port = 0;
}

void r2d_net_shutdown(void)
{
    if (!g_net.initialized) return;
    r2d_net_close();
    enet_deinitialize();
    SDL_zero(g_net);
}

int r2d_net_peer_count(void)
{
    if (!g_net.host) return 0;
    int count = 0;
    for (ENetPeer *p = g_net.host->peers; p < g_net.host->peers + g_net.host->peerCount; ++p)
        if (p->state == ENET_PEER_STATE_CONNECTED) ++count;
    return count;
}

bool r2d_net_send(uint32_t peer_id, uint8_t channel, bool reliable,
                  const void *data, int size)
{
    if (!g_net.host || !data || size <= 0 || size > R2D_NET_MAX_PACKET
        || channel >= R2D_NET_CHANNELS) return false;
    const enet_uint32 flags = reliable ? ENET_PACKET_FLAG_RELIABLE : 0;
    ENetPacket *packet = enet_packet_create(data, (size_t)size, flags);
    if (!packet) {
        net_error("не удалось выделить пакет ENet");
        return false;
    }
    if (peer_id == 0) {
        const int count = r2d_net_peer_count();
        if (!count) { enet_packet_destroy(packet); return false; }
        enet_host_broadcast(g_net.host, channel, packet);
        g_net.packets_sent++;
        g_net.bytes_sent += (uint64_t)size * (uint64_t)count;
        enet_host_flush(g_net.host);
        return true;
    }
    ENetPeer *peer = find_peer(peer_id);
    if (!peer || enet_peer_send(peer, channel, packet) < 0) {
        enet_packet_destroy(packet);
        return false;
    }
    g_net.packets_sent++;
    g_net.bytes_sent += (uint64_t)size;
    enet_host_flush(g_net.host);
    return true;
}

int r2d_net_poll(R2DNetEvent *out, int max_events)
{
    if (!g_net.host || !out || max_events <= 0) return 0;
    int count = 0;
    ENetEvent event;
    while (count < max_events) {
        const int result = enet_host_service(g_net.host, &event, 0);
        if (result <= 0) {
            if (result < 0) net_error("ошибка опроса ENet host");
            break;
        }
        R2DNetEvent *dst = &out[count];
        SDL_zero(*dst);
        if (event.type == ENET_EVENT_TYPE_CONNECT) {
            dst->type = R2D_NET_EVENT_CONNECT;
            dst->peer_id = assign_peer_token(event.peer);
            dst->rtt_ms = enet_peer_get_rtt(event.peer);
        } else if (event.type == ENET_EVENT_TYPE_DISCONNECT
                   || event.type == ENET_EVENT_TYPE_DISCONNECT_TIMEOUT) {
            dst->type = R2D_NET_EVENT_DISCONNECT;
            dst->peer_id = peer_token(event.peer);
            if (event.peer) event.peer->data = NULL;
        } else if (event.type == ENET_EVENT_TYPE_RECEIVE) {
            dst->type = R2D_NET_EVENT_RECEIVE;
            dst->peer_id = assign_peer_token(event.peer);
            dst->channel = event.channelID;
            dst->rtt_ms = enet_peer_get_rtt(event.peer);
            const size_t bytes = event.packet ? event.packet->dataLength : 0;
            if (bytes > 0 && bytes <= R2D_NET_MAX_PACKET) {
                dst->data = (uint8_t *)SDL_malloc(bytes);
                if (dst->data) {
                    SDL_memcpy(dst->data, event.packet->data, bytes);
                    dst->size = (int)bytes;
                    g_net.bytes_received += bytes;
                    g_net.packets_received++;
                }
            }
            if (event.packet) enet_packet_destroy(event.packet);
            if (dst->size == 0) continue;
        } else {
            continue;
        }
        count++;
    }
    return count;
}

void r2d_net_free_events(R2DNetEvent *events, int count)
{
    if (!events) return;
    for (int i = 0; i < count; ++i) {
        SDL_free(events[i].data);
        events[i].data = NULL;
        events[i].size = 0;
    }
}

#endif
