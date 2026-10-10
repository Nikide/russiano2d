'use strict'

/**
 * Russiano2D docs-gate — политика (данные и чистая логика).
 *
 * Две доктрины, ровно две:
 *
 *   1. **Сначала философия — потом работа.** Агент не пишет в движок, пока не
 *      прочитал целиком `docs/PHILOSOPHY.md` — конституцию движка. Это всё, что
 *      требуется перед первой правкой; остальные доки обязательны по правилам
 *      репозитория, но гейт их не ждёт (в промпте они идут списком ссылок).
 *   2. **ГЛАВНЫЙ ГЕЙТ: движок только 2D.** Превращать Russiano2D в 3D нельзя —
 *      это non-goal из PHILOSOPHY.md §3. Правка, вводящая 3D-сущности (имя пути
 *      или имя архитектуры в коде), отклоняется; RE2D при этом остаётся
 *      разрешённым, потому что это projection в обычный 2D-кадр (PHILOSOPHY §1).
 *
 * Файл намеренно на CommonJS: загрузчик `gate.js` перечитывает его с диска при
 * каждой загрузке композиции (сбрасывая require-кэш), поэтому правки списка
 * документов, шаблонов и текстов подхватываются перезагрузкой бандла без
 * перезапуска приложения.
 *
 * Никаких зависимостей, кроме встроенных модулей Node: плагин ставится в профиль
 * как локальный бандл (`link:`), и резолвить peer-зависимости DSH ему не нужно.
 *
 * @module dsh-russiano2d-docs-gate/policy
 */

const path = require('node:path')

