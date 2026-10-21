// ENet API stub for builds without R2D_ENABLE_NET.
#ifndef R2D_ENABLE_NET

#include "net.h"

bool r2d_net_init(void) { return false; }
void r2d_net_shutdown(void) {}
bool r2d_net_available(void) { return false; }
bool r2d_net_is_open(void) { return false; }
bool r2d_net_open(int port, int max_peers) { (void)port; (void)max_peers; return false; }
bool r2d_net_connect(const char *host, int port) { (void)host; (void)port; return false; }
bool r2d_net_disconnect(uint32_t peer_id) { (void)peer_id; return false; }
void r2d_net_close(void) {}
int r2d_net_poll(R2DNetEvent *out, int max_events) { (void)out; (void)max_events; return 0; }
void r2d_net_free_events(R2DNetEvent *events, int count) { (void)events; (void)count; }
bool r2d_net_send(uint32_t peer_id, uint8_t channel, bool reliable, const void *data, int size)
{
    (void)peer_id; (void)channel; (void)reliable; (void)data; (void)size;
    return false;
}
const char *r2d_net_error(void) { return "ENet отключён в этой сборке"; }
int r2d_net_port(void) { return 0; }
int r2d_net_peer_count(void) { return 0; }
uint64_t r2d_net_bytes_sent(void) { return 0; }
uint64_t r2d_net_bytes_received(void) { return 0; }
uint64_t r2d_net_packets_sent(void) { return 0; }
uint64_t r2d_net_packets_received(void) { return 0; }

#endif
