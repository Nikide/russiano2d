# Real2D v4 / Re2D v4 — инженерная спецификация

Версия: 4.0-draft, 10 октября 2026. Названия Real2D v4 и Re2D v4 обозначают одну модель. Это проектный контракт, а не утверждение о существующей реализации. MUST — обязательное требование, SHOULD — рекомендация, MAY — опция.

## 1. Задача и границы доказательства

Построить детерминированный непрерывный 2D renderer аниме-персонажа из авторских RGBA-фрагментов, согласованных 2D сеток, семантических landmarks и коэффициентов функций ракурса. Каждое значение yaw вычисляется, а не выбирается из готовых кадров. Художественные изменения носа, глаз, чёлки и силуэта являются явными данными.

MUST: полный круг yaw; поддерживаемый pitch; сохранение идентичности и аниме-пропорций; связность частей; корректная окклюзия; воспроизводимость; трассировка источников пикселей. MUST NOT: 3D меш, VRM, volumetric reconstruction, перспективная проекция 3D, neural renderer, генерация/дорисовка итоговых кадров, скрытый lookup готовых полнофигурных ракурсов.

2D triangle meshes допустимы исключительно как сетки деформации изображений. Pseudo-depth — скаляр порядка композиции, не третья координата тела. Фотографическая физическая точность, автоматическое восстановление невидимых деталей из одного изображения и универсальный персонаж без авторинга — нецели.

**Не существует универсальной «идеальной формулы», которая гарантирует хорошее аниме из любых данных.** Идеальный объект здесь — определённая автором функция изображения; конечная база приближает её в заданном домене. Ошибки данных не исправляются обещанием математической гладкости. Для произвольного pitch без ограничения нужны данные для всего домена, включая верх/низ и особые полюсные состояния. MVP гарантирует yaw ∈ S¹, pitch ∈ [−30°,30°]. Вне диапазона API возвращает OUT_OF_DOMAIN; clamp допустим только явно выбранной политикой и должен отражаться в отчёте. Расширение до ±90° — отдельная стадия с дополнительными ракурсами, не экстраполяция.

## 2. Определения и координаты

- θ — yaw, радианы: 0 фронт, π/2 персонаж повёрнут носом вправо на экране, π спина, 3π/2 нос влево.
- φ — pitch: положительный означает взгляд камеры на персонажа сверху; отрицательный — снизу.
- x вправо, y вниз; локальные координаты в единицах высоты персонажа H. Root/pelvis — общий origin. Экранное масштабирование применяется последним.
- s — ограниченный вектор состояния: выражение, blink_L/R, mouth_open, gaze_x/y, pose controls. Имена L/R всегда анатомические; near/far вычисляются из вида, идентификаторы никогда не меняются местами.
- patch — RGBA-фрагмент с UV, cage, семантической принадлежностью и вариантами appearance.
- anchor — авторский образец геометрии/видимости/appearance при (θ_j,φ_j,s_j), не готовый runtime-кадр.
- chart — семейство 2D сеток с фиксированной связностью. topology switch меняет chart, но не идентичность детали.
- q — общий вектор 2D координат cage, landmarks и параметров силуэта; α — opacity gate; d — pseudo-depth.

Все runtime углы в radians. normYaw(θ)=θ−2π floor(θ/2π). Circular difference Δ(a,b)=atan2(sin(a−b),cos(a−b)). MUST NOT линейно интерполировать числа градусов через шов 0/360. Pitch u=φ/φ_max для симметричного домена; для асимметричного — affine map в [−1,1].

## 3. Идеальная функция и реализуемая модель

Идеальная авторская функция:

R*: S¹ × [φ_min,φ_max] × S → Image_RGBA.

Реализация:

R(θ,φ,s)=Display(Composite_{order(d)} { α_i · Warp(T_i(θ,φ,s), M_i(q(θ,φ,s))) } ).

T_i — смесь только совместимых appearance текстур в общих UV; несовместимые варианты композируются отдельными gated charts. Composite работает в linear RGB с premultiplied alpha, Display переводит RGB в sRGB. Все операции, коэффициенты, маски и исходные texel'ы фиксируются в пакете. По возможности R непрерывна в L1 изображений; C¹ ожидается для координат внутри chart. Непрерывность изображения при смене дискретной топологии обеспечивается масками, а не попыткой сделать индексы треугольников непрерывными.

