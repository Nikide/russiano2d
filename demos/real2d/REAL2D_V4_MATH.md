# Real2D v4 — концепция и математическая модель

> Сохранено из сообщения пользователя (R&D specification). Это нормативная
> математика Real2D: `X=μ+Ua`, `Z=μ_Z+U_Z a_Z`, `A_l=σ(f_l)`,
> `C_l=Σ_j w_j C_lj` (веса фон Мизеса), `I=Composite_Z[Warp(C_l,X_l)·A_l]`,
> энергия Baker'а `E=λ_aE_anchor+λ_sE_smooth+λ_lE_loop+λ_fE_fold+λ_mE_landmark+λ_silE_silhouette+λ_vE_visibility+λ_zE_order`.
>
> Ключевые требования, которые исполняет код:
> * §6 цикличность: `R(0)=R(2π)`, `R'(0)=R'(2π)` — обеспечивается базисом Фурье;
> * §7 глобальный view manifold, а не набор независимых морфов;
> * §8–§13 `X(θ)=μ+U[C_0+Σ_k(C_k cos kθ + S_k sin kθ)]`;
> * §15–§16 cage/mesh и барицентрическая деформация;
> * §18–§19 видимость `A_l(θ)=σ(f_l(θ))`;
> * §20–§22 appearance anchors и веса фон Мизеса
>   `w_j(θ)=exp(κ cos(θ−θ_j))/Σ_m exp(κ cos(θ−θ_m))`;
> * §24–§26 псевдоглубина `Z(θ)=μ_Z+U_Z a_Z(θ)` и `z=Σλ_iZ_i`;
> * §30–§31 итоговый кадр `I(θ)=Composite_Z[Warp(C_l,X_l)·A_l]`;
> * §32–§35 pitch и состояния как полином по `q=φ/φ_max`;
> * §36–§45 Baker: anchor/smooth/loop/fold/landmark/silhouette/visibility/order;
> * §52 минимальное число artistic keys (ориентир 8 полных видов);
> * §55–§58 blind-angle test: углы, которых нет среди исходных ключей;
> * §59 запрещено: VRM/GLTF/skinned mesh/billboard/sprite switching/AI;
> * §62 runtime не делает SVD — только baked параметры.

Полный текст документа — в истории сообщений пользователя; здесь зафиксированы
исполняемые требования и то, какая формула где реализована (см.
PINK_PIPELINE.md §2 и кадровые отчёты tools/pink_frame_report.py).
