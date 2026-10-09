'use strict'

/**
 * Russiano2D docs-gate — политика (данные и чистая логика).
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

/** Порядок документов движка: философия → правила агентов → низкий → высокий уровень. */
const DEFAULTS = {
  /** Полный выключатель гейта. */
  enabled: true,
  /** На сколько уровней вверх искать корень движка от рабочего каталога сессии. */
  maxRootWalk: 12,
  /** Место секции в системном промпте (до TOOL_BASH = 1000). */
  sectionOrder: 950,
  /** Все файлы должны существовать в каталоге, чтобы он считался корнем движка. */
  rootMarkers: ['docs/ARCHITECTURE.md', 'docs/internal/NATIVE.md', 'docs/HIGH_LEVEL_API.md'],
  /** Обязательные документы в обязательном порядке. */
  docs: [
    { id: 'philosophy', path: 'docs/ARCHITECTURE.md', title: 'Архитектура и философия API `$`' },
    {
      id: 'agent-rules',
      path: 'docs/AGENT_IMPLEMENTATION_RULES.md',
      title: 'Правила для кодинг-агентов',
    },
    { id: 'lowlevel', path: 'docs/internal/NATIVE.md', title: 'Нативное ядро `engine.*` (внутреннее, для модулей `$`)' },
    { id: 'highlevel', path: 'docs/HIGH_LEVEL_API.md', title: 'Высокоуровневое API `$`' },
  ],
  /** Какая доля строк документа должна быть прочитана (1 = файл целиком). */
  minCoverage: 1,
  /** Условные документы: нужны только при правке указанного префикса пути. */
  conditionalDocs: [
    {
      id: 'contract',
      path: 'docs/highlevel/_CONTRACT.md',
      title: 'Контракт модуля подсистемы `$`',
      whenPrefix: 'src/highlevel/',
    },
  ],
  /** Документ подсистемы: `src/highlevel/<имя>.js` требует `docs/highlevel/<имя>.md`. */
  moduleDocs: {
    enabled: true,
    sourceDir: 'src/highlevel',
    docsDir: 'docs/highlevel',
    extension: '.js',
    docExtension: '.md',
  },
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
}

/** Служебные символы регулярных выражений в путях, которые нельзя экранировать лениво. */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  settings.conditionalDocs = normalizeDocs(overrides.conditionalDocs, DEFAULTS.conditionalDocs)
  settings.writeTools = arrayOfStrings(overrides.writeTools, DEFAULTS.writeTools)
  settings.shellTools = arrayOfStrings(overrides.shellTools, DEFAULTS.shellTools)
  settings.moduleDocs = Object.assign({}, DEFAULTS.moduleDocs, overrides.moduleDocs)
  settings.shellMutationPatterns = compilePatterns(overrides.shellMutationPatterns, DEFAULTS.shellMutationPatterns)
  if (!Number.isFinite(settings.minCoverage) || settings.minCoverage <= 0) settings.minCoverage = DEFAULTS.minCoverage
  if (settings.minCoverage > 1) settings.minCoverage = 1
  if (!Number.isInteger(settings.maxRootWalk) || settings.maxRootWalk < 0) settings.maxRootWalk = DEFAULTS.maxRootWalk
  return settings
}