Требуемая цикличность: R(θ+2π,φ,s)=R(θ,φ,s), q(θ+2π)=q(θ), ∂θq(θ+2π)=∂θq(θ). Большая величина скачка z-order не оправдывает скачок видимого изображения.

## 4. Глобальная view manifold и low-rank

Для J согласованных anchors сформировать X ∈ R^(J×D), строки q_j. D содержит все cage vertices/landmarks одного согласованного chart. Масштаб, root и анатомические ID должны совпадать. Обучать отдельные chart-базы при разной топологии; запрещено складывать несопоставимые индексы.

μ=(1/J)Σ_j q_j; X_c=X−1μᵀ. SVD: X_c=UΣVᵀ. B=V[:,0:r] ∈ R^(D×r); a_j=Bᵀ(q_j−μ). Runtime q=μ+B a(θ,u,s)+δ_semantic.

Выбирать минимальный r с Σ_(k≤r)σ_k²/Σ_kσ_k²≥0.995, но также проверять max landmark error и силуэт. r≤min(J−1,D). PCA объяснённая дисперсия не является критерием художественного качества. Координаты нормировать по H, landmark importance задавать diagonal W; для weighted PCA использовать X_c W^(1/2), затем восстановить физические координаты через W^(−1/2).

Пропущенные landmarks MUST иметь valid mask; не заменять отсутствующую геометрию нулями. Использовать masked alternating least squares либо подготовить chart с полными соответствиями. Геометрия скрытой детали обязана иметь согласованное продолжение, когда она появляется снова.

Глобальная база связывает лицо, волосы и тело: независимые случайные локальные warp запрещены. Скелетные attachment constraints и landmark constraints ограничивают residual δ. Для сильно локальной детали допустима дополнительная малая база, но она должна быть привязана к общей геометрии.

## 5. Fourier по yaw и tensor basis по pitch/state

F(θ)=[1,cosθ,sinθ,...,cosKθ,sinKθ]. Pitch basis T_l(u) — Chebyshev polynomials: T0=1, T1=u, T_(l+1)=2uT_l−T_(l−1). Это полиномиальная база, устойчивее monomials высокого порядка.

Для латентной компоненты n:

a_n(θ,u,s)=Σ_(k=0..2K)Σ_(l=0..L) c_nkl F_k(θ)T_l(u)
          +Σ_m s_m Σ_kl e_nmkl F_k(θ)T_l(u).

Interactions s_m s_n — только явно разрешённые и обученные. s=0 — neutral. База separable, но содержит все yaw×pitch interactions. Общая fitted функция также используется для logits visibility, depth и landmark offsets. Геометрические ограничения могут проектировать результат после evaluation; projection должна быть детерминированной и гладкой в нормальном домене.

Fit C=argmin_C Σ_j w_j||A_j C−a_j||² + λ Σ_nkl [freq(k)^4+l^4]c_nkl². freq(0)=0; для пары cos/sin одного harmonic одинакова. Решать QR/SVD, не инвертировать normal equations напрямую. Проверять rank/condition number; недостаточные данные → снизить K/L, добавить anchors либо вернуть диагностическую ошибку, не скрывать недоопределённость.

Defaults K=3, L=2, r=8..16 (ограничен J). K=5 разрешать только после holdout улучшения. Производные по yaw аналитические, например ∂θcos(kθ)=−k sin(kθ). Нельзя интерполировать PCA signs между bake: знак basis фиксируется детерминированно, например максимальная по модулю компонента положительна.

## 6. Редкие appearance anchors

Геометрические anchors и appearance anchors — разные данные. Не требуется новая текстура для каждого угла. Для совместимых вариантов в одной UV chart:

ℓ_j=κ_j[cos(θ−θ_j)−1]−(u−u_j)²/(2h_j²)+log ρ_j;

w_j=exp(ℓ_j−maxℓ)/Σ_m exp(ℓ_m−maxℓ).

ρ>0 — prior; κ≥0 — концентрация von Mises. Circular RBF альтернативно exp(−2 sin²(Δθ/2)/hθ²). Не использовать обычный Gaussian по неwrapped θ. Ограничить поддержку gate_j через smoothstep окна; при нулевой сумме поддержки MUST fallback к явно указанному безопасному варианту либо ошибке.

