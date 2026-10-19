# Re2DSprite: развёртка и математика всех частей тела

Сверено с кодом 8 октября 2026. Основной путь — `$.re2dSprite.from(JSON)`.
Результат — обычный RGBA-спрайт в 2D-батче. Внутри есть XYZ, матрицы
поворота и локальный буфер глубины; отдельной 3D-сцены и mesh-ассета нет.

## 1. Где находится точная форма

У текущего маскота **нет отдельных аналитических функций head(x), arm(x),
leg(x)**. Форма каждой детали — дискретная функция
`S_part(u,v) = (x,y,z)`, записанная строками `[u,v,id,x,y,z]` в
[`russi_maid.surface.json`](../demos/rotsprite/source/russi_maid.surface.json).
Она является источником истины, включая одобренное лицо и последние правки
рук/торса. Нельзя восстанавливать её старой приблизительной формулой цилиндра.

[`russi.character.json`](../demos/rotsprite/russi.character.json) задаёт
привязки, центры вращения и сокеты; [`russi.animations.json`](../demos/rotsprite/russi.animations.json)
содержит все численные ключи движения. Координаты исходной головы локальные;
координаты тела уже размещены в общей системе. `bind` совмещает их.

Левая/правая сторона ниже соответствует именам в JSON: Left имеет X<0,
Right — X>0. Это не обещание анатомической стороны наблюдателя.

## 2. Развёртка и кодирование

Рабочий PNG 1024×1024, физический размер 1024/2048/3072/4096.
Коэффициент `k = width/1024`; все адреса ниже умножаются на k.
Материалы занимают верхние 1024×768, шаг контрольных точек — 4 texel.
Для материала `(u,v)` адрес карты `(mx,my)=(u/4,v/4)`.

| Карта | Начало | R | G | B |
|---|---|---|---|---|
| ID | (0,768) | основная часть | группа материала SUB | вторая часть BLD |
| Глубина | (256,768) | грубая Z | дробная Z SUB | вес второй части BLD |
| Покрытие | (512,768) | 0 нет / 128 прозрачная опора SUB / 255 непрозрачная | резерв | резерв |
| XY | (768,768) | грубая X | грубая Y | дробные X/Y SUB |

Заголовок: `(0,960)=(82,50,68,255)`, `(1,960)=(82,79,84,255)`,
`(2,960)=(2,4,4,255)`. Расширения: SUB в `(3,960)=(83,85,66,255)`;
BLD в `(4,960)=(66,76,68,255)`. BLD требует SUB.

```text
X = (XY.R-128)/4 + (XY.B >> 4)/64
Y = (XY.G-128)/2 + (XY.B & 15)/32
Z = (depth.R-128)/4 + floor(depth.G/17)/64
```

Без SUB дробные слагаемые не читаются. Без BLD ID.B/depth.B не являются весами.
Компилятор ограничивает X/Z диапазоном [-32,31.75], Y — [-64,63.5].
Кодирование каждой компоненты: `q=clamp(round((a*coord+128)*16),0,4080)`,
где a=4 для X/Z, a=2 для Y; грубая часть `q//16`, дробная `q%16`.
Python `round` округляет половины к ближайшему чётному.

Основной ID MUST быть 1..254. ID второй части — 0 (нет) или 1..254;
при ID=0 вес MUST быть 0. Обе используемые части SHOULD быть описаны в rig.
Служебные карты MUST NOT сглаживаться или подвергаться цветокоррекции.
Материал должен иметь бинарную alpha. У активных служебных каналов alpha=255.

Пересборка только координат и весов без перерисовки материала:

```sh
python3 tools/compile_rotsprite.py demos/rotsprite/source/russi_maid.surface.json --material demos/assets/art/mascot/russi_rotsprite_v2.png --output demos/assets/art/mascot/russi_model_maid.png --size 4096 --segments
```

`make_rotsprite_v2.py` собирает художественные материалы и исходный атлас.
Он не заменяет шаг `compile_rotsprite.py --segments`, необходимый для JSON-rig.
Пересборка другого размера может пересэмплировать материал; сохранение верхних
трёх четвертей побитово проверено для текущего атласа maid 4096.

