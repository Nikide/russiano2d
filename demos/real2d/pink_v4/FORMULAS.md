# Real2D v4 — формулы непрерывной художественной 2D-модели

Нормативное дополнение к REAL2D_V4_SPEC.md. Формулы ниже исполняет код; иллюстрации служат исходным artwork/target. Никаких 3D/VRM, ready-frame lookup или image generation на этапе итогового кадра.

## 1. Домен и идеальный объект

θ∈S¹, φ∈[−π/6,π/6] для MVP, s∈S (ограниченные authored states). φ>0: камера выше персонажа, вид сверху. R*(θ,φ,s) — заданное художником RGBA-изображение. R — конечное приближение, не универсальный «всегда красиво» оператор.

Параметризация view:

v=(cosθ,sinθ,u), u=φ/φ_max;
Δθ=atan2(sin(θ−θ_j),cos(θ−θ_j));
wrap(θ)=θ−2π floor(θ/2π).

Использовать v/периодическую базу, не линейный θ через шов.

## 2. Геометрия, линии и цвет

Авторская модель разделяется на G (2D геометрия), L (линии), C (цвет/appearance), V (видимость), O (окклюзия):

R(θ,φ,s)=Encode_sRGB(OverOrdered_i [GroupCompose_i(Warp(C_i,L_i,G_i), V_i,O_i)]).

OverOrdered — оператор alpha-композиции, НЕ обычная сумма картинок. Barycentric rasterizer ниже работает с фиксированным 2D artwork, а векторные контуры MAY растеризоваться детерминированно из authored curves. Эти два backend не смешивать без явно определённых правил.

## 3. Global low-rank manifold

Вектор q объединяет координаты всех согласованных cage/landmarks/Bézier controls. Центрирование anchors Q_c=Q−1μᵀ. SVD Q_c=UΣVᵀ; B=V[:,0:r].

q(θ,u,s)=μ+B a(θ,u,s)+δ_sem(θ,u,s).

Mean и basis общие для согласованных деталей, поэтому глаза/волосы/тело не дрейфуют независимо. Разная топология → разные charts и visibility handoff. Missing landmarks → masked fit, не zero-fill.

## 4. Fourier × polynomial tensor

F=[1,cosθ,sinθ,...,cosKθ,sinKθ]. T0=1,T1=u,T_(l+1)=2uT_l−T_(l−1).

a_n=Σ_kΣ_l c_nkl F_k(θ)T_l(u)+Σ_m s_m Σ_kΣ_l e_nmkl F_k(θ)T_l(u).

Периодичность значения и yaw derivative встроена в Fourier. Defaults K=3,L=2; 12 yaw samples ×3 pitch slices; rank 8..16 с ограничением sample rank. Коэффициенты fit через QR/SVD с frequency regularization, не угадываются по картинке.

## 5. Контуры глаз/лица/прядей

Кубический Bézier segment:

b(t)=(1−t)^3p0+3(1−t)^2t p1+3(1−t)t²p2+t³p3, t∈[0,1].

Каждая контрольная точка p_a является подмножеством q и зависит от view/state. Closed contour: end последнего segment=start первого. C¹ seam: p3−p2 соседнего segment согласовать с p1−p0 следующего (с учётом параметризации).

Eye upper/lower curves делят corners; iris/pupil clipped внутри eyelid mask. Blink деформирует upper/lower к общей closure curve, не просто alpha исчезновение всего глаза. Для semantic variant с другой линией использовать chart gate; не интерполировать два несопоставленных bitmap контура напрямую.

Прядь hair: centerline h(t) из Bézier; width w(t)>0 authored; left/right contour h(t)±w(t)n(t)/2, n — нормаль к h′ в 2D. h′≈0 требует устойчивой соседней tangent или bake error. Корень attachment к scalp, кончик MAY иметь state offset. Pseudo-depth — отдельная функция, не z-координата пряди.

## 6. Sparse appearance anchors

ℓ_j=κ_j(cosΔθ−1)−(u−u_j)²/(2h_j²)+logρ_j;
w_j=exp(ℓ_j−maxℓ)/Σ_m exp(ℓ_m−maxℓ).