T_i(v)=Σ_j w_j T_ij(v) для одинаковых UV и совпадающих деталей; blending premultiplied RGBA в linear RGB. C_i=Σ_j w_j C_ij допустимо для согласованных cage, не для разных топологий. Softmax не проходит точно через anchors: fidelity оценивается, а не предполагается. При необходимости точного совпадения использовать cardinal periodic RBF solve с проверкой conditioning или компактные partition-of-unity weights с w_j(anchor_j)=1; не добавлять exact-angle screenshot branch.

Defaults κ=12, pitch h=0.5 в u, поддержка ±60° для локального варианта. κ зависит от шага anchors: слишком большая κ превращает систему в переключатель. Нос front/3q/profile, eye open/closed и hair front/back могут иметь разные charts. Crossfade двух несовпадающих рисунков не должен давать двойные глаза/нос; приведение в общий chart или occlusion handoff обязательно.

## 7. Visibility, маски и topology switches

Base visibility v_i=σ(f_i(θ,u,s)), σ(x)=1/(1+exp(−x)); считать устойчивой ветвящейся реализацией. Итоговая alpha α_i(x)=v_i·g_i·A_i(x)·O_i(x), где g topology gate, A texture alpha, O occlusion mask. Повторное умножение premultiplied RGB/alpha выполняется одинаково. Для полного исчезновения sigmoid недостаточно; компактный gate обязателен.

smoothstep(t)=3t²−2t³, t=clamp(t,0,1). На локальном circular interval вычислять расстояние Δ к центру; gate задаётся внутренним и внешним радиусом. Для двух charts в полосе перехода g_A=1−smoothstep(t), g_B=smoothstep(t), сумма=1. Gate не является компенсацией ошибочного landmarks alignment.

Правила:
1. Один semantic feature имеет общий ID и owner group; варианты не создают второй глаз или второй рот.
2. Chart activate до потери положительной площади старой сетки. Ни один видимый triangle не может вывернуться.
3. Топология переключается в окклюдированной области или через маски согласованного силуэта. Видимые края и landmarks должны совпадать с допуском.
4. Геометрия детерминированна от входа. Hysteresis MAY только для culling, не для определения изображения; результат не зависит от направления обхода угла.
5. При совпадении gates у одной группы анализировать результирующую alpha: обычное over двух opacity 0.5 даёт 0.75, а не 1. Поэтому совместимые варианты сначала смешивать внутри группы; несовместимые — использовать coverage partition с нормализованной group composition.

Far eye исчезает при profile по авторской маске, а не сжимается через отрицательную ширину. Front face заменяется back/head chart там, где face уже закрыто. Невидимые детали могут продолжать деформироваться, но не должны вносить цвет.

## 8. Cage / triangle warp

Каждый texture chart имеет reference 2D cage V0, triangle indices и фиксированные UV. Dense mesh vertex p0 хранит triangle cage index t и barycentric λ=(λ0,λ1,λ2), λ≥−ε, Σλ=1. После evaluation p=Σ_a λ_a V_ta. Barycentric bindings вычисляет Baker, runtime их только применяет. Привязки вне cage запрещены, кроме явно маркированной bounded extrapolation; default запрет.

Для raster triangle (p0,p1,p2) вычислить barycentric β экранного sample x, затем uv(x)=Σ β_a uv_a; bilinear sample atlas. Это inverse mapping, исключающее дырки forward splatting. Все треугольники 2D, без perspective correction. Использовать единую top-left fill rule и shared vertices, чтобы избежать швов.

signed area A_t=0.5 cross(v1−v0,v2−v0); sign должен совпадать с reference. Ratio A_t/A_t0≥0.05 для visible triangles; для alpha=0 допускается culling degenerate triangles до raster. Fold-over penalty max(0,ε_A−A/A0)² дополняется hard validator: loss сам по себе не гарантирует отсутствие инверсии. При нарушении MUST bake failure или chart repair; runtime безопасно отвергает повреждённый пакет, не исправляет flip сортировкой вершин.