const DEFAULTS = {
  /** Полный выключатель гейта. */
  enabled: true,
  /** На сколько уровней вверх искать корень движка от рабочего каталога сессии. */
  maxRootWalk: 12,
  /** Место секции в системном промпте (до TOOL_BASH = 1000). */
  sectionOrder: 950,
  /** Все файлы должны существовать в каталоге, чтобы он считался корнем движка. */
  rootMarkers: ['docs/PHILOSOPHY.md', 'docs/ARCHITECTURE.md'],
  /**
   * Обязательные документы: ровно один — философия. Прочитал целиком → работай.
   * Остальные доки движка идут списком `references` и не блокируют запись.
   */
  docs: [
    {
      id: 'philosophy',
      path: 'docs/PHILOSOPHY.md',
      title: 'Философия Russiano2D — конституция движка: 2D, константы, non-goals',
    },
  ],
  /** Какая доля строк обязательного документа должна быть прочитана (1 = целиком). */
  minCoverage: 1,
  /** Справочники для промпта: обязательны по правилам репозитория, гейт их не ждёт. */
  references: [
    { path: 'docs/ARCHITECTURE.md', note: 'философия API `$` (jQuery-стиль, селекторы, цепочки)' },
    { path: 'docs/AGENT_IMPLEMENTATION_RULES.md', note: 'правила агентов: рабочий цикл, стоп-условия' },
    { path: 'docs/internal/NATIVE.md', note: 'нативное ядро `engine.*` (внутреннее, для модулей `$`)' },
    { path: 'docs/HIGH_LEVEL_API.md', note: 'высокоуровневое API `$`' },
    { path: 'docs/UI_RMLUI_LAW.md', note: 'закон интерфейса: весь UI — RmlUi (константа 6)' },
    { path: 'docs/highlevel/_CONTRACT.md', note: 'контракт модуля — при правке `src/highlevel/**`' },
    { path: 'docs/highlevel/<имя>.md', note: 'страница модуля — при правке `src/highlevel/<имя>.js`' },
  ],
  /** Инструменты, которые пишут файлы напрямую. */
  writeTools: ['write', 'edit', 'str_replace_editor'],
  /** Инструменты, которые исполняют команду оболочки. */
  shellTools: ['bash', 'pwsh'],
  /** Шаблоны «команда меняет файлы». Порядок важен: первый совпавший id идёт в отказ. */
  shellMutationPatterns: [
    { id: 'redirect', source: '(^|[^0-9&>])>>?(?!&)\\s*(?!/dev/null)\\S' },
    { id: 'tee', source: '(^|[\\s|;&(])tee\\s' },
    { id: 'sed-in-place', source: '(^|[\\s|;&(])sed\\s[^\\n|;&]*-i(\\s|$|\\.)' },
    { id: 'perl-in-place', source: '(^|[\\s|;&(])perl\\s[^\\n|;&]*-i(\\s|$|\\.)' },
    { id: 'patch', source: '(^|[\\s|;&(])(patch|git\\s+apply|git\\s+am)\\s' },
    { id: 'truncate', source: '(^|[\\s|;&(])(truncate|dd)\\s' },
    { id: 'file-ops', source: '(^|[\\s|;&(])(rm|rmdir|mv|cp|mkdir|touch)\\s+-?[^\\s|;&]*' },
    { id: 'link', source: '(^|[\\s|;&(])ln\\s' },
    { id: 'git-restore', source: '(^|[\\s|;&(])git\\s+(restore|checkout)\\s' },
  ],
  /** Максимум строк документа в подсказке «читай сейчас» (не ограничение чтения). */
  hintLimit: 2000,
  /**
   * ГЛАВНЫЙ ГЕЙТ: движок остаётся 2D.
   *
   * Шаблоны откалиброваны по репозиторию: ни один существующий файл движка
   * (`src/`, `game/`, `demos/`, `tests/`) под них не попадает. Зоны, где 3D
   * законен как источник данных (SDK-бейкеры, инструменты, документация,
   * дистрибутивы), перечислены в `allowedPrefixes`.
   */
  law2d: {
    /** Выключатель именно главного гейта (гейт философии остаётся). */
    enabled: true,
    /** Где упоминания 3D законны: SDK-импорт, инструменты, доки, тесты, сборки, дистрибутивы. */
    allowedPrefixes: [
      'docs/',
      'sdk/',
      'tools/',
      'tests/',
      'dist/',
      'dist-ci/',
      'build/',
      'build-web/',
      'build-autobuild/',
      'site/',
    ],
    /** Дополнительные пути-исключения (например, спорный легаси-файл). */
    allowPaths: [],
    /** Расширения, для которых проверяется содержимое правки. */
    scanExtensions: [
      '.c',
      '.h',
      '.cc',
      '.cpp',
      '.hpp',
      '.mjs',
      '.js',
      '.cjs',
      '.py',
      '.glsl',
      '.frag',
      '.vert',
      '.wgsl',
      '.cmake',
      '.json',
      '.yml',
      '.yaml',
      '.txt',
    ],
    /** Имена файлов и каталогов, которых у 2D-движка быть не должно. */
    pathPatterns: [
      {
        id: 'path-3d',
        source: '(^|[/_.-])(3d|[A-Za-z0-9_]*3d)(?![A-Za-z0-9])',
        flags: 'i',
        what: 'имя пути с 3D-сущностью (render3d, mesh3d, r3d, 3d, …)',
      },
    ],
    /**
     * Команды, которые только удаляют. Удаление 3D-файла ведёт движок К 2D,
     * поэтому под гейт не попадает — в отличие от создания и правки.
     */
    removePatterns: [
      { id: 'rm', source: '(^|[\\s|;&(])(rm|rmdir)(\\s|$)' },
      { id: 'git-rm', source: '(^|[\\s|;&(])git\\s+rm(\\s|$)' },
    ],
    /** Признаки, что команда пишет или создаёт: тогда «только удаление» уже неверно. */
    writeGuardPatterns: [
      { id: 'redirect', source: '(^|[^0-9&>])>>?(?!&)\\s*(?!/dev/null)\\S' },
      { id: 'tee', source: '(^|[\\s|;&(])tee\\s' },
      { id: 'sed-in-place', source: '(^|[\\s|;&(])sed\\s[^\\n|;&]*-i(\\s|$|\\.)' },
      { id: 'perl-in-place', source: '(^|[\\s|;&(])perl\\s[^\\n|;&]*-i(\\s|$|\\.)' },
      { id: 'patch', source: '(^|[\\s|;&(])(patch|git\\s+apply|git\\s+am)\\s' },
      { id: 'truncate', source: '(^|[\\s|;&(])(truncate|dd)\\s' },
      { id: 'copy', source: '(^|[\\s|;&(])(cp|mv|mkdir|touch|install|ln)\\s' },
    ],
    /** Имена архитектуры, которых в 2D-движке быть не должно. */
    contentPatterns: [
      {
        id: 'r3d',
        source: '\\b(R3D|r3d)\\b',
        what: 'фреймворк R3D (PHILOSOPHY.md §3: общего R2D/R3D-фреймворка нет)',
      },
      {
        id: 'scene-graph-3d',
        source:
          '\\b(Scene3D|Node3D|Mesh3D|World3D|Transform3D|Quaternion|Matrix4|Vector3|MeshRenderer)\\b',
        what: '3D scene graph / универсальный world mesh API / 3D-математика мира',
      },
      {
        id: 'physics-3d',
        source: '\\b(Physics3D|CharacterBody3D|RigidBody3D|CollisionShape3D)\\b',
        what: '3D-физика в рантайме',
      },
      {
        id: 'camera-3d',
        source: '\\bCamera3D\\b',
        what: '3D-камера как основа мира',
      },
      {
        id: 'assets-3d',
        source: '\\b(tinygltf|cgltf|assimp|glm::)\\b',
        what: '3D-математика/загрузчик 3D-ассетов в рантайме (импорт живёт в SDK)',
      },
      {
        id: 'three',
        source: '\\bthree(\\.min)?\\.js\\b|from\\s+["\']three["\']',
        what: 'второй 3D-движок (three.js) вместо R2D',
      },
    ],
  },
}

