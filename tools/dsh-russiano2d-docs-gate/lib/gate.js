/**
 * Russiano2D docs-gate — плагин DeepSeek Harness.
 *
 * Доктрина движка: **сначала философия, потом низкоуровневые доки, потом
 * высокоуровневые доки; без этих знаний писать в движок нельзя.**
 *
 * Плагин делает три вещи:
 *   1. добавляет в системный промпт агента обязательный порядок чтения и текущий
 *      прогресс именно этой сессии;
 *   2. следит за результатами инструмента `read` и считает документ прочитанным
 *      только тогда, когда покрыты его строки (частичное чтение не считается);
 *   3. отклоняет `write`/`edit` и изменяющие файлы команды `bash`/`pwsh`, пока
 *      обязательные документы не прочитаны, — через `ctx.tools.guard`, то есть
 *      для всех агентов профиля, включая сабагентов, тимейтов и детей workflow.
 *
 * Гейт включается только в рабочем каталоге, который действительно является
 * репозиторием Russiano2D (по умолчанию — есть `docs/ARCHITECTURE.md`,
 * `docs/API.md` и `docs/HIGH_LEVEL_API.md`). В любом другом каталоге плагин
 * молчит и ничего не блокирует.
 *
 * Этот файл — стабильный загрузчик: политика (список документов, шаблоны команд,
 * тексты) живёт в `policy.cjs` и перечитывается с диска при каждой загрузке
 * композиции. Меняешь политику — переключаешь бандл в Plugins.
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

  /** Оценка гейта для одного агента и набора документов. */
  const evaluateFor = (agent, docs) => {
    const cwd = agent?.session?.header?.cwd
    const root = rootFor(cwd)
    if (root === undefined) return undefined
    const state = stateFor(agent.id)
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
      let targetRelative
      let mentioned = []
      let pattern

      if (settings.writeTools.includes(toolName)) {
        const rawPath = policy.filePathOf(exec.arguments)
        if (rawPath === undefined) return undefined
        const absolute = path.resolve(typeof cwd === 'string' && cwd !== '' ? cwd : root, rawPath)
        targetRelative = policy.relativeTo(root, absolute)
        if (targetRelative === undefined) return undefined
      } else if (settings.shellTools.includes(toolName)) {
        const command = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments.command : undefined
        pattern = policy.shellMutates(command, settings.shellMutationPatterns)
        if (pattern === undefined) return undefined
        mentioned = policy.mentionedTargets(command, settings)
      } else {
        return undefined
      }

      const docs = policy.requiredDocs(root, targetRelative, mentioned, settings, existsSync)
      const state = stateFor(exec.agent.id)
      const evaluation = policy.evaluate(state, root, docs, settings)
      if (evaluation.open) return undefined

      state.blocked += 1
      const reason = policy.renderDenial({
        toolName,
        target: targetRelative,
        pattern,
        evaluation,
        settings,
      })
      try {
        ctx.logger?.debug?.(
          `russiano2d-docs-gate: отклонён ${toolName}${targetRelative ? ` (${targetRelative})` : ''}`,
        )
      } catch {
        /* журнал не должен влиять на отказ */
      }
      return reason
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
        const root = rootFor(agent.session?.header?.cwd)
        if (root === undefined) return ''
        const core = policy.requiredDocs(root, undefined, [], settings, existsSync)
        const evaluated = evaluateFor(agent, core)
        if (evaluated === undefined) return ''
        const status = policy.renderPrompt({ evaluation: evaluated.evaluation, settings })
        if (evaluated.evaluation.open || evaluated.state.blocked === 0) return status
        return `${status}\n\nОтклонённых попыток записи в этой сессии: ${evaluated.state.blocked}.`
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

/** Экспорт для автотестов: сам Cordis его не использует. */
export const __internals = { loadPolicy, readCoverage }
