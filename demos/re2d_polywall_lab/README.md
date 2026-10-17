# Re2D rotating polywall lab — P3

Одна authored стена (`spinner`) вращается вокруг XY-пивота. Runtime мутирует
координаты сегмента в `world.walls`, поэтому trace/blocked/render видят один и
тот же поворот без mesh API и без пересборки topology. Внешние стены статичны.

`re2dPolywall.pause()/resume(speed)` — управление из консоли/агента.
Ограничение: поворот рассчитан на стену, остающуюся внутри footprint своего span
(BSP cell refs не перестраиваются); вынос за пределы span требует authored
topology update.