Cage обычно 12..48 vertices/patch, dense mesh 32..128 triangles; глаза/рот требуют мелких локальных элементов. UV immutable, atlas padding минимум 4 texel, dilation RGB под прозрачным краем; mip levels требуют собственного padding. Sampling вне rect MUST clamp внутри разрешённого padded rect.

## 9. Pseudo-depth и окклюзия

d_i(θ,u,s) — scalar Fourier/tensor function, больше = ближе, размерность условная. Draw order по возрастанию d, stable tie по semantic priority и ID. Нельзя использовать d для 3D projection, освещения или геометрического восстановления.

Частичный порядок задаётся constraints: back hair behind face, bangs ahead forehead, eyelids ahead iris, clothes ahead body. Динамические relations near arm/body/far arm определяются chart-domain правилами. Cycles в occlusion graph — bake error; при локальном взаимном перекрытии разбить patch/ввести masks, а не выбирать случайный order.

Order меняется при пересечении depth. Если patches имеют непустое видимое пересечение с разными цветами, swap даёт discontinuity. MUST разместить crossing в zero-overlap / gated interval или использовать spatial occlusion masks с плавным handoff. Runtime stable sort сам по себе не обеспечивает temporal coherence.

Покрытие определяется масками, не только глобальным z. Например одна прядь может лежать за ухом и перед шеей: разделить её на subpatches с attachment links. На seam цвета согласуются. Для каждого важного overlap хранить occluder, occludee, mask и valid domain.

## 10. Семантические ограничения

Все bounds задаются character profile; ниже стартовые, не универсальная анатомия. H=1. Лицевые landmarks нормировать также по head width W_h.

- Face: одна непрерывная outer silhouette, jaw/chin/temples без fold-over; attachment neck/jaw не расходится. Contour style меняется авторски, не по эллипсоиду.
- Eyes: анатомические L/R постоянны; corners закреплены на face chart; iris внутри eyelid mask; eye width>0 в активном chart; far eye hidden в profile; две видимые пары глаз запрещены. Relative eye center error ≤0.015 W_h; eyelid/iris clipping MUST.
- Nose: единый bridge/tip landmark; front line/3q/profile silhouette — appearance variants. Front nose не обязан геометрически превращаться в profile, но переход не создаёт двух контуров. Nose tip внутри face silhouette, кроме profile silhouette chart, где он на границе.
- Mouth: один center, corners и upper/lower curve; mouth interior отдельный gated patch. Mouth center внутри jaw domain; teeth/tongue не выступают через lips. Blink не влияет на рот.
- Hair: back mass/side locks/bangs отдельны; root points привязаны к scalp; концы допускают state motion, roots error ≤0.005H. Не рисовать глаз поверх непрозрачной чёлки.
- Body: плечо/локоть/кисть/таз/колено/стопа имеют shared landmarks; одежда привязана к телу. Seam attachment error ≤0.003H. Не менять длину рук произвольной независимой интерполяцией.
- Identity: общая палитра, отношение высоты головы к H, расстояние глаз, форма чёлки и костюм сохраняются; asymmetry хранится явно. Отражение допустимо только для author-declared symmetric patch, не для всего персонажа по умолчанию.
- State: blink∈[0,1], mouth_open∈[0,1], gaze∈[−1,1]²; pose limits authored. Нельзя обещать произвольный pose по neutral anchors. Expressions должны иметь свои параметры/данные и тесты.

Constraint solver — bounded least squares projection P_C(q), warm start запрещён если делает результат path dependent. Defaults до 8 deterministic iterations, tolerance 1e−5H; при неуспехе диагностировать, не продолжать молча. Явно тестировать гладкость после projection.

## 11. Baker objective

Baker оптимизирует параметры Θ: global basis coefficients, visibility/depth coefficients, gates и ограниченные cage corrections. Atlas texels фиксированы после authoring; Baker не дорисовывает текстуры. E=Σ λ_k E_k. Все terms нормированы на число элементов и характерный масштаб, иначе веса бессмысленны.

E_anchor=mean_j [||W(q_j−q_j*)||²/H² + ||R_j−I_j*||_1 + ||α_j−α_j*||_1]. Reference composites служат только supervision, запрещены как runtime frames.