function arrayOfStrings(value, fallback) {
  if (!Array.isArray(value) || value.length === 0) return fallback.slice()
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
    if (typeof entry.whenPrefix === 'string' && entry.whenPrefix !== '') normalized.whenPrefix = toPosix(entry.whenPrefix)
    if (Number.isFinite(entry.minCoverage)) normalized.minCoverage = entry.minCoverage
    result.push(normalized)
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
    try {
      result.push({
        id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : source,
        re: new RegExp(source, 'm'),
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

/** Найти первый шаблон, по которому команда похожа на изменение файлов. */
function shellMutates(command, patterns) {
  if (typeof command !== 'string' || command.trim() === '') return undefined
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0
    if (pattern.re.test(command)) return pattern.id
  }
  return undefined
}

/** Пути `src/highlevel/<имя>.js`, упомянутые в тексте команды. */
function moduleTargetsInCommand(command, settings) {
  if (typeof command !== 'string' || command === '') return []
  const dir = toPosix(settings.moduleDocs.sourceDir)
  const extension = settings.moduleDocs.extension
  const re = new RegExp(`${escapeRegExp(dir)}/([A-Za-z0-9_.-]+)${escapeRegExp(extension)}\\b`, 'g')
  const found = new Set()
  let match
  while ((match = re.exec(command)) !== null) found.add(`${dir}/${match[1]}${extension}`)
  return [...found]
}

/**
 * Список документов, обязательных перед правкой конкретной цели.
 *
 * @param root корень движка
 * @param targetRelative путь цели относительно корня (может быть undefined для bash)
 * @param mentionedTargets дополнительные цели, найденные в тексте команды
 * @param settings настройки
 * @param exists проверка существования файла
 */
function requiredDocs(root, targetRelative, mentionedTargets, settings, exists) {
  const required = []
  const seen = new Set()
  const push = (doc) => {
    if (seen.has(doc.path)) return
    seen.add(doc.path)
    required.push(doc)
  }
  for (const doc of settings.docs) push(Object.assign({}, doc))
  const targets = []
  if (typeof targetRelative === 'string' && targetRelative !== '') targets.push(targetRelative)
  for (const extra of mentionedTargets || []) targets.push(extra)
  for (const target of targets) {
    for (const doc of settings.conditionalDocs) {
      if (doc.whenPrefix === undefined || underPrefix(target, doc.whenPrefix)) push(Object.assign({}, doc))
    }
    if (settings.moduleDocs.enabled === false) continue
    const sourceDir = toPosix(settings.moduleDocs.sourceDir)
    const extension = settings.moduleDocs.extension
    if (!underPrefix(target, sourceDir) || !target.endsWith(extension)) continue
    const base = target.slice(sourceDir.length + 1, target.length - extension.length)
    const docPath = `${toPosix(settings.moduleDocs.docsDir)}/${base}${settings.moduleDocs.docExtension}`
    let present = false
    try {
      present = exists(docAbsolute(root, docPath)) === true
    } catch {
      present = false
    }
    if (!present) continue
    push({ id: `module:${base}`, path: docPath, title: `Подсистема \`${base}\` в высокоуровневом API` })
  }
  return required
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
  return { coverage: new Map(), totals: new Map(), blocked: 0, prompted: 0 }
}

/**
 * Оценить гейт: какие документы уже прочитаны, какие нет.
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

/** Строка чек-листа: `✅ 1. docs/internal/NATIVE.md — …`. */
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
  if (next === undefined) return 'Все обязательные документы прочитаны.'
  const remaining = next.total > 0 ? next.total - next.read : undefined
  const limit = remaining !== undefined && remaining > 0 ? Math.min(settings.hintLimit, remaining) : settings.hintLimit
  const offset = next.read > 0 ? next.read + 1 : 1
  return [
    `Сейчас читай: read file_path="${next.doc.path}" limit=${limit}${offset > 1 ? ` offset=${offset}` : ''}`,
    'Читать нужно целиком и по порядку; bash `cat` вместо read не засчитывается.',
  ].join('\n')
}

/** Почему вызов отклонён и что делать дальше. */
function renderDenial(context) {
  const { toolName, target, pattern, evaluation, settings } = context
  const head = target
    ? `Russiano2D: правка «${target}» заблокирована, пока не прочитана документация движка.`
    : `Russiano2D: команда bash изменяет файлы (${pattern}) — это заблокировано, пока не прочитана документация движка.`
  return [
    head,
    '',
    'Обязательный порядок (сначала философия, потом низкоуровневые доки, потом высокоуровневые):',
    renderChecklist(evaluation),
    '',
    renderNextStep(evaluation, settings),
    `После этого повтори ровно тот же вызов инструмента ${toolName}.`,
  ].join('\n')
}

/** Раздел системного промпта: доктрина + текущий прогресс сессии. */
function renderPrompt(context) {
  const { evaluation, settings } = context
  const lines = [
    '## Russiano2D: обязательный порядок работы с движком',
    '',
    'Это репозиторий 2D-движка Russiano2D (`$`, C + QuickJS). Прежде чем что-либо',
    'здесь писать или менять, нужно знать движок: философия → правила агентов →',
    'низкоуровневые доки → высокоуровневые доки. Пока документация не прочитана,',
    'инструменты write/edit и изменяющие файлы команды bash отклоняются.',
    '',
    'Правило интерфейса (docs/ARCHITECTURE.md §1, docs/HIGH_LEVEL_API.md §1):',
    'весь UI движка строится только на RmlUi — документы `.rml` + `.rcss` через',
    '`$.ui.doc(...)`. Узлы `<ui.*>` — быстрый рисователь HUD в координатах окна,',
    'а не интерфейсный слой: новые меню, экраны и диалоги на них не строятся.',
    '',
    'Прочитать нужно целиком инструментом read (не через bash cat), в этом порядке:',
    renderChecklist(evaluation),
    '',
    renderNextStep(evaluation, settings),
  ]
  if (evaluation.open) {
    lines.push('', '✅ Документация прочитана — гейт открыт, можно писать код.')
  }
  const conditional = settings.conditionalDocs.filter((doc) => doc.path !== undefined)
  if (conditional.length > 0) {
    lines.push(
      '',
      'Дополнительно, только при правке соответствующих путей:',
      ...conditional.map((doc) => `- ${doc.path} — при правке ${doc.whenPrefix}/**`),
    )
  }
  if (settings.moduleDocs.enabled !== false) {
    lines.push(`- ${settings.moduleDocs.docsDir}/<имя>.md — при правке ${settings.moduleDocs.sourceDir}/<имя>${settings.moduleDocs.extension}`)
  }
  return lines.join('\n')
}

/** Текст статуса гейта (для отладки человеком и для сообщения при отказе). */
function renderStatus(context) {
  const { evaluation, root } = context
  return [
    evaluation.open ? 'Гейт открыт: документация движка прочитана.' : 'Гейт закрыт: документация движка прочитана не полностью.',
    `Корень движка: ${root}`,
    '',
    renderChecklist(evaluation),
  ].join('\n')
}

/** Найти в команде упоминания каталога подсистем, чтобы потребовать их доки. */
function mentionedTargets(command, settings) {
  const targets = moduleTargetsInCommand(command, settings)
  const dir = toPosix(settings.conditionalDocs[0] && settings.conditionalDocs[0].whenPrefix ? settings.conditionalDocs[0].whenPrefix : '')
  if (dir !== '' && typeof command === 'string' && command.includes(toPosix(dir))) {
    targets.push(`${toPosix(dir)}/`)
  }
  return targets
}

module.exports = {
  DEFAULTS,
  loadSettings,
  findRoot,
  docAbsolute,
  relativeTo,
  filePathOf,
  shellMutates,
  moduleTargetsInCommand,
  mentionedTargets,
  requiredDocs,
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
  renderPrompt,
  renderStatus,
  underPrefix,
  toPosix,
}
