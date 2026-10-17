// ===========================================================================
// VN Narrative — экран SDK для сюжетных данных.
//
// Полноценный narrative-инспектор живёт в runtime DevTools (`$.devtools.narrative()`):
// он видит активную сцену, реплики, тему и флаги. Этот экран — точка входа SDK
// для валидации проекта: native Code Check запускает doctor/lint/validate, а
// story/dialog-файлы проверяются командами `r2d-sdk story validate` и
// `r2d-sdk dialog validate` (единый backend, без второго валидатора).
//
// Пока панель использует тот же native-backed экран, что Code Check; отдельный
// RML narrative-редактор — следующий слой, не дублирующий runtime-инспектор.
// ===========================================================================
export { open, standalone } from './code-check.js';