/** Привести путь к POSIX-виду без завершающего слэша. */
function toPosix(value) {
  return String(value).replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Нормализовать префикс каталога: ровно один завершающий слэш. */
function toPrefix(value) {
  const normalized = toPosix(value)
  return normalized === '' ? '' : normalized + '/'
}

/** Является ли `target` путём внутри `prefix` (или равным ему). */
function underPrefix(target, prefix) {
  const value = toPosix(target)
  const normalized = toPosix(prefix)
  return value === normalized || value.startsWith(toPrefix(normalized))
}

/** Скопировать настройки, наложив пользовательские значения поверх умолчаний. */
function loadSettings(config) {
  const overrides = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const settings = Object.assign({}, DEFAULTS, overrides)
  settings.rootMarkers = arrayOfStrings(overrides.rootMarkers, DEFAULTS.rootMarkers)
  settings.docs = normalizeDocs(overrides.docs, DEFAULTS.docs)
  settings.references = normalizeRefs(overrides.references, DEFAULTS.references)
  settings.writeTools = arrayOfStrings(overrides.writeTools, DEFAULTS.writeTools)
  settings.shellTools = arrayOfStrings(overrides.shellTools, DEFAULTS.shellTools)
  settings.shellMutationPatterns = compilePatterns(overrides.shellMutationPatterns, DEFAULTS.shellMutationPatterns)
  settings.law2d = loadLaw2d(overrides.law2d)
  if (!Number.isFinite(settings.minCoverage) || settings.minCoverage <= 0) settings.minCoverage = DEFAULTS.minCoverage
  if (settings.minCoverage > 1) settings.minCoverage = 1
  if (!Number.isInteger(settings.maxRootWalk) || settings.maxRootWalk < 0) settings.maxRootWalk = DEFAULTS.maxRootWalk
  return settings
}

/** Настройки главного гейта «только 2D» с нормализованными шаблонами. */
function loadLaw2d(value) {
  const fallback = DEFAULTS.law2d
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const law = Object.assign({}, fallback, source)
  law.enabled = source.enabled === undefined ? fallback.enabled : source.enabled !== false
  law.allowedPrefixes = arrayOfStrings(source.allowedPrefixes, fallback.allowedPrefixes).map(toPosix)
  law.allowPaths = Array.isArray(source.allowPaths)
    ? source.allowPaths.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map(toPosix)
    : fallback.allowPaths.slice()
  law.scanExtensions = arrayOfStrings(source.scanExtensions, fallback.scanExtensions)
  law.pathPatterns = compilePatterns(source.pathPatterns, fallback.pathPatterns)
  law.contentPatterns = compilePatterns(source.contentPatterns, fallback.contentPatterns)
  law.removePatterns = compilePatterns(source.removePatterns, fallback.removePatterns)
  law.writeGuardPatterns = compilePatterns(source.writeGuardPatterns, fallback.writeGuardPatterns)
  return law
}

function arrayOfStrings(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice()
  const filtered = value.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
  return filtered.length > 0 ? filtered : fallback.slice()
}

function normalizeDocs(value, fallback) {
  const list = Array.isArray(value) && value.length > 0 ? value : fallback
  const result = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || entry.path.trim() === '') continue
    const normalized = {
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : toPosix(entry.path),
      path: toPosix(entry.path),
      title: typeof entry.title === 'string' ? entry.title : toPosix(entry.path),
    }
    if (Number.isFinite(entry.minCoverage)) normalized.minCoverage = entry.minCoverage
    result.push(normalized)
  }
  return result.length > 0 ? result : fallback.slice()
}