В совместимой общей UV chart T(uv)=Σ_j w_j T_j(uv), premultiplied linear RGBA. Warp/registration должен предшествовать смешению; 30° и 60° глаза на разных позициях нельзя просто crossfade в screen-space.

Softmax weights не cardinal и не гарантируют exact anchor interpolation. Exact constraints обеспечивать constrained fit либо cardinal periodic RBF с conditioning check. Geometry anchors могут быть плотнее appearance anchors; не делать 12 полных текстур персонажа скрытым runtime cache.

## 7. Visibility и topology

v_i=σ(f_i(F,T,s)); gate_i∈[0,1]; α_i(x)=v_i gate_i A_i(x)O_i(x).

S(t)=3t²−2t³; chart handoff g_A=1−S(t),g_B=S(t). Нормализовать coverage внутри semantic owner group; over двух alpha 0.5 даёт alpha 0.75 и не является правильной partition-of-unity сборкой.

Eye far width не проходит через отрицательное значение. Новая profile topology активируется до cage collapse, старый вариант скрывается. Back-facing face features закрыты hair/head masks. Hair clip остаётся той же анатомической стороны. Дискретный order switch допускается только при нулевом видимом overlap или spatial-mask handoff.

## 8. Warp

p0=Σ_a λ_a V0_ta; p(θ,u,s)=Σ_a λ_a V_ta(θ,u,s), Σλ=1.

Для output sample x внутри deformed triangle: β=barycentric(x,P_t); uv=Σ β_a uv_a; sample atlas bilinear. Shared vertices/top-left raster rule обязательны.

A=0.5 cross(v1−v0,v2−v0); sign(A)=sign(A0); A/A0≥0.05 для видимого triangle. Все координаты здесь 2D; никакого perspective divide.

## 9. Alpha и pseudo-depth

d_i=Σ c_ikl F_k T_l; order ascending d с fixed ID tie-break.

Premultiplied over: C_out=C_front+(1−α_front)C_back; α_out=α_front+(1−α_front)α_back.

Не применять alpha повторно к premultiplied C. PNG storage straight RGBA → decode sRGB → linearize → premultiply → blend → encode. Occlusion masks и patch splitting нужны для частичных перекрытий, один z-order не покрывает все случаи.

## 10. Attachments и rifle pose

Для joint link a↔b: E_attach=||p_a−p_b||²/H². Shoulder/elbow/wrist/hip/knee/ankle общие landmarks. Оружие — 2D patch chart с authored stock/grip/support/muzzle landmarks. Hand trigger/support landmarks совпадают с grip/support. Не приклеивать full gun-and-arms screenshot к телу. Neutral pose и low-ready pose имеют разные state data; новая поза не возникает автоматически из neutral.

Rifle appearance должен оставаться одной моделью при повороте; видимость behind/in-front body описать masks. Не использовать физическую 3D projection для его получения.

## 11. Baker energy

E=10E_anchor+0.1E_smooth+10E_loop+100E_fold+5E_silhouette+20E_landmark+E_temporal+10E_occlusion+30E_attach+0.001E_reg.

Terms нормировать по sample count/H. Anchor — geometry+reference composite residual. Smooth — second yaw/pitch/mixed derivatives. Loop — value/first derivative at 0/2π. Fold — max(0,0.05−A/A0)² плюс hard reject. Silhouette — 1−IoU + signed-distance boundary error. Landmark — masked weighted squared error. Temporal — flow-aligned residual только persistent visible regions. Occlusion — leaks/visibility/depth violations. Reg — frequency weighted coeff norm.

Loss decrease не является успехом. Acceptance: random non-anchor angles, pitch holdouts, full-circle trajectories, provenance, semantic review и fold/attachment gates из полной спецификации.

## 12. Чего эти формулы не поставляют сами

Сетки, topology correspondence, UV, корректный исходный рисунок, скрытые части и точные художественные anchors — входные данные. Их нужно разметить и проверить. Генеративная таблица не гарантирует точных yaw, scales или anatomy. Runtime success объявляется только после реального исполнения формул и acceptance suite.