E_smooth=mean_domain [||∂²θ q||²/H² + β||∂²u q||²/H² + γ||∂θ∂u q||²/H²]; штрафовать также visibility/depth derivative там, где это нужно. Не заставлять художественные профильные transitions исчезать.

E_loop=mean_u [||q(0)−q(2π)||²/H²+||∂θq(0)−∂θq(2π)||²/H²+||R(0)−R(2π)||_1]. Fourier closure встроена, term проверяет другие ветви и metadata.

E_fold=mean_visible_tri max(0,0.05−A/A0)²; hard reject A/A0≤0.

E_silhouette=mean_j [1−IoU(S_j,S_j*) + mean_boundary |SDT(S_j*)(x)|/H], SDT — signed distance target silhouette.

E_landmark=mean_valid_jm ω_m||l_jm−l_jm*||²/H²; missing landmarks excluded.

E_temporal=mean_trajectories ||R_(t+1)−WarpFlow(R_t,q_t→q_(t+1))||_1 на persistent visible regions; исключить disocclusion по валидной маске. Дополнительно контролировать ускорение landmarks. Просто штраф raw image differences может подавить движение, поэтому запрещён как единственный term.

E_occlusion=mean_rules [visibility mismatch + mask leakage + depth margin violations]. Для required d_a>d_b: max(0,m−(d_a−d_b))². Margin m=0.02 в нормированных depth единицах. Mask leakage измеряется opacity запрещённой детали внутри opaque occluder.

E_attach=mean_links ||p_a−p_b||²/H²; E_reg=sum frequency-weighted coeff². Defaults λ: anchor 10, smooth 0.1, loop 10, fold 100, silhouette 5, landmark 20, temporal 1, occlusion 10, attach 30, reg 0.001. Это стартовые гиперпараметры; Baker MUST отчёт actual scales, residuals и изменения весов. Нельзя объявлять успех только по уменьшению total loss.

## 12. Авторинг и минимальное покрытие

Порядок: character design → neutral key views → segmentation → correspondences/cages → appearance variants → fit → random-angle validation → дополнительные anchors в проблемных областях.

MVP минимум 12 yaw views при φ=0: 0,30,60,...,330°. Для pitch L=2 добавить те же 12 при −30° и +30°: **36 geometry anchors**. Для K=3,L=2 имеется 21 tensor feature; 36 grid samples дают возможность полного rank fit, но condition number проверять обязательно. 8 yaw достаточно для K=3 при одной pitch slice по sampling, однако не является достаточным художественным минимумом для полного персонажа. Любое сокращение до front/side/back — отдельный эксперимент без обещания качества.

Рекомендуется 16 yaw ×3 pitch =48; добавить views 75/90/105 и 255/270/285 при плохом profile переходе. Pitch holdouts ±15° обязательны. Не менее front, left profile, back, right profile у каждого крупного silhouette chart. Appearance: face front/left3q/leftprofile/right3q/rightprofile/back-head (5 face + back head), eyes front/near3q/profile-gated/closed, nose front/3q/profile по каждой стороне при асимметрии; число variants зависит от автора, не равняется числу geometry anchors.

Каждый anchor одинакового масштаба, root, palette, illumination и pose. Сначала подписать θ/φ в metadata, не полагаться на надписи в картинке. Непрозрачные перекрывающие части отделить от скрытых частей; скрытая текстура должна существовать. Padding, premultiplied convention, color space и landmarks обязательны. Исходный генеративный spritesheet — **candidate source**, не автоматически корректный atlas: точные клетки, углы, alpha и соответствия проверить кодом и глазами.

Не использовать полнофигурные кадры как patches в runtime. Полнофигурный turnaround MAY храниться в authoring/reference и не должен попасть в compiled runtime payload. Один flat spritesheet без отделённых глаз/волос/тела недостаточен для этой модели.

## 13. Единый контейнер .r2d4

.r2d4 — ZIP store/deflate с фиксированными именами, UTF-8 manifest, little-endian float32 arrays. Это предлагаемая спецификация формата, не существующий стандарт. ZIP timestamps фиксировать для reproducible bake. Loader MUST ограничивать размеры/число entries и запрещать traversal, duplicates, absolute paths.

