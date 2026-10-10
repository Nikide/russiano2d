/**
 * Russiano2D docs-gate — плагин DeepSeek Harness.
 *
 * Две доктрины движка, ровно две:
 *
 *   1. **Сначала философия — потом работа.** Агент не пишет в движок, пока не
 *      прочитал целиком `docs/PHILOSOPHY.md` — конституцию движка. Это всё, что
 *      требуется перед первой правкой; остальные доки репозитория идут списком
 *      ссылок в промпте и запись не блокируют.
 *   2. **ГЛАВНЫЙ ГЕЙТ: движок только 2D.** Превращать Russiano2D в 3D нельзя
 *      (`PHILOSOPHY.md` §3). Правка, вводящая 3D-сущность — по имени пути или по
 *      имени архитектуры в коде, — отклоняется. RE2D разрешён: это projection в
 *      обычный 2D-кадр (`PHILOSOPHY.md` §1).
 *
 * Плагин делает три вещи:
 *   1. добавляет в системный промпт агента доктрину и текущий прогресс чтения
 *      именно этой сессии;
 *   2. следит за результатами инструмента `read` и считает документ прочитанным
 *      только тогда, когда покрыты его строки (частичное чтение не считается);
 *   3. отклоняет `write`/`edit` и изменяющие файлы команды `bash`/`pwsh`, пока
 *      философия не прочитана, и любую правку, вводящую 3D, — через
 *      `ctx.tools.guard`, то есть для всех агентов профиля, включая сабагентов,
 *      тимейтов и детей workflow.
 *
 * Гейт включается только в рабочем каталоге, который действительно является
 * репозиторием Russiano2D (по умолчанию — есть `docs/PHILOSOPHY.md` и
 * `docs/ARCHITECTURE.md`). В любом другом каталоге плагин молчит и ничего не
 * блокирует.
 *
 * Этот файл — стабильный загрузчик: политика (список документов, шаблоны команд,
 * правила «только 2D», тексты) живёт в `policy.cjs` и перечитывается с диска при
 * каждой загрузке композиции. Меняешь политику — переключаешь бандл в Plugins.
 *
 * @module dsh-russiano2d-docs-gate
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Имя плагина для журнала Cordis. */
export const name = 'russiano2d-docs-gate'

/** Инструменты нужны для стража; без них плагину нечего делать. */
export const inject = ['tools']

const require_ = createRequire(import.meta.url)

/**
 * Прочитать политику с диска, сбросив require-кэш: правки `policy.cjs`
 * подхватываются перезагрузкой композиции без перезапуска приложения.
 */
function loadPolicy() {
  const file = require_.resolve('./policy.cjs')
  delete require_.cache[file]
  return require_(file)
}

/** Координаты прочитанного диапазона строк, извлечённые из результата `read`. */
function readCoverage(result) {
  if (!result || typeof result !== 'object') return undefined
  for (const candidate of [result.value, result.meta]) {
    if (!candidate || typeof candidate !== 'object') continue
    const total = Number(candidate.totalLines)
    if (!Number.isFinite(total)) continue
    const lines = Array.isArray(candidate.lines) ? candidate.lines : []
    const numbers = []
    for (const line of lines) {
      const number = line && typeof line === 'object' ? Number(line.number) : NaN
      if (Number.isFinite(number)) numbers.push(number)
    }
    const fallback = Number(candidate.offset)
    const start = numbers.length > 0 ? Math.min(...numbers) : Number.isFinite(fallback) ? fallback : 1
    const end = numbers.length > 0 ? Math.max(...numbers) : start
    if (end < start) return undefined
    return { start, end, total }
  }
  return undefined
}

/**
 * Зарегистрировать гейт в контексте плагина.
 *
 * @param ctx контекст Cordis (корень профиля)
 * @param config настройки строки бандла; поля см. в `policy.cjs`
 */