## 3. Авторские функции поверхности

Реализация: [`compile_rotsprite.py`](../tools/compile_rotsprite.py).

- `lerp(a,b,t) = a+(b-a)t`, покомпонентно.
- `section(rows,v)` — линейная интерполяция соседних сечений по v;
  за крайними сечениями возвращает крайнее значение.
- `patches(data)` — три типа ниже. `samples` выдаёт сохранённые координаты
  без преобразования `matrix`; grid/loft применяют affine matrix после расчёта.
- `encode_coordinates(X,Y,Z)` — квантование SUB из раздела 2.
- `compile_surface(...)` — UV, ID, сегментация, веса и карты.

Для `grid`: `u=(texelX-rectX)/width`, `v=(texelY-rectY)/height`.
Индексы клетки определяются `floor(u*(cols-1))`, `floor(v*(rows-1))`,
ограниченными предпоследней строкой/колонкой. Локальные координаты α,β —
дробные остатки. Функция:

```text
S = (1-α)(1-β)P00 + α(1-β)P10 + (1-α)βP01 + αβP11
```

Для `loft` сечение `[v,rx,front,back,cx,cy,cz,offset]`:

```text
θ = 2π(u-.5)+offset
X = cx + rx*sin(θ)
Y = cy
Z = cz + (cos(θ)>=0 ? front : back)*cos(θ)
```

`offset` здесь в радианах. Угол вращения костей в JSON — в градусах.
Сетка rect имеет полуоткрытый диапазон: точка ровно u=1/v=1 не генерируется.
Для замкнутого шва автор MUST обеспечить соответствующие граничные точки.

## 4. Общая функция движения каждой части

Реализация: [`rotsprite.js`](../src/highlevel/rotsprite.js), функции
`affine`, `multiply`, `transform`, `buildRotModelPose`.
Матрицы 3×4 хранятся построчно, точки — столбцы. Пусть c — pivot,
t — translation, D — диагональная scale:

```text
R = Rz(γ) Ry(β) Rx(α)
A(p) = R D (p-c) + c+t
B_bone = B_parent · A_bone         (для root B_parent=I)
M_part = B_bone · A_bind
p' = M_part p
```

В `buildRotModelPose` pivot задаётся в общей исходной системе, а не как
длина относительно родителя. Умножение на родителя переносит весь результат.
Bind использует pivot=0. Порядок каналов: основной клип → слои в порядке
добавления (замена канала) → ручные overrides → прибавление rig.controls.
Слои не являются аддитивными весовыми анимациями.

## 5. Части тела и конкретные преобразования

Для каждой строки ниже применяется S_part из surface, затем соответствующая M.
Составные группы глаз/рта/бровей выбирают один вариант; остальные скрыты.

| Часть | ID | Кость / родитель | Pivot | Bind |
|---|---|---|---|---|
| Голова и лицо | 1 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Уши и боковые банты | 2 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Пряди волос | 3 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Головной убор (в maid нет отсчётов) | 5 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Глаза вариант 0 | 16 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Глаза вариант 1 | 17 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Глаза вариант 2 | 18 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Глаза вариант 3 | 19 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Рот вариант 0 | 32 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Рот вариант 1 | 33 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Рот вариант 2 | 34 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Рот вариант 3 | 35 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Брови вариант 0 | 48 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Брови вариант 1 | 49 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Брови вариант 2 | 50 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Брови вариант 3 | 51 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |
| Хвост | 4 | tail / root | [-2, 10, -8] | I |
| Торс | 6 | root / — | [0, 0, 0] | I |
| Левый рукав выше локтя | 7 | armLeft / root | [-9.5, -10, 0] | I |
| Правый рукав выше локтя | 11 | armRight / root | [9.5, -10, 0] | I |
| Левое бедро | 8 | hipLeft / root | [-5, 20, 0] | I |
| Правое бедро | 12 | hipRight / root | [5, 20, 0] | I |
| Левая голень | 10 | kneeLeft / hipLeft | [-5, 36, 0] | I |
| Правая голень | 15 | kneeRight / hipRight | [5, 36, 0] | I |
| Левая обувь | 13 | kneeLeft / hipLeft | [-5, 36, 0] | I |
| Правая обувь | 14 | kneeRight / hipRight | [5, 36, 0] | I |
| Юбка | 9 | root / — | [0, 0, 0] | I |
| Левое предплечье и кисть | 20 | forearmLeft / armLeft | [-9.5, 4, 0] | I |
| Правое предплечье и кисть | 21 | forearmRight / armRight | [9.5, 4, 0] | I |
| Подслой волос | 24 | head / root | [0, -22, 0] | scale [.9,.86,.86], translation [0,-22,0] |