```text
manifest.json                 # format="r2d4", version=4, domains, hashes
atlas/atlas_00.png             # RGBA8 sRGB straight-alpha storage
geometry/vertices.f32         # local 2D coords / basis / coeff arrays
geometry/triangles.u32
geometry/bindings.bin
appearance/patches.json
rules/visibility.json
rules/topology.json
rules/occlusion.json
semantic/landmarks.json
bake/report.json
```

PNG хранится straight-alpha; после decode runtime переводит RGB в linear и premultiplies. Каждый binary section имеет type, count, stride, byte_offset, byte_length в manifest; uint32 индексы; конечные значения, bounds, overflow и checksum валидируются до выделения памяти. Atlas rect в texels, UV в [0,1], padding отдельно. Array order coefficient[n][yaw_feature][pitch_feature], row-major. Pose interactions отдельными sections.

Manifest MUST: generator/baker version, source SHA256, atlas SHA256, angle convention, supported domains/states, H, basis rank/K/L, patches/charts IDs, semantic ownership, max allocation budget, texture conventions, fallback policy, provenance flags. Authoring package и compiled container различать. report.json не должен содержать ложный runtime pass до выполнения acceptance suite.

## 14. Рекомендуемые C структуры и API

```c
#include <stdint.h>
typedef struct { float x,y; } R2D4Vec2;
typedef struct { uint32_t a,b,c; } R2D4Tri;
typedef struct { uint32_t tri; float w[3]; } R2D4Binding;
typedef struct { uint32_t x,y,w,h,pad,atlas_id; } R2D4Rect;
typedef struct {
    uint32_t rank, dims, yaw_K, pitch_L;
    const float *mean;   /* dims */
    const float *basis;  /* dims * rank */
    const float *coef;   /* rank*(2*K+1)*(L+1) */
} R2D4Manifold;
typedef struct {
    uint32_t id, semantic_id, chart_id, owner_group;
    R2D4Rect rect;
    uint32_t first_vertex,vertex_count,first_tri,tri_count;
    uint32_t visibility_fn, depth_fn, topology_gate;
} R2D4Patch;
typedef struct {
    float yaw, pitch;
    float blink_l,blink_r,mouth_open,gaze_x,gaze_y;
    const float *pose; uint32_t pose_count;
} R2D4Input;
typedef enum {
    R2D4_OK=0, R2D4_OUT_OF_DOMAIN, R2D4_BAD_ASSET,
    R2D4_INVALID_INPUT, R2D4_CONSTRAINT_FAILED
} R2D4Status;
typedef struct R2D4Asset R2D4Asset;
typedef struct R2D4Scratch R2D4Scratch;
typedef struct R2D4DrawList R2D4DrawList;
R2D4Status r2d4_load(const void *bytes,uint64_t size,R2D4Asset **out);
R2D4Status r2d4_evaluate(const R2D4Asset*,const R2D4Input*,
                        R2D4Scratch*,R2D4DrawList*);
void r2d4_destroy(R2D4Asset*);
```

Не сериализовать C pointers/padding/ABI layouts напрямую. Scratch preallocated после load, evaluate без heap allocation; immutable asset допускает несколько потоков с отдельным scratch. Public API интегрировать в существующие C и `$` conventions движка после аудита; UI инструмента — существующий RmlUi. Не создавать параллельный private engine API без необходимости.

## 15. Runtime pipeline и псевдокод

```text
load(): validate container, hashes, finite arrays, IDs, UV, graph
        decode atlas once; linearize/premultiply; allocate scratch

evaluate(input):
  reject NaN/Inf and unsupported pitch/state
  theta = normYaw(input.yaw); u = normalizePitch(input.pitch)
  F = Fourier(theta,K); T = Chebyshev(u,L)
  a = contract(coeff,F,T,state)
  q = mean + basis*a
  q = projectSemanticConstraints(q, fixed_iteration_policy)
  charts = evaluateTopologyGates(theta,u,state)
  for patch in charts:
    v = sigmoid(evalVisibilityLogit(F,T,state))*patch.gate
    if v < cullThreshold: continue
    V = gatherCage(q,patch)
    rejectVisibleFoldovers(V)
    P = barycentricDeform(V,patch.bindings)
    weights = stableAppearanceWeights(theta,u,patch.anchors)
    depth = evalDepth(F,T,state)
    emit(P, immutableUV, weights, v, masks, depth, semanticID)
  verifyOcclusionRelations(); stableSortDrawGroups()
  rasterizeInverseMappedTrianglesLinearPremultiplied()
  compositeWithOwnerGroupCoverageRules()
  encodeSRGB(output)
```

