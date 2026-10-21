# Authoritative multiplayer demo

This standalone project demonstrates the high-level `$.net` workflow with the
bundled ENet transport. The host owns one shared `$` entity and applies movement
inputs; clients send input and receive interpolated entity snapshots.

Run two copies of the same runtime:

```sh
"$R2D_BINARY" --game demos/multiplayer
```

Press **H** in one window to start the authoritative host. Press **J** in the
other to join `127.0.0.1:7777`. Move the shared orb with **WASD** in either
window. `multiplayer.js` contains the connection settings and host/join helpers;
the scene never polls ENet or accesses `engine.*`.

The Editor can create the same starter module from Project Settings. For
room-based lobbies use `$.net.room.create()` / `$.net.room.join()`; for a simple
game-host relay use `$.net.relay.enable()`. See [the `$.net` reference](../../docs/highlevel/net.md)
for delivery channels, prediction, interpolation tuning, and service limits.