function normalizeRefs(value, fallback) {
  const list = Array.isArray(value) && value.length > 0 ? value : fallback
  const result = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || entry.path.trim() === '') continue
    result.push({ path: toPosix(entry.path), note: typeof entry.note === 'string' ? entry.note : '' })
  }
  return result.length > 0 ? result : fallback.slice()
}

function compilePatterns(value, fallback) {
  const list = Array.isArray(value) && value.length > 0 ? value : fallback
  const result = []
  for (const entry of list) {
    if (!entry) continue
    const source = typeof entry === 'string' ? entry : entry.source
    if (typeof source !== 'string' || source === '') continue
    const extra = typeof entry.flags === 'string' ? entry.flags.replace(/[^imsuy]/g, '') : ''
    try {
      result.push({
        id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : source,
        what: typeof entry.what === 'string' ? entry.what : '',
        re: new RegExp(source, `m${extra}`),
      })
    } catch {
      /* некорректный пользовательский шаблон не должен ломать плагин */
    }
  }
  return result
}

/**
 * Найти корень движка: ближайший каталог от `cwd` вверх, в котором есть все маркеры.
 *
 * @param cwd абсолютный рабочий каталог сессии
 * @param settings нормализованные настройки
 * @param exists проверка существования файла (для тестов подменяется)
 * @returns абсолютный корень или undefined, если это не репозиторий движка
 */