В портрете head.pivot=[0,0,0], portraitBind=I, projection.scale=2.
В теле projection.scale=1. ID 24 скрыт в портрете. У лица, ушей и волос
нет собственного движения кроме head; headYaw прибавляется к rotation.y.
Торс и юбка следуют root. Отдельной кости таза/позвоночника нет.
Кисти следуют forearm, отдельного запястья или костей пальцев нет.
Обувь следует knee, отдельного голеностопа нет. Хвост имеет одну кость;
волосы и ткань не симулируются физически.

### Локти и колени

Сегментация исходных ID: 7→20 и 11→21 при Y>4; 8→10 и 12→15 при Y>36.
Для локтя W=6, для колена W=7. При `d=coordinate-threshold`:

```text
вне |d|<W/2: одна основная часть, вес второй=0
внутри: t=.5+d/W; h=t²(3-2t)
d<=0: primary=original; secondary=assigned; weight=round(255*h)
d> 0: primary=assigned; secondary=original; weight=round(255*(1-h))
```

W=0 — жёсткое разделение. ID.G сохраняет исходную группу материала;
поэтому поверхность продолжается через границу двух костей.
Это переход между костями у локтя/колена, а не смешивание плеча с торсом.

### Последние изменения формы maid

Текущие результаты уже записаны в samples. Ниже — операции редактирования,
**не повторять их поверх готовых координат**:

- Торс: `Ynew=-15+.8*(Yold+15)`.
- Юбка: `t=(v-408)/164`, `r=7.4+13.1*sin(πt/2)^1.05`;
  X нормирован на прежний радиус строки и умножен на r и складку
  `f=1+.012*cos(12θ)*t²`; `Y=4.5+20t+.18*cos(12θ)*t⁸`;
  Z умножен на `(1+.08*sin(πt))*f`. θ и старый радиус относились к
  исходным координатам операции; точное воспроизведение — сохранённые samples.
- Кисти: для UV-строк v=552..572 `t=(v-552)/20`,
  `r=1.5+.4*sin(πt)-1.15*t⁴`, `Y=14+5t`;
  X относительно центра ±9.5 масштабирован на r/старый радиус,
  Z дополнительно сжат множителем `1-.4t`.
  Это контур кисти без отдельных пальцев.
- Одобренные лицо и подбородок хранятся в таблице головы; эта работа
  с руками/телом не изменяет их.

## 6. Смешивание без сжатия сустава

C: `rigid_dual` и `model_point` в `src/rotsprite_math.c`.
Проверка жёсткой матрицы: столбцы R ортонормальны с допуском 1e-5,
определитель положителен. Из R извлекается единичный quaternion q=(x,y,z,w).
Для переноса T=(tx,ty,tz,0) dual-часть `d=.5*T*q`, где * — произведение
кватернионов. Для двух преобразований:

```text
w = blend_weight/255
sign = dot(q0,q1)<0 ? -1 : 1
q_raw = (1-w)q0 + w*sign*q1
d_raw = (1-w)d0 + w*sign*d1
q = q_raw / |q_raw|; d = d_raw / |q_raw|
p' = vector(q * (p,0) * conjugate(q) + 2*d*conjugate(q))
```

Эквивалент вращения без quaternion multiply:
`v=2*cross(q.xyz,p)`, `rotated=p+q.w*v+cross(q.xyz,v)`.
Если хотя бы одна матрица содержит масштаб/сдвиг осей, используется
`p'=(1-w)M0*p+w*M1*p`: масштаб сохраняется, но гарантии постоянной толщины нет.
Отсутствующая вторичная часть или нулевой вес оставляет M0*p.
Голова имеет bind-scale, но в текущем maid не участвует в суставном blending.