Default cullThreshold=1/1024 только при измеренном output error; переход должен быть ниже visual tolerance. Детерминированный CPU reference rasterizer обязателен, GPU backend сравнивается с допуском. Bitwise identical гарантировать только на фиксированной сборке/платформе; transcendental math и GPU sampling межплатформенно сравнивать численно. Record θ/φ/s, asset hash, backend, build ID, provenance summary.

## 16. Baker algorithm

```text
1. Parse authoring manifest; reject missing required assets/metadata.
2. Check anchor domain, labels, cell bounds, alpha, shared IDs, topology.
3. Build chart correspondences, shared attachments and barycentric bindings.
4. Normalize H/root; gather masked geometry samples.
5. Weighted PCA/SVD per compatible chart/global geometry group.
6. Fit Fourier × pitch tensor coefficients with QR/SVD regularization.
7. Fit visibility, depth and appearance gates against annotated rules.
8. Sample dense domain; optimize normalized energy with fixed seed.
9. Detect flips, ghost features, occlusion cycles and transitions.
10. Add diagnostics identifying failing angles/patches; request new authoring
    data when coverage is insufficient. Do not invent missing pixels.
11. Pack atlas with deterministic rects/padding; write arrays/manifest/hashes.
12. Run independent random-angle and trajectory tests against CPU renderer.
13. Publish container atomically only if hard acceptance gates pass.
```

Fit data и test data раздельны. Iterative solver стартует с closed-form fit; checkpoint losses, solver settings, seeds и changes. Autodiff MAY в offline Baker, runtime не зависит от training framework. Если Jacobians сложны, MVP использует analytic fit и constraints без end-to-end image optimization; это явно отражается в report.

## 17. Acceptance tests: доказательство вычисления

MUST запрет image generation после фиксации source atlas. Итоговый кадр = реальные atlas texels, filtering, warp, masks, group blending и over. Каждый непустой output sample объясняется цепочкой patch→triangle→UV→atlas samples→weights; save debug provenance для выбранных pixels. Генеративный authoring до bake допустим; генеративный final-angle render запрещён.

Suite:
- Fixed non-anchor yaw: 33.7°,58.2°,103.4°,177.1°,238.6°,319.3°,37.5°; pitch −17.3°,0°,12.7° в сочетаниях. Если угол совпал с новым anchor — заменить и записать причину.
- 256 reproducible random pairs в domain, seed 0x52424434; circular distance от любого training yaw >0.5° для yaw holdout; pitch не равен training rows. Сохранить сгенерированный список, не только seed. Independent second seed после freeze.
- 720 шагов полного yaw loop для pitch −30,−15,0,15,30°; оба направления, одинаковый результат в совпадающих входах.
- Seam θ=−ε,0,+ε,2π−ε,2π,2π+ε с ε=1e−4 radians; image jump и derivative continuity.
- Pitch sweeps и trajectories с одновременным yaw/pitch/state; blink/gaze/mouth отдельно и вместе.
- Anchor reconstruction + withheld view comparison. Reference holdouts не используются в fit. Without references можно доказать pipeline, но нельзя объективно подтвердить identity quality одним loss.
- Adversarial loader: truncated sections, indices out of range, huge counts, NaN, UV overflow, cyclic masks.
- Source mutation: смена палитры одного patch меняет только ожидаемые pixels; полное зануление atlas делает результат прозрачным. Geometry freeze отключает движение cage; appearance freeze сохраняет textures, но не angles.
- Runtime package audit: нет полнофигурных snapshots, branch по exact test angle, удалённого inference, ready-frame cache. Cache basis/coefficients допустим; cache заранее отрендеренных углов запрещён для proof suite.

Hard gates: zero visible inverted/degenerate triangles; zero missing IDs/NaN; no forbidden occlusion leaks >1/255 alpha; attachments ≤0.003H; landmark RMS≤0.005H и max≤0.015H на labelled holdouts; silhouette IoU≥0.95 на neutral labelled holdouts; loop pixel MAE≤1/255 и landmarks≤1e−5H для identical angle; CPU/GPU mean abs error≤2/255, max≤8/255 кроме документированных subpixel edges. Image thresholds измерять на premultiplied RGBA [0,1], canvas и background фиксированы.

