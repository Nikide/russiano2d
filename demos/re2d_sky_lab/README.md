# Re2D sky-portal lab — P2

Две authored комнаты (`roomA`/`roomB`) связаны порталом. `re2dSky.set(true)`
помечает портал как sky: visibility не уходит в дальнюю cell, и проём становится
окном в панорамное небо (`world.sky`). `set(false)` возвращает обычный вид в
соседнюю комнату.

Ограничения: это не отдельный 3D render pass и не mesh; флаг `sky` задаётся в
рантайме (`world.portalSky`) и пока не переносится baked-форматом/save.
