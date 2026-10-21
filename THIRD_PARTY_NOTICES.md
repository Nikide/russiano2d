# Сторонние компоненты и их лицензии

Russiano2D собирается через Xmake (`xmake.lua` и `xmake/packages/`). Xmake
управляет зависимостями и генерирует включаемые ресурсы; некоторые сторонние
проекты используют собственные build-инструменты внутри своих рецептов.
Ниже — что именно используется, под какой лицензией и где это закреплено.

Документ описывает **сторонние** компоненты. Лицензия самого движка —
авторская и лежит в `LICENSE`: использовать, менять и распространять свободно.

## Сводная таблица

| Компонент | Версия / пин | Лицензия |
|---|---|---|
| SDL3 | `release-3.4.16` | zlib |
| SDL3_image | `release-3.4.8` (`0891fc3`) | zlib |
| SDL3_mixer | `release-3.2.4` (`72a8186`) | zlib |
| QuickJS-ng | `v0.10.1` (`3c9afc9`) | MIT |
| Box2D | `v3.1.1` (`8c66146`) | MIT |
| RmlUi | `6.3` (`ba95ffe`) — см. сноску ниже | MIT |
| FreeType | bundled 2.13.2 / системная версия | FreeType License (FTL) |
| trylock/visibility | `master` (`71eb5c0`) | MIT |
| glslang | `16.6.0` | Apache-2.0 (части — BSD-3-Clause / MIT) |
| SPIRV-Cross | `vulkan-sdk-1.4.363.0` | Apache-2.0 |
| Steam Audio **4.8.1** | vendored, `third_party/steam_audio`; пин — `xmake.lua`; лицензия кладётся в поставку (`share/licenses/steam_audio`) | Apache-2.0. Используется для настоящей HRTF и окклюзии |
| tinyexr | vendored, `third_party/tinyexr` | BSD-3-Clause |
| ufbx | vendored, `third_party/ufbx` | MIT **или** public domain (на выбор) |
| stb_truetype (`nothings/stb`) | `2c980bb` (1.26) | public domain / MIT (dual) |
| ENet (`zpl-c/enet`) | `v2.7.0` (`8b43b925`) | MIT |
| FastNoiseLite | vendored, `third_party/fastnoise_lite` (`785f37a`, `Cpp/FastNoiseLite.h`) | MIT |
| Tracy | `v0.14.1` (`30997d5`) — только при `-DR2D_TRACY=ON` | BSD-3-Clause |
| zstd | `v1.5.7` (`ac66b19`) — только при `R2D_ENABLE_ZSTD=ON` (по умолчанию) | BSD-3-Clause |
| SMAA (техника) | эталонная реализация `iryoku/smaa` (`master`), **код не вендорился** — своя реализация в `shaders/post.frag.glsl`; см. раздел ниже | MIT (у эталонной реализации) |
| Noto Sans | файл в репозитории | SIL OFL 1.1 |
| LatoLatin | файл в репозитории | SIL OFL 1.1 |
| Open Sans | файл в репозитории (`OpenSans-Regular.ttf`) | SIL OFL 1.1 |
| Roboto Mono | файл в репозитории (`RobotoMono-Regular.ttf`, из образцов RmlUi 6.x) | SIL OFL 1.1 |
| Material Design Icons | шрифт `MaterialIcons-Regular.ttf`, коммит `737e332` | Apache-2.0 |
| TypeScript ECMAScript declarations | `5.9.3`, используются для генерации каталога JS-подсказок редактора | Apache-2.0 (`third_party/typescript/LICENSE.txt`) |

Все библиотеки берутся из своих официальных репозиториев при сборке
(`xmake.lua`, `xmake/packages/`, `tools/xmake_generate.sh`) — тексты их лицензий
распространяются вместе с исходниками, а уведомления обязаны сохраняться в
поставке. Шрифты и иконки лежат в репозитории вместе с текстами лицензий
(`assets/fonts/LICENSE-*.txt`).