## 7. Анимация и сокеты

`sampleRotClip`: `τ=time mod duration` для loop, иначе `min(time,duration)`.
Между ключами `(t0,v0),(t1,v1)` линейный канал равен
`v0+(v1-v0)*(τ-t0)/(t1-t0)`. Step удерживает v0. До первого/после последнего
ключа удерживается крайнее значение. Углы интерполируются как числа,
без автоматического выбора кратчайшего пути через ±180°.
Полные значения всех клипов поставляются в russi.animations.json.

`socketMatrix`: `S=B_bone*A(pivot=0,translation=socket.point,rotation=socket.rotation)`.
`applyModel` для прикреплённого предмета:
`mount=S_parent*A_offset*inverse(S_grip)`, затем `M_item'=mount*M_item`.
Если grip не задан, множитель inverse отсутствует. Это привязка, не IK.
Кисти-сокеты находятся в (±9.5,18,0), стопы-joints в (±5,54,0).
Смешивание поверхности не меняет сокеты. Двуручный хват требует согласованной
позы обеих рук; универсального автоматического решения IK нет.

## 8. Проекция в 2D и заполнение пикселей

`r2d_rotsprite_angles` / `normalizeRotPose`: yaw нормализуется в [-180,180),
pitch ограничен [-75,75]. Пусть yaw=ψ, pitch=φ (в формулах радианы):

```text
xr = cosψ*x + sinψ*z
zr = -sinψ*x + cosψ*z
yr = cosφ*y - sinφ*zr
depth = sinφ*y + cosφ*zr
```

Канонические joints: `(64+s*xr,64+s*yr)`, s — projection.scale.
Anime: выход size=512, внутренний N=2*size=1024,
`screen=(N/2,N/2)+(4*(size/256)*s)*(xr,yr)`.
Большая depth находится ближе к зрителю. Нет перспективного деления.
Старые C-обёртки anime сохраняют size=256; `_sized` принимает 256/512.

`anime_quad` использует четыре спроецированные опоры P00,P10,P01,P11:

```text
P(u,v)=a+b*u+c*v+d*u*v
a=P00; b=P10-P00; c=P01-P00; d=P11-P10-P01+P00
r=pixelCenter-a
A=-cross(b,d); B=cross(r,d)-cross(b,c); C=cross(r,c)
A*u²+B*u+C=0
v=dot(r-b*u,c+d*u)/dot(c+d*u,c+d*u)
```

Корни вне [0,1] и вырожденные решения отклоняются. Линейный случай A≈0
решается отдельно. Для oneSided проверяется локальный Jacobian
`cross(b+d*v,c+d*u)>epsilon`. Глубина и UV используют одни и те же
билинейные веса `(1-u)(1-v),u(1-v),(1-u)v,uv`, без диагонали.

Материал кэшируется сеткой 5×5 на участок. Цвет интерполируется с весом
alpha; образец alpha<128 отбрасывается. Внутреннее покрытие уменьшается
вдвое с alpha-weighted RGB, затем RGB продолжается на прозрачный край.
Это сглаживание контуров, не увеличение детализации исходного рисунка.

## 9. Совместимость с legacy create(PNG)

`transform_point` при наличии model немедленно использует `model_point`.
Только **без JSON model** выполняются старые правила:

```text
head: R_y(headYaw), scale=.8, Yoffset=-22 (в режиме body)
swing=sin(phase)*stride*π/180
hipLeft=swing; hipRight=-swing; armLeft=-swing; armRight=swing
knee=max(0,sin(phase+(left?0:π)))*abs(stride)*.65*π/180
```

Сгиб колена выполняется вокруг Y=36, бедра вокруг Y=20, руки вокруг Y=-10.
Подъём руки — Rz вокруг (±9.5,-10). Legacy IDs и head-классификация
фиксированы в C и не подходят для интерпретации произвольных JSON IDs.
Эти формулы MUST NOT подменять текущие JSON-клипы маскота.

## 10. Полные исходные функции и проверка

