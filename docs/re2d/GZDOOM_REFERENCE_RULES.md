# GZDoom reference rules

Дата: 2026-10-09. Gate 0. Основание: пользовательский RE2D_WORLD_GZDOOM_RENDERER_PLAN.md, §§3, 58, 73, 75.

MUST: GZDoom служит reference наблюдаемого поведения. Перед реализацией MUST сформулировать требование в RE2D_RENDERER_BEHAVIOR.md и независимое решение через XY BSP + Cell + VerticalSpan + Portal + constrained Surface.

MUST NOT: переносить C/C++, переводить его построчно в C, копировать shaders, comments, lookup tables, assets, magic constants или структуры один-в-один. MUST NOT добавлять GZDoom runtime, WAD/UDMF compatibility layer, generic world meshes, ECS или второй graphics backend.

MUST: каждый новый алгоритм объясняется собственной математикой, источником входных данных и correctness tests. Коэффициенты освещения выбираются нашими визуальными проверками и фиксируются с provenance. GPU triangles допустимы только как внутренний способ rasterization специализированных surfaces.

MUST: публичный вход `$`; bindings parse/validate/convert/call/return; renderer traversal, clipping, light pairing, shadows, queues и GPU uploads принадлежат C. SDL_GPU является backend существующего renderer.

SHOULD: reference analysis и implementation разделяются behavior spec. Для одного агента spec MUST предшествовать реализации; исходник GZDoom MUST NOT служить шаблоном.

## Reference provenance

Текущий spec основан на требованиях приложенного плана и аудите R2D, а не на запуске GZDoom. Попытка прочитать официальные wiki Dynamic_lights, 3D_floor, Portals 2026-10-09 не дала контента (access denied / unavailable). Визуальные наблюдения GZDoom не заявляются как выполненные. GZDoom source/shaders/assets в ходе этой работы не скачивались и не использовались.

Ссылки для будущих карточек наблюдений: https://zdoom.org/wiki/ ; https://github.com/ZDoom/gzdoom . Это reference locations, не подтверждение прочтения или разрешение переносить реализацию. Этот документ задаёт инженерную границу, не юридическое заключение.

## Review gate

MUST: при review сверить происхождение новых файлов, shader equations, constants и assets; сохранять карточку behavior → независимый design → тест. Отсутствие имени GZDoom в коде само по себе не доказывает независимость. Gate 0 не означает готовность renderer или юридическое clearance.
