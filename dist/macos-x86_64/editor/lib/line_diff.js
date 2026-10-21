// Построчный diff «сохранённый текст → буфер» для маркеров изменений в gutter.
// Общие начало и конец отбрасываются; середина сравнивается через LCS (с лимитом
// размера — на огромных правках все новые строки считаются изменёнными).
const LCS_LIMIT = 2500000;

// Возвращает { marks: Map(строка → 'add'|'mod'), deleted: Set(строка, перед которой удалено) }.
export function lineDiff(oldLines, newLines) {
    const marks = new Map(), deleted = new Set();
    let head = 0;
    const maxHead = Math.min(oldLines.length, newLines.length);
    while (head < maxHead && oldLines[head] === newLines[head]) head++;
    let tail = 0;
    while (tail < maxHead - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
    const a = oldLines.slice(head, oldLines.length - tail), b = newLines.slice(head, newLines.length - tail);
    if (!a.length && !b.length) return { marks, deleted };
    const hunk = (delCount, addStart, addCount) => {
        if (!addCount) { deleted.add(Math.min(addStart, newLines.length - 1)); return; }
        for (let k = 0; k < addCount; k++) marks.set(addStart + k, delCount && k < delCount ? 'mod' : 'add');
    };
    if (!a.length || !b.length || a.length * b.length > LCS_LIMIT) {
        hunk(a.length, head, b.length);
        return { marks, deleted };
    }
    const w = b.length + 1;
    const table = new Uint16Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1
                : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
        }
    }
    let i = 0, j = 0, delCount = 0, addStart = -1, addCount = 0;
    const flush = () => { if (delCount || addCount) hunk(delCount, addStart < 0 ? head + j : addStart, addCount); delCount = 0; addStart = -1; addCount = 0; };
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; continue; }
        if (j < b.length && (i >= a.length || table[i * w + j + 1] >= table[(i + 1) * w + j])) {
            if (addStart < 0) addStart = head + j;
            addCount++; j++;
        } else { delCount++; i++; }
    }
    flush();
    return { marks, deleted };
}