В передаваемом ZIP лежат полные файлы, а не переписанные псевдокодом копии:

| Файл | Математические функции |
|---|---|
| src/highlevel/rotsprite.js | normalizeRotPose, rotPixelRect, sampleRotClip, multiply, affine, transform, buildRotModelPose, inverse, socketMatrix, applyModel, modelJoints |
| src/rotsprite_math.c | rigid_dual, model_point, transform_point, face_visible, cross2, anime_quad, декодирование, проекция и raster API; также legacy v1 |
| src/rotsprite_math.h | структуры точек/весов/матриц и публичные C-сигнатуры |
| tools/compile_rotsprite.py | lerp, section, patches, encode_coordinates, compile_surface |
| tools/make_rotsprite_v2.py | сборка материала и координатных карт из samples |
| demos/rotsprite/source/russi_maid.surface.json | все конкретные S_part(u,v), включая лицо, кисти, юбку |
| demos/rotsprite/russi.character.json | все pivot, bind, группы, сокеты |
| demos/rotsprite/russi.animations.json | все ключи анимаций по каждой кости |

Полный исходник нужен также для численных допусков, fallback и правил
перекрытия. ZIP — справочный срез, не отдельный собираемый движок.
Материал PNG включён, чтобы можно было пересобрать развёртку.

Существующие проверки: `tests/rotsprite/rotsprite_test.c` (билинейная глубина,
UV, сохранение радиуса сгиба), `tests/rotsprite/surface_test.py` (SUB/BLD,
сегментация), `tests/js/rotsprite_json_test.mjs` (матрицы, клипы, сокеты),
`tests/agent/highlevel_rotsprite_test.py` (реальный runtime).
В этой документационной правке код и визуальные данные не менялись.

## 11. Resolved sample depth и новый World (2026-10-10)

Sources: [anime resolve](../src/rotsprite_math.c), [native sample accessor](../src/rotsprite.c), [world stamp](../src/re2d_world.c), [GPU-композиция спрайтов](../shaders/world.frag.glsl). Function names: `r2d_rotsprite_v2_anime_sized`, `r2d_rotsprite_sample_depth`, `r2d_world_stamp_samples`.

При anime resolve размер internal field =2N, output=N (текущий runtime N=512). В каждой группе2×2 output alpha — mean alpha, color — alpha-weighted mean, sample depth — maximum depth among covered subpixels, умноженная на normalization depth_scale: `(model ? model.scale : body ? 1 : 2)/128`. Большая internal depth ближе к зрителю; output sample map сохраняется с конечным RGBA, supersampling arena может переиспользоваться.

Нативная композиция спрайта с высотой основания b, world width W/height H, center=b+H/2, camera basis:

```text
dx = sprite.x-camera.x; dy = sprite.y-camera.y
forward = dx*cos(yaw)+dy*sin(yaw)
centerDepth = forward*cos(pitch)+(center-eye)*sin(pitch)
offset = sampleDepth[texel]*H
projectedDepth = centerDepth-offset
right = (u-.5)*W
up = (.5-v)*H
wx = x-sin(yaw)*right-cos(yaw)*sin(pitch)*up-cos(yaw)*cos(pitch)*offset
wy = y+cos(yaw)*right-sin(yaw)*sin(pitch)*up-sin(yaw)*cos(pitch)*offset
wh = center+cos(pitch)*up-sin(pitch)*offset
```

Alpha<128, behind-near и depth farther than current world sample rejected. Reconstructed wx/wy/wh определяют native span/light/fog receiver. Это camera-aligned 2D synthesis reconstruction, не произвольный character mesh и не physically exact surface normals. Нормаль диффузного освещения спрайта приближённо направлена к camera в XY.

`r2d_rotsprite_sample_depth` возвращает map для anime; pixel/v1 возвращают NULL. `r2d_world_stamp_samples` тогда вызывает fallback image-depth stamp. Поэтому обещание одинаковой sample-depth точности всех styles неверно. Public creation/model format не меняется; [World integration](re2d/RE2DSPRITE_WORLD.md) описывает API/lifecycle/pose budget. Ordinary 2D atlas math выше не следует путать с perspective world camera.