function findRoot(cwd, settings, exists) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  let dir = path.resolve(cwd)
  for (let step = 0; step <= settings.maxRootWalk; step += 1) {
    let complete = true
    for (const marker of settings.rootMarkers) {
      let found = false
      try {
        found = exists(path.join(dir, marker)) === true
      } catch {
        found = false
      }
      if (!found) {
        complete = false
        break
      }
    }
    if (complete) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Абсолютный путь к документу внутри корня движка. */
function docAbsolute(root, docPath) {
  return path.join(root, docPath)
}

/** Путь относительно корня (POSIX-вид) или undefined, если файл вне корня. */
function relativeTo(root, absolute) {
  const rel = path.relative(root, absolute)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined
  return toPosix(rel)
}

/** Извлечь путь файла из аргументов инструмента записи. */
function filePathOf(args) {
  if (!args || typeof args !== 'object') return undefined
  for (const key of ['file_path', 'path', 'target']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Ключи аргументов, в которых лежит записываемый текст. */
const PAYLOAD_KEYS = ['content', 'new_string', 'new_str', 'newText', 'text', 'body']

/**
 * Текст, который инструмент записи собирается записать: содержимое `write`,
 * новые строки `edit` и т. п. Незнакомый инструмент — склеиваем все строковые
 * аргументы, кроме пути: лучше проверить лишнее, чем пропустить 3D.
 */
function toolText(args, settings) {
  if (!args || typeof args !== 'object') return ''
  const parts = []
  for (const key of PAYLOAD_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') parts.push(value)
  }
  if (parts.length > 0) return parts.join('\n')
  for (const [key, value] of Object.entries(args)) {
    if (key === 'file_path' || key === 'path' || key === 'target') continue
    if (typeof value === 'string' && value !== '') parts.push(value)
  }
  return parts.join('\n')
}

/** Есть ли у пути расширение, содержимое которого мы проверяем. */
function hasScanExtension(value, settings) {
  const lower = String(value).toLowerCase()
  return settings.law2d.scanExtensions.some((extension) => lower.endsWith(String(extension).toLowerCase()))
}

/** Путь-цель освобождён от главного гейта (SDK, инструменты, доки, дистрибутивы)? */
function is3dExempt(relative, settings) {
  const value = toPosix(relative)
  if (value === '') return true
  for (const prefix of settings.law2d.allowedPrefixes) {
    if (underPrefix(value, prefix)) return true
  }
  for (const allowed of settings.law2d.allowPaths) {
    if (allowed !== '' && underPrefix(value, allowed)) return true
  }
  return false
}

/** Найти первый шаблон, по которому команда похожа на изменение файлов. */
function shellMutates(command, patterns) {
  if (typeof command !== 'string' || command.trim() === '') return undefined
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0
    if (pattern.re.test(command)) return pattern.id
  }
  return undefined
}

/** Прошёл ли текст хотя бы один шаблон из списка. */
function matchesAny(text, patterns) {
  if (typeof text !== 'string' || text === '') return false
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0
    if (pattern.re.test(text)) return true
  }
  return false
}

/** Первое совпадение шаблона в тексте: `{ id, what, sample }` или undefined. */
function matchFirst(text, patterns) {
  if (typeof text !== 'string' || text === '') return undefined
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0
    const match = pattern.re.exec(text)
    if (match === null) continue
    const sample = String(match[0]).replace(/\s+/g, ' ').slice(0, 60)
    return { id: pattern.id, what: pattern.what || pattern.id, sample }
  }
  return undefined
}

/**
 * Пути внутри корня, упомянутые в команде оболочки: только те, что похожи на
 * файл с проверяемым расширением (для остальных главный гейт не применяется —
 * решает то же, что и раньше, гейт философии).
 */