export function apply(ctx, config) {
  const policy = loadPolicy()
  const settings = policy.loadSettings(config)
  if (settings.enabled === false) return

  /** Состояние чтения по сессиям: SessionId → покрытие документов. */
  const sessions = new Map()
  /** Кэш «рабочий каталог → корень движка»: сессия за шаг спрашивает его многократно. */
  const roots = new Map()

  /** Корень движка для рабочего каталога сессии (или undefined — гейт выключен). */
  const rootFor = (cwd) => {
    if (typeof cwd !== 'string' || cwd === '') return undefined
    if (roots.has(cwd)) return roots.get(cwd)
    const root = policy.findRoot(cwd, settings, existsSync)
    roots.set(cwd, root)
    return root
  }

  /** Состояние сессии, создаётся лениво. */
  const stateFor = (sessionId) => {
    const key = String(sessionId)
    let state = sessions.get(key)
    if (state === undefined) {
      state = policy.createState()
      sessions.set(key, state)
    }
    return state
  }

  /** Оценка гейта документации для одного агента. */
  const evaluateFor = (agent) => {
    const cwd = agent?.session?.header?.cwd
    const root = rootFor(cwd)
    if (root === undefined) return undefined
    const state = stateFor(agent.id)
    const docs = policy.requiredDocs(settings)
    return { root, state, evaluation: policy.evaluate(state, root, docs, settings) }
  }

  /**
   * Страж: возвращает причину отказа или undefined.
   * Обязан никогда не бросать: исключение из стража сломало бы вызов инструмента.
   */
  const deny = (exec) => {
    try {
      if (!exec || typeof exec !== 'object' || !exec.agent) return undefined
      const cwd = exec.agent.session?.header?.cwd
      const root = rootFor(cwd)
      if (root === undefined) return undefined

      const toolName = String(exec.name)
      const base = typeof cwd === 'string' && cwd !== '' ? cwd : root
      let targets = []
      let payload = ''
      let pattern
      let removing = false

      if (settings.writeTools.includes(toolName)) {
        const rawPath = policy.filePathOf(exec.arguments)
        if (rawPath === undefined) return undefined
        const absolute = path.resolve(base, rawPath)
        const targetRelative = policy.relativeTo(root, absolute)
        if (targetRelative === undefined) return undefined
        targets = [targetRelative]
        payload = policy.toolText(exec.arguments, settings)
      } else if (settings.shellTools.includes(toolName)) {
        const command = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments.command : undefined
        pattern = policy.shellMutates(command, settings.shellMutationPatterns)
        if (pattern === undefined) return undefined
        targets = policy.mentionedPaths(command, root, base, settings)
        payload = typeof command === 'string' ? command : ''
        removing = policy.shellRemoves(command, settings)
      } else {
        return undefined
      }

      const state = stateFor(exec.agent.id)

      // 1. Сначала философия — потом работа.
      const docs = policy.requiredDocs(settings)
      const evaluation = policy.evaluate(state, root, docs, settings)
      if (!evaluation.open) {
        state.blocked += 1
        const reason = policy.renderDenial({
          toolName,
          target: targets[0],
          pattern,
          evaluation,
          settings,
        })
        logDenied(ctx, toolName, targets[0], 'документация')
        return reason
      }

      // 2. Главный гейт: движок только 2D.
      const violation = policy.findForbidden3d({ targets, payload, removing, settings })
      if (violation !== undefined) {
        state.blocked3d += 1
        const reason = policy.renderDenial3d({ toolName, ...violation, settings })
        logDenied(ctx, toolName, violation.target, `только 2D: ${violation.id}`)
        return reason
      }

      return undefined
    } catch (error) {
      try {
        ctx.logger?.warn?.(`russiano2d-docs-gate: страж не смог оценить вызов, вызов разрешён: ${String(error)}`)
      } catch {
        /* ignore */
      }
      return undefined
    }
  }

  ctx.effect(() => ctx.tools.guard(deny), 'russiano2d-docs-gate.guard')

  ctx.on('tools/result', (exec, result) => {
    try {
      if (!exec || exec.name !== 'read' || !exec.agent) return
      if (result && result.isError === true) return
      const rawPath = policy.filePathOf(exec.arguments)
      if (rawPath === undefined) return
      const cwd = exec.agent.session?.header?.cwd
      const root = rootFor(cwd)
      if (root === undefined) return
      const absolute = path.resolve(typeof cwd === 'string' && cwd !== '' ? cwd : root, rawPath)
      if (policy.relativeTo(root, absolute) === undefined) return
      const coverage = readCoverage(result)
      if (coverage === undefined) return
      policy.noteRead(stateFor(exec.agent.id), absolute, coverage.start, coverage.end, coverage.total)
    } catch (error) {
      try {
        ctx.logger?.warn?.(`russiano2d-docs-gate: не удалось учесть чтение: ${String(error)}`)
      } catch {
        /* ignore */
      }
    }
  })

  ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent
    if (agent && agent.id !== undefined) sessions.delete(String(agent.id))
  })

  // Секция системного промпта: доктрина и прогресс именно этой сессии.
  // Держим её в своём контексте: текст пустой, если каталог не является движком.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const text = (assemblyContext) => {
      try {
        const agent = assemblyContext && assemblyContext.agent
        if (!agent) return ''
        const evaluated = evaluateFor(agent)
        if (evaluated === undefined) return ''
        return policy.renderPrompt({
          evaluation: evaluated.evaluation,
          settings,
          blocked: evaluated.state.blocked,
          blocked3d: evaluated.state.blocked3d,
        })
      } catch {
        return ''
      }
    }
    promptCtx.effect(
      () => promptCtx.systemPrompt.section({
        name: 'russiano2d:docs-gate',
        order: settings.sectionOrder,
        text,
      }),
      'russiano2d-docs-gate.section',
    )
  })
}

/** Запись в журнал об отказе: журнал не должен влиять на сам отказ. */
function logDenied(ctx, toolName, target, reason) {
  try {
    ctx.logger?.debug?.(
      `russiano2d-docs-gate: отклонён ${toolName}${target ? ` (${target})` : ''} — ${reason}`,
    )
  } catch {
    /* ignore */
  }
}

/** Экспорт для автотестов: сам Cordis его не использует. */
export const __internals = { loadPolicy, readCoverage }