Temporal spike: на регулярном sweep соседний image difference D_t не превышает 3×local median(D) +0.01 без авторски размеченного объяснения; это детектор, не универсальное доказательство качества. Переходы дополнительно смотреть в animation/contact sheet. Семантический review MUST: одно лицо, максимум два глаза, один нос/рот, нет двойной линии, силуэт узнаваем, back не содержит front face, профиль не превращается в кашу. Screenshot красивого anchor не подтверждает случайные углы.

Performance: target, не гарантия — 512×512, ≤10k triangles, ≤128 active patches, CPU evaluate ≤1 ms p95, GPU render ≤2 ms p95 на объявленной машине. Измерять после warm-up 200 кадров, минимум 2000 frames; report CPU/GPU/OS/backend/build, отдельно evaluation/raster, memory и draw calls. Не подменять runtime benchmark offline bake временем.

## 18. Численные defaults

| Параметр | Начальное значение |
|---|---:|
| H | 1 |
| Runtime output | 512×512 |
| Authoring source detail | 1024 px высота персонажа |
| Yaw K / pitch L | 3 / 2 |
| PCA retained variance | 0.995 |
| Rank | 8..16, ≤J−1 |
| Pitch MVP | ±30° |
| Geometry anchors | 12×3=36 |
| Appearance κ / pitch bandwidth | 12 / 0.5 |
| Topology transition width | 15°, начать до деградации сетки |
| Min visible area ratio | 0.05 |
| Atlas padding | 4 texel без mipmaps |
| Float format | IEEE754 float32 runtime, float64 bake solves |
| Constraint tolerance | 1e−5H |
| Random holdouts | 256 + independent second seed |

Все defaults записываются в manifest. Авторские параметры могут отличаться с justification и повторным acceptance; «оптимально» без измерения писать запрещено.

## 19. MVP и критерии завершения

A. CPU proof: head-only, yaw full loop, pitch=0; separable face/eyes/nose/mouth/hair; 12 geometry keys, K=3,L=0; provenance и непредставленные углы. Успех: нет flips/ghosts, profile и back правильны. Не выдавать head-only за full-body v4.

B. Pitch/head: 36 keys, tensor L=2, authored profile charts, visibility/masks, heldout pitch. Успех: все hard gates и visual review.

C. Full body neutral: одежда/руки/ноги/attachment graph, atlas packing, .r2d4, GPU comparison. Только после этого заявлять непрерывного персонажа в MVP домене.

D. State: blink, mouth, gaze, 2 expressions, ограниченная pose; tests combinations. Затем tooling/Baker optimization и дополнительные pitch domains.

Coding-agent MUST сначала аудит существующего renderer/API и доступных assets; MUST реализовать CPU эталон и доказательный тест раньше «красивого демо»; MUST сохранять неуспех как failure report с углами. Не создавать fake success output при отсутствии данных. Сгенерированный spritesheet не является выполненной стадией A.

## 20. Комплект для агента и спрайтшит

Рядом: `SPRITESHEET_PROMPT.md` — сохранённый prompt и правила приёмки; `assets/` — generated candidate. Сейчас спецификация предшествует изображению. Будущий compiled asset требует ручного/кодового semantic segmentation, точных metadata и authoring correspondences; генератор картинок не создаёт автоматически достоверный .r2d4.

Для стартового head-only ассета запрашивается отдельный RGBA component sheet: 4 колонки ×4 ряда одинаковых клеток. Содержимое и направление каждого компонента фиксированы в промпте. Это **appearance source**, а не набор полнофигурных ready views. Позже geometry anchors создаются согласованным авторингом; не выдавать component sheet за 36 geometry anchors.

Промпт генератора должен сохранять character identity во всех частях, содержать front/left/right профильные варианты, back hair, закрытые веки и mouth interior, исключать фон, надписи и ready assembled frames. После генерации сохранить реальный PNG, проверить alpha/границы и состав; координаты rect получают из фактического PNG. Не придумывать метаданные по предполагаемым размерам или текстовым обещаниям генератора.
