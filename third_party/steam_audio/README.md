# Steam Audio dependency

Pinned SDK 4.8.1: https://github.com/ValveSoftware/steam-audio/releases/tag/v4.8.1
Archive SHA256: 4a0aa5ec1176f38f0b0993a37c2259d9e86f27e22d5e24f83ec4c3cb9a1d5449

R2D calls only context/default HRTF/binaural effect APIs from the SDK binary. No geometry, simulator, scene graph, engine plugin or authored Steam Audio scene is imported. Source geometry/attenuation/occlusion remain native Re2D queries. The SDK is downloaded into the build tree, not vendored source. Apache 2.0 and bundled third-party notices (including CIPIC HRTF attribution) accompany distribution; see LICENSE.md and THIRDPARTY.md.