function mentionedPaths(command, root, cwd, settings) {
  if (typeof command !== 'string' || command === '') return []
  const base = typeof cwd === 'string' && cwd !== '' ? cwd : root
  const found = new Set()
  for (const token of command.split(/[\s"'`=<>|;&()]+/)) {
    const trimmed = token.replace(/^[^A-Za-z0-9._/~-]+/, '')
    if (trimmed === '' || trimmed.startsWith('-')) continue
    if (!/^[A-Za-z0-9._/~-]*\.[A-Za-z0-9]+$/.test(trimmed)) continue
    if (!hasScanExtension(trimmed, settings)) continue
    const relative = relativeTo(root, path.resolve(base, trimmed))
    if (relative === undefined) continue
    found.add(relative)
  }
  return [...found]
}

/**
 * Список документов, обязательных перед правкой: философия и только она.
 * Остальные доки — справочники (`references`), гейт их не блокирует.
 */
function requiredDocs(settings) {
  return settings.docs.map((doc) => Object.assign({}, doc))
}

/**
 * Команда только удаляет файлы (`rm`/`rmdir`/`git rm`) и ничего не пишет и не
 * создаёт? Тогда главный гейт к ней не применяется: удаление 3D-файла ведёт
 * движок К 2D.
 */
function shellRemoves(command, settings) {
  if (typeof command !== 'string' || command === '') return false
  if (!matchesAny(command, settings.law2d.removePatterns)) return false
  return !matchesAny(command, settings.law2d.writeGuardPatterns)
}

/**
 * ГЛАВНЫЙ ГЕЙТ: найти 3D-сущность в правке.
 *
 * @param context.targets пути-цели относительно корня (для bash — упомянутые файлы)
 * @param context.payload записываемый текст (содержимое write/edit или команда)
 * @param context.removing true — команда только удаляет файлы (гейт пропускает)
 * @returns `{ kind, id, what, sample, target }` или undefined
 */
function findForbidden3d(context) {
  const { targets, payload, settings } = context
  if (settings.law2d.enabled === false) return undefined
  if (context.removing === true) return undefined

  const writable = (targets || []).filter(
    (target) => typeof target === 'string' && target !== '' && !is3dExempt(target, settings),
  )

  for (const target of writable) {
    const hit = matchFirst(target, settings.law2d.pathPatterns)
    if (hit !== undefined) return { kind: 'path', target, ...hit }
  }

  if (typeof payload !== 'string' || payload === '') return undefined
  const codeTargets = writable.filter((target) => hasScanExtension(target, settings))
  if (codeTargets.length === 0) return undefined
  const hit = matchFirst(payload, settings.law2d.contentPatterns)
  if (hit === undefined) return undefined
  return { kind: 'content', target: codeTargets[0], ...hit }
}

/** Слить диапазон строк [start, end] с уже прочитанными диапазонами. */
function mergeRange(ranges, start, end) {
  const from = Math.max(1, Math.min(start, end))
  const to = Math.max(start, end)
  const all = ranges.concat([[from, to]]).sort((left, right) => left[0] - right[0])
  const merged = []
  for (const range of all) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/** Сколько строк покрыто диапазонами. */
function coveredLines(ranges) {
  return ranges.reduce((total, range) => total + Math.max(0, range[1] - range[0] + 1), 0)
}

/** Покрыт ли документ на требуемую долю. */
function isCovered(ranges, totalLines, ratio) {
  if (!Array.isArray(ranges) || ranges.length === 0) return false
  if (!Number.isFinite(totalLines) || totalLines <= 0) return true
  const need = Math.max(1, Math.ceil(totalLines * ratio))
  return ranges.some((range) => range[0] <= 1 && range[1] >= need)
}

/** Прочитать покрытие одного документа из состояния сессии. */
function coverageOf(state, absolutePath) {
  const ranges = state.coverage.get(absolutePath) || []
  return { ranges, total: state.totals.get(absolutePath) || 0, read: coveredLines(ranges) }
}

/** Отметить прочитанный диапазон строк документа. */
function noteRead(state, absolutePath, start, end, totalLines) {
  state.coverage.set(absolutePath, mergeRange(state.coverage.get(absolutePath) || [], start, end))
  if (Number.isFinite(totalLines) && totalLines > 0) state.totals.set(absolutePath, totalLines)
}

/** Новое состояние сессии. */
function createState() {
  return { coverage: new Map(), totals: new Map(), blocked: 0, blocked3d: 0 }
}

/**
 * Оценить гейт документации: какие документы уже прочитаны, какие нет.
 *
 * @returns {{ open: boolean, items: Array<{doc: object, absolute: string, read: number, total: number, done: boolean, ratio: number}> }}
 */
function evaluate(state, root, docs, settings) {
  const items = docs.map((doc) => {
    const absolute = docAbsolute(root, doc.path)
    const coverage = coverageOf(state, absolute)
    const ratio = Number.isFinite(doc.minCoverage) ? doc.minCoverage : settings.minCoverage
    const done = isCovered(coverage.ranges, coverage.total, ratio)
    return { doc, absolute, read: coverage.read, total: coverage.total, ratio, done }
  })
  return { open: items.every((item) => item.done), items }
}

/** Строка чек-листа: `⬜ 1. docs/PHILOSOPHY.md — …`. */
function checklistLine(item, index) {
  const mark = item.done ? '✅' : item.read > 0 ? '🟡' : '⬜'
  const progress = item.done || item.total <= 0
    ? ''
    : ` (${item.read}/${item.total} строк)`
  const full = index === undefined ? '' : `${index + 1}. `
  return `${mark} ${full}${item.doc.path} — ${item.doc.title}${progress}`
}

/** Первый непрочитанный документ — то, что читать сейчас. */
function nextDoc(evaluation) {
  return evaluation.items.find((item) => !item.done) || undefined
}

/** Полная инструкция по чтению для системного промпта и отказов. */
function renderChecklist(evaluation) {
  return evaluation.items.map((item, index) => checklistLine(item, index)).join('\n')
}

/** Подсказка «читай сейчас» с готовым вызовом инструмента. */
function renderNextStep(evaluation, settings) {
  const next = nextDoc(evaluation)
  if (next === undefined) return 'Философия прочитана — можно работать. Главный гейт (только 2D) продолжает действовать.'
  const remaining = next.total > 0 ? next.total - next.read : undefined
  const limit = remaining !== undefined && remaining > 0 ? Math.min(settings.hintLimit, remaining) : settings.hintLimit
  const offset = next.read > 0 ? next.read + 1 : 1
  return [
    `Сейчас читай: read file_path="${next.doc.path}" limit=${limit}${offset > 1 ? ` offset=${offset}` : ''}`,
    'Читать нужно целиком; bash `cat` вместо read не засчитывается.',
  ].join('\n')
}

/** Доктрина главного гейта: движок остаётся 2D. */
function renderLaw2d(settings) {
  if (settings.law2d.enabled === false) return []
  return [
    '### ГЛАВНЫЙ ГЕЙТ: Russiano2D — только 2D',
    '',
    'Russiano2D — 2D-движок. Превращать его в 3D нельзя: это non-goal из',
    '`docs/PHILOSOPHY.md` §3, а не предмет решения внутри задачи.',
    '',
    'Запрещено, в том числе «попутно»:',
    '* 3D scene graph: узлы/трансформы/камеры 3D, универсальный world mesh API;',
    '* 3D-физика (`Physics3D`, `RigidBody3D`, `CharacterBody3D`, `CollisionShape3D`);',
    '* 3D-математика как основа мира (`Vector3`, `Matrix4`, `Quaternion`) и загрузчики',
    '  3D-ассетов в рантайме (`glTF`/`GLB`/`FBX` через `assimp`/`tinygltf`/`cgltf`/`glm`);',
    '* фреймворк `R3D` и общий R2D/R3D-монорепозиторий;',
    '* вторые 3D-движки (three.js и подобные) вместо `$`.',
    '',
    'Разрешено и остаётся 2D: **RE2D — это `spatial description → projection →',
    'ordinary 2D representation`** (`PHILOSOPHY.md` §1): XYZ/поверхности/кости/depth —',
    'промежуточные authoring/runtime-данные синтеза, а результат — обычный 2D-спрайт или',
    'кадр для существующего R2D-батча. `z`-буфер, `depth` и `submitMesh` — про порядок',
    'отрисовки 2D, а не 3D-рендерер. Импорт 3D-моделей живёт только в SDK',
    '(`r2d-sdk bake-re2d*`): рантайм читает готовый PNG/JSON, меш в игру не попадает.',
    '',
    'Правка, вводящая запрещённое, отклоняется стражем (по имени пути или по имени',
    'сущности в коде). Спорную задачу останавливай и выноси владельцу проекта,',
    'а не протаскивай через гейт.',
  ]
}

/** Почему вызов отклонён и что делать дальше (гейт документации). */
function renderDenial(context) {
  const { toolName, target, pattern, evaluation, settings } = context
  const head = target
    ? `Russiano2D: правка «${target}» заблокирована, пока не прочитана философия движка.`
    : `Russiano2D: команда bash изменяет файлы (${pattern}) — это заблокировано, пока не прочитана философия движка.`
  return [
    head,
    '',
    'Сначала философия — потом работа: читается целиком, инструментом read.',
    renderChecklist(evaluation),
    '',
    renderNextStep(evaluation, settings),
    `После этого повтори ровно тот же вызов инструмента ${toolName}.`,
  ].join('\n')
}

/** Почему вызов отклонён главным гейтом и что делать дальше. */
function renderDenial3d(context) {
  const { toolName, target, kind, what, sample, settings } = context
  const found = kind === 'path'
    ? `имя пути «${target}» — ${what}`
    : `текст правки «${sample}» — ${what}`
  const head = target
    ? `Russiano2D: правка «${target}» отклонена главным гейтом — движок только 2D.`
    : 'Russiano2D: команда отклонена главным гейтом — движок только 2D.'
  const lines = [
    head,
    '',
    `Что нашлось: ${found}.`,
    '',
    'Превращать Russiano2D в 3D нельзя (docs/PHILOSOPHY.md §3, «Явные non-goals»):',
    '3D scene graph, универсальный world mesh API, 3D-физика, 3D-камера как основа',
    'gameplay, фреймворк R3D. RE2D — projection в обычный 2D-кадр (PHILOSOPHY.md §1),',
    'он не мост к 3D.',
    '',
    'Если задача на самом деле 2D — переформулируй её без 3D-сущностей и повтори',
    `ровно тот же вызов инструмента ${toolName}.`,
  ]
  if (settings && settings.law2d.enabled !== false) {
    lines.push(
      'Если это ложное срабатывание — остановись и вынеси вопрос владельцу проекта',
      '(или внеси путь в `law2d.allowPaths` в конфиге плагина).',
    )
  }
  return lines.join('\n')
}

/** Раздел системного промпта: доктрина + текущий прогресс сессии. */
function renderPrompt(context) {
  const { evaluation, settings, blocked } = context
  const lines = [
    '## Russiano2D: сначала философия, потом работа',
    '',
    'Это репозиторий 2D-движка Russiano2D (`$`, C + QuickJS). Прежде чем что-либо',
    'здесь писать или менять, прочитай конституцию движка — `docs/PHILOSOPHY.md`',
    '(целиком, инструментом read). Пока она не прочитана, инструменты write/edit и',
    'изменяющие файлы команды bash отклоняются. Это всё, что нужно перед работой.',
    '',
    ...renderLaw2d(settings),
    '',
    '### Гейт документации',
    '',
    'Прочитать нужно целиком инструментом read (не через bash cat):',
    renderChecklist(evaluation),
    '',
    renderNextStep(evaluation, settings),
  ]
  if (evaluation.open) {
    lines.push('', '✅ Философия прочитана — гейт открыт, можно писать код.')
  }
  if (settings.references.length > 0) {
    lines.push(
      '',
      'Дальше — по необходимости (обязательны по правилам репозитория, гейт их не ждёт):',
      ...settings.references.map((ref) => (ref.note === '' ? `- ${ref.path}` : `- ${ref.path} — ${ref.note}`)),
    )
  }
  const blockedCount = Number.isFinite(blocked) ? blocked : 0
  const blocked3dCount = Number.isFinite(context.blocked3d) ? context.blocked3d : 0
  if (evaluation.open && (blockedCount > 0 || blocked3dCount > 0)) {
    lines.push('', `Отклонённых попыток записи в этой сессии: ${blockedCount} (документация), ${blocked3dCount} (главный гейт «только 2D»).`)
  }
  return lines.join('\n')
}

/** Текст статуса гейта (для отладки человеком и для сообщения при отказе). */
function renderStatus(context) {
  const { evaluation, root, settings } = context
  const law = settings && settings.law2d ? settings.law2d : { enabled: true }
  const lines = [
    evaluation.open ? 'Гейт открыт: философия прочитана.' : 'Гейт закрыт: философия прочитана не полностью.',
    `Корень движка: ${root}`,
    law.enabled === false ? 'Главный гейт «только 2D» выключен конфигом.' : 'Главный гейт «только 2D» включён.',
    '',
    renderChecklist(evaluation),
  ]
  return lines.join('\n')
}

module.exports = {
  DEFAULTS,
  loadSettings,
  loadLaw2d,
  findRoot,
  docAbsolute,
  relativeTo,
  filePathOf,
  toolText,
  hasScanExtension,
  is3dExempt,
  shellMutates,
  shellRemoves,
  matchesAny,
  matchFirst,
  mentionedPaths,
  requiredDocs,
  findForbidden3d,
  mergeRange,
  coveredLines,
  isCovered,
  coverageOf,
  noteRead,
  createState,
  evaluate,
  nextDoc,
  renderChecklist,
  renderNextStep,
  renderDenial,
  renderDenial3d,
  renderLaw2d,
  renderPrompt,
  renderStatus,
  underPrefix,
  toPosix,
}