## TypeScript ECMAScript declarations — Apache-2.0

`editor/lib/js_builtin_catalog.js` генерируется из ECMAScript-only деклараций
TypeScript 5.9.3 (`lib.esnext.d.ts` и стандартные библиотеки, на которые он
ссылается). Каталог содержит имена, сигнатуры и документационные комментарии
для стандартных JS-глобалов и методов. DOM, WebWorker и ScriptHost декларации
не используются. Исходные декларации распространяются по Apache-2.0; текст
лицензии сохранён в `third_party/typescript/LICENSE.txt`.

**RmlUi — статус версии (проверено 2026-10-16, апстрим `mikke89/RmlUi`):**

* `6.3` (`ba95ffe`, 2026-08-22) — **последний тег апстрима**; новее тегов нет,
  ветки поддержки `6.3.x` тоже нет.
* `master` — объявленная версия `6.4-dev`, HEAD `e74ad4ed`; после 6.3 там 13
  коммитов: box shadows (прозрачные и нулевые), относительные пути в
  `@font-face`, выбор ближайшего скролл-контейнера по направлению колеса,
  удаление бэкенда SDL_renderer, Vulkan/MoltenVK-совместимость, `operator[]`
  вместо неявного преобразования в указатель у `Colour`/`Vector` (#1018).
* **ОСОЗНАННО НЕ ОБНОВЛЯЕМ** на `6.4-dev`: это нерелизная версия, решение
  пользователя — оставить стабильный тег. Откат/обновление — одна строка пина
  в `xmake.lua` или соответствующем рецепте `xmake/packages/`.
* Патч `third_party/patches/rmlui-webgpu.patch` **проверен на master**: файл
  `Backends/RmlUi_Renderer_SDL_GPU.cpp` там байт-в-байт совпадает с 6.3, WGSL
  апстрим так и не принял — патч остаётся нужным и на новой версии.

Состав и лицензии сверены с `README.md` (раздел «Лицензии сторонних
компонентов») и с `xmake.lua`, `xmake/packages/` и `tools/xmake_generate.sh`.

## Что именно попадает в сборку

### SDL3 — zlib
Платформа, окно, ввод, тайминги и SDL_GPU (Vulkan / Metal / DirectX 12).
Если системный SDL3 не найден, Xmake-рецепт собирает `release-3.4.16` из исходников.
Бинарник распространяется под zlib — текст лицензии разрешает использование
в проприетарных продуктах при сохранении уведомления.

### SDL3_image — zlib
Загрузка PNG/BMP/TGA/GIF/QOI. Подмодули ограничены нужным набором:
`external/jpeg`, `external/libpng`, `external/zlib`. Вместе с ними в сборку
приходят их собственные лицензии:

| Встроенная библиотека | Лицензия |
|---|---|
| zlib | zlib |
| libpng | libpng-2.0 |
| libjpeg (из набора SDL_image) | IJG (BSD-подобная) |

Тяжёлые форматы (AVIF, JXL, TIFF, WebP, SVG) отключены и не собираются.

### SDL3_mixer — zlib
Звук и музыка (WAV, OGG, MP3). Подмодули: `external/ogg` и `external/vorbis`
(оба под BSD-3-Clause). MP3 декодируется через `dr_mp3` — заголовочную
библиотеку в составе SDL_mixer (public domain / MIT-0), поэтому libmpg123
не тянется. Прочие кодеки (FLAC, Opus, MOD, MIDI, GME, WavPack) отключены.

### QuickJS-ng — MIT
Скриптовый рантайм. Статическая библиотека `qjs` линкуется в движок,
компилятор `qjsc` используется при `R2D_EMBED_SCRIPTS=ON`.

### Box2D — MIT
Физика v3 (чистый C).

### RmlUi — MIT
Игровой GUI. Собираются ядро и бэкенды под SDL_GPU (файлы бэкендов
компилируются из `Backends/` напрямую, см. `xmake.lua`).

### trylock/visibility — MIT
Полигоны видимости (2D-свет и тени). Используются только заголовки,
C-обёртка — `src/light.cpp`.

### Tracy — BSD-3-Clause
Tracy не входит в текущую Xmake-цель `r2d` и не поставляется с движком.

### SMAA — MIT (у эталонной реализации; код не вендорился)

`$.gfx.smaa()` (`shaders/post.frag.glsl`, блок `#if R2D_SMAA_MODE`) реализует
технику **SMAA — Subpixel Morphological Antialiasing**, описанную Jimenez et al.
(«SMAA: Enhanced Subpixel Morphological Antialiasing», 2012).

* эталонная реализация: <https://github.com/iryoku/smaa> (файл `LICENSE.txt`),
  Copyright (C) 2013 Jorge Jimenez, Jose I. Echevarria, Belen Masia,
  Fernando Navarro, Diego Gutierrez — лицензия MIT-типа: «Permission is hereby
  granted, free of charge…», с уточнением, что включать уведомление в бинарные
  поставки не обязательно;
* **наш код — свой**: ни шейдеры, ни area/search LUT-текстуры эталонной
  реализации в репозиторий не копировались. Реализован вариант SMAA 1x без
  LUT: детекция краёв по яркости с адаптацией к локальному контрасту, поиск
  длины паттерна выборками в шейдере, вес кромки — линейная аппроксимация
  площади. Поэтому таблица выше помечает строку как «техника»;
* уведомление приведено здесь по требованию проектной практики (и потому что
  техника и её авторство должны быть названы), а не потому, что лицензия этого
  требует для бинарной поставки.

### zstd — BSD-3-Clause
Сжатие груза игры: билдер сжимает тело контейнера (`russiano2d build`), движок
распаковывает его на старте — см. [`docs/BUILD.md`](docs/BUILD.md), раздел
«Сжатие груза (zstd)». Подключается отдельным файлом
[`xmake.lua`](xmake.lua) с пином `v1.5.7` / `ac66b19`.

Что важно для поставки:

* **Версия запинена коммитом, уровень сжатия — константа**
  (`R2D_PAYLOAD_ZSTD_LEVEL` в `src/payload.h`, `R2D_ZSTD_LEVEL` в Xmake):
  байты груза зависят и от версии библиотеки, и от уровня, поэтому одинаковое
  дерево обязано давать одинаковый груз. Проверяется
  `tests/agent/payload_compression_test.py` (двойная сборка → один SHA256).
* **Отключается целиком**: `-DR2D_ENABLE_ZSTD=OFF` — сборка без zstd, груз
  пишется в прежнем формате (версия 1, без сжатия), библиотека не скачивается
  и не линкуется. В веб-сборке (Emscripten) выключено по умолчанию.
* **Собирается статически** из исходников (`ZSTD_BUILD_SHARED=OFF`), внутрь
  попадают только compress/decompress. Текст лицензии BSD-3-Clause
  распространяется вместе с исходниками zstd, а уведомление обязано
  сохраняться при распространении сборок со сжатым грузом.
* Библиотека линкуется **только** в движок (`russiano2d`): хостовый C-тест
  разбора груза (`r2d_payload_test`) компилирует `src/payload.c` без
  `R2D_ENABLE_ZSTD` и проверяет старый формат.

### FastNoiseLite — MIT
Комплект шумов для процедурной генерации: OpenSimplex2, OpenSimplex2S, Perlin,
Value, ValueCubic, Cellular (Worley) с метриками расстояния и типами возврата,
фракталы fBm/Ridged/PingPong, domain warp (2D и 3D). Из него собран публичный
`$.noise` и массовые поля для текстур/тайлмапов.

* **Заголовок вендорен как есть**: `third_party/fastnoise_lite/FastNoiseLite.h`,
  коммит `785f37a9ad76e283586a379675085f2063ae03f7` (`Cpp/FastNoiseLite.h`),
  SHA-256 `47a29750dfe13d15651febd235f3c26b1cc57af7c6e26583b838fd7ab5215dc2`.
  Правок внутри нет — иначе эталонные значения перестали бы совпадать.
* Лицензия MIT (Copyright (c) 2023 Jordan Peck, Contributors), полный текст —
  `third_party/fastnoise_lite/LICENSE`. Уведомление обязано сохраняться в
  поставке: заголовок компилируется прямо в `russiano2d` (тонкий C-фасад —
  `src/noise.cpp`, объявления — `src/noise.h`).
* Пин, SHA и порядок обновления (с перегенерацией эталона) описаны в
  `third_party/fastnoise_lite/README.md`; эталон — в
  `third_party/fastnoise_lite/reference.cpp` и
  `tests/agent/noise_set_test.py`.
* В апстриме есть и порт на C (`C/FastNoiseLite.h`) — он **не взят**: у
  канонического C++-заголовка есть опубликованные эталонные значения, на них и
  держится проверка.

### glslang и SPIRV-Cross — Apache-2.0
Инструменты сборки шейдеров: GLSL → SPIR-V (`glslangValidator`) и
SPIR-V → MSL (`spirv-cross`). В **готовый бинарник не попадают** — работают
только на этапе сборки и генерируют `src/generated/shaders.h`. glslang
включает отдельные файлы под BSD-3-Clause и MIT; при распространении
уведомление Apache-2.0 и уведомления этих файлов должны сохраняться.

### Шрифты — SIL OFL 1.1
- **Roboto Mono** — `assets/fonts/RobotoMono-Regular.ttf`, полный текст:
  `assets/fonts/LICENSE-RobotoMono.txt`. Моноширинный шрифт редактора кода
  (`editor/`): позиция каретки считается как колонка × ширина символа.
- **Open Sans** — `assets/fonts/OpenSans-Regular.ttf`, полный текст:
  `assets/fonts/LICENSE-OpenSans.txt`. Это **шрифт движка по умолчанию**: он
  покрывает и латиницу, и кириллицу. Взят статический Regular из официальной
  раздачи (вариативный файл крупнее вчетверо, а вариации движок всё равно не
  применяет).
- **Noto Sans** — `assets/fonts/NotoSans-Regular.ttf`,
  полный текст: `assets/fonts/LICENSE-NotoSans.txt`.
- **LatoLatin** — `assets/fonts/LatoLatin-Regular.ttf`,
  полный текст: `assets/fonts/LICENSE-Lato.txt`. Это подмножество только
  с латиницей: кириллица в нём не отрисуется, поэтому по умолчанию движок
  его больше не берёт.

Кириллица важна не «на будущее»: раньше семейство по умолчанию выбиралось как
первый файл по алфавиту, и им оказывался LatoLatin — русские подписи молча
исчезали (глифов нет — рисовать нечего). Теперь движок предпочитает Open Sans,
а из остальных берёт первый шрифт, в котором кириллица действительно есть
(см. `autoload_default_font` в [`src/font.c`](src/font.c)).

Шрифты распространяются по SIL OFL 1.1: их можно встраивать и поставлять
вместе с продуктом, в том числе проприетарным. Если шрифт **изменяется**,
OFL требует распространять его под другим именем.

### Material Design Icons — Apache-2.0
Шрифт `MaterialIcons-Regular.ttf` и таблица `.codepoints` не лежат в
репозитории: `tools/xmake_generate.sh` скачивает их с конкретного коммита
`google/material-design-icons` и проверяет SHA256. Шрифт встраивается в
исполняемый файл байтами, поэтому уведомление Apache-2.0 в релизной сборке
сохраняется (см. раздел «Что нужно сделать до релиза»).

## Ассеты

| Что | Происхождение | Статус |
|---|---|---|
| `assets/icons/russiano2d.png`, `assets/icons/russiano.ico` | материалы владельца проекта | права заявлены владельцем |
| `assets/audio/**` (OGG) | подготовлены инструментами репозитория; исходники — вне репозитория | **происхождение не подтверждено** |
| `demos/assets/art/**` | `tools/make_demo_assets.py` из исходных листов, лежащих вне репозитория (`R2D_SOURCE_ART`) | **происхождение не подтверждено** |
| Текстуры/атласы, генерируемые `tools/make_wall_textures.py`, `tools/make_atlas.py`, `tools/make_demo_assets.py` | генерируются из исходников | зависит от исходников |

README заявляет лишь то, что «иконка приложения и иллюстрация для README —
материалы владельца проекта». Для демо-арта и звука источник в репозитории
не зафиксирован, поэтому **до публичного релиза владелец должен подтвердить
права** на эти файлы либо заменить их. Это второй блокер после выбора
лицензии движка (см. `docs/RELEASING.md`).

## Что нужно сделать до релиза

1. **Выбрать лицензию самого движка** (см. `docs/RELEASING.md`) и положить
   `LICENSE` в корень.
2. Добавить в `dist/<os>-<arch>/` тексты лицензий сторонних компонентов.
   Полные тексты проще всего скопировать из исходников, скачанных
   FetchContent, в `build/_deps/`: у каждой зависимости есть `LICENSE*`.
   Минимум — zlib (SDL3, SDL3_image, SDL3_mixer), MIT (QuickJS-ng, Box2D,
   RmlUi, visibility), Apache-2.0 (glslang, SPIRV-Cross, MDI),
   SIL OFL (шрифты), а также лицензии встроенных libpng/libjpeg/ogg/vorbis.
3. Подтвердить права на демо-арт и звук либо исключить их из поставки.
4. После выбора лицензии добавить её в `README.md` (это делает владелец:
   файл вне зоны правки этого документа).

## FreeType

This software uses the FreeType library. Copyright belongs to the FreeType project authors.
The bundled cross-build uses FreeType 2.13.2 under the FreeType License:

```text
                    The FreeType Project LICENSE
                    ----------------------------

                            2006-Jan-27

                    Copyright 1996-2002, 2006 by
          David Turner, Robert Wilhelm, and Werner Lemberg



Introduction
============

  The FreeType  Project is distributed in  several archive packages;
  some of them may contain, in addition to the FreeType font engine,
  various tools and  contributions which rely on, or  relate to, the
  FreeType Project.

  This  license applies  to all  files found  in such  packages, and
  which do not  fall under their own explicit  license.  The license
  affects  thus  the  FreeType   font  engine,  the  test  programs,
  documentation and makefiles, at the very least.

  This  license   was  inspired  by  the  BSD,   Artistic,  and  IJG
  (Independent JPEG  Group) licenses, which  all encourage inclusion
  and  use of  free  software in  commercial  and freeware  products
  alike.  As a consequence, its main points are that:

    o We don't promise that this software works. However, we will be
      interested in any kind of bug reports. (`as is' distribution)

    o You can  use this software for whatever you  want, in parts or
      full form, without having to pay us. (`royalty-free' usage)

    o You may not pretend that  you wrote this software.  If you use
      it, or  only parts of it,  in a program,  you must acknowledge
      somewhere  in  your  documentation  that  you  have  used  the
      FreeType code. (`credits')

  We  specifically  permit  and  encourage  the  inclusion  of  this
  software, with  or without modifications,  in commercial products.
  We  disclaim  all warranties  covering  The  FreeType Project  and
  assume no liability related to The FreeType Project.


  Finally,  many  people  asked  us  for  a  preferred  form  for  a
  credit/disclaimer to use in compliance with this license.  We thus
  encourage you to use the following text:

   """
    Portions of this software are copyright © <year> The FreeType
    Project (www.freetype.org).  All rights reserved.
   """

  Please replace <year> with the value from the FreeType version you
  actually use.


Legal Terms
===========

0. Definitions
--------------

  Throughout this license,  the terms `package', `FreeType Project',
  and  `FreeType  archive' refer  to  the  set  of files  originally
  distributed  by the  authors  (David Turner,  Robert Wilhelm,  and
  Werner Lemberg) as the `FreeType Project', be they named as alpha,
  beta or final release.

  `You' refers to  the licensee, or person using  the project, where
  `using' is a generic term including compiling the project's source
  code as  well as linking it  to form a  `program' or `executable'.
  This  program is  referred to  as  `a program  using the  FreeType
  engine'.

  This  license applies  to all  files distributed  in  the original
  FreeType  Project,   including  all  source   code,  binaries  and
  documentation,  unless  otherwise  stated   in  the  file  in  its
  original, unmodified form as  distributed in the original archive.
  If you are  unsure whether or not a particular  file is covered by
  this license, you must contact us to verify this.

  The FreeType  Project is copyright (C) 1996-2000  by David Turner,
  Robert Wilhelm, and Werner Lemberg.  All rights reserved except as
  specified below.

1. No Warranty
--------------

  THE FREETYPE PROJECT  IS PROVIDED `AS IS' WITHOUT  WARRANTY OF ANY
  KIND, EITHER  EXPRESS OR IMPLIED,  INCLUDING, BUT NOT  LIMITED TO,
  WARRANTIES  OF  MERCHANTABILITY   AND  FITNESS  FOR  A  PARTICULAR
  PURPOSE.  IN NO EVENT WILL ANY OF THE AUTHORS OR COPYRIGHT HOLDERS
  BE LIABLE  FOR ANY DAMAGES CAUSED  BY THE USE OR  THE INABILITY TO
  USE, OF THE FREETYPE PROJECT.

2. Redistribution
-----------------

  This  license  grants  a  worldwide, royalty-free,  perpetual  and
  irrevocable right  and license to use,  execute, perform, compile,
  display,  copy,   create  derivative  works   of,  distribute  and
  sublicense the  FreeType Project (in  both source and  object code
  forms)  and  derivative works  thereof  for  any  purpose; and  to
  authorize others  to exercise  some or all  of the  rights granted
  herein, subject to the following conditions:

    o Redistribution of  source code  must retain this  license file
      (`FTL.TXT') unaltered; any  additions, deletions or changes to
      the original  files must be clearly  indicated in accompanying
      documentation.   The  copyright   notices  of  the  unaltered,
      original  files must  be  preserved in  all  copies of  source
      files.

    o Redistribution in binary form must provide a  disclaimer  that
      states  that  the software is based in part of the work of the
      FreeType Team,  in  the  distribution  documentation.  We also
      encourage you to put an URL to the FreeType web page  in  your
      documentation, though this isn't mandatory.

  These conditions  apply to any  software derived from or  based on
  the FreeType Project,  not just the unmodified files.   If you use
  our work, you  must acknowledge us.  However, no  fee need be paid
  to us.

3. Advertising
--------------

  Neither the  FreeType authors and  contributors nor you  shall use
  the name of the  other for commercial, advertising, or promotional
  purposes without specific prior written permission.

  We suggest,  but do not require, that  you use one or  more of the
  following phrases to refer  to this software in your documentation
  or advertising  materials: `FreeType Project',  `FreeType Engine',
  `FreeType library', or `FreeType Distribution'.

  As  you have  not signed  this license,  you are  not  required to
  accept  it.   However,  as  the FreeType  Project  is  copyrighted
  material, only  this license, or  another one contracted  with the
  authors, grants you  the right to use, distribute,  and modify it.
  Therefore,  by  using,  distributing,  or modifying  the  FreeType
  Project, you indicate that you understand and accept all the terms
  of this license.

4. Contacts
-----------

  There are two mailing lists related to FreeType:

    o freetype@nongnu.org

      Discusses general use and applications of FreeType, as well as
      future and  wanted additions to the  library and distribution.
      If  you are looking  for support,  start in  this list  if you
      haven't found anything to help you in the documentation.

    o freetype-devel@nongnu.org

      Discusses bugs,  as well  as engine internals,  design issues,
      specific licenses, porting, etc.

  Our home page can be found at

    https://www.freetype.org


--- end of FTL.TXT ---

```
