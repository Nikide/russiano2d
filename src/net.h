// High-level game's private ENet transport. Gameplay code only sees $.net.
#ifndef R2D_NET_H
#define R2D_NET_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum R2DNetEventType {
    R2D_NET_EVENT_CONNECT = 1,
    R2D_NET_EVENT_DISCONNECT = 2,
    R2D_NET_EVENT_RECEIVE = 3,
} R2DNetEventType;

typedef struct R2DNetEvent {
    R2DNetEventType type;
    uint32_t peer_id;          // stable for the lifetime of this connection; 0 is reserved
    uint8_t channel;
    uint32_t rtt_ms;
    uint8_t *data;             // caller owns; free with r2d_net_free_events
    int size;
} R2DNetEvent;

bool r2d_net_init(void);
void r2d_net_shutdown(void);
bool r2d_net_available(void);
bool r2d_net_is_open(void);
bool r2d_net_open(int listen_port, int max_peers);
bool r2d_net_connect(const char *host, int port);
bool r2d_net_disconnect(uint32_t peer_id);
void r2d_net_close(void);
int r2d_net_poll(R2DNetEvent *out, int max_events);
void r2d_net_free_events(R2DNetEvent *events, int count);
bool r2d_net_send(uint32_t peer_id, uint8_t channel, bool reliable,
                  const void *data, int size);
const char *r2d_net_error(void);
int r2d_net_port(void);
int r2d_net_peer_count(void);
uint64_t r2d_net_bytes_sent(void);
uint64_t r2d_net_bytes_received(void);
uint64_t r2d_net_packets_sent(void);
uint64_t r2d_net_packets_received(void);

#endif
