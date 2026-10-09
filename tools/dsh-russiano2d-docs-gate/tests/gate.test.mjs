import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/gate.js'

const require_ = createRequire(import.meta.url)
const policy = require_('../lib/policy.cjs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(HERE, '..')

/** Минимальный контекст Cordis: пишем только то, что плагин реально использует. */
function fakeCtx() {
  const guards = []
  const sections = []
  const handlers = new Map()
  const effects = []
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: {
      guard(fn) {
        guards.push(fn)
        return () => {}
      },
    },
    effect(run, label) {
      const disposer = run()
      effects.push({ label, disposer })
      return disposer
    },
    on(event, listener) {
      const list = handlers.get(event) || []
      list.push(listener)
      handlers.set(event, list)
      return () => {}
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
    systemPrompt: {
      section(spec) {
        sections.push(spec)
        return () => {}
      },
    },
  }
  return { ctx, guards, sections, handlers, effects }
}

/** Временный «репозиторий движка» с документами известной длины. */
function makeEngine() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'russiano2d-docs-')))
  const files = {
    'docs/ARCHITECTURE.md': 12,
    'docs/AGENT_IMPLEMENTATION_RULES.md': 20,
    'docs/internal/NATIVE.md': 40,
    'docs/HIGH_LEVEL_API.md': 25,
    'docs/highlevel/vfx.md': 8,
    'docs/highlevel/_CONTRACT.md': 6,
  }
  for (const [relative, lines] of Object.entries(files)) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, Array.from({ length: lines }, (_v, i) => `строка ${i + 1}`).join('\n') + '\n')
  }
  return { root, files }
}

function makeAgent(id, cwd) {
  return { id, session: { header: { cwd } } }
}

function toolResult(handlers, exec, result) {
  for (const listener of handlers.get('tools/result') || []) listener(exec, result)
}

/** Сымитировать успешное чтение файла инструментом read. */
function readFile(handlers, agent, relative, totalLines, options = {}) {
  const cwd = agent.session.header.cwd
  const count = options.lines !== undefined
    ? options.lines
    : options.partial === true
      ? Math.max(1, Math.floor(totalLines / 2))
      : totalLines
  const offset = options.offset !== undefined ? options.offset : 1
  const exec = {
    name: 'read',
    arguments: { file_path: relative, ...(offset > 1 ? { offset } : {}) },
    agent,
    token: Symbol('call'),
    signal: new AbortController().signal,
  }
  const result = {
    isError: false,
    value: {
      path: path.join(cwd, relative),
      offset,
      lines: Array.from({ length: count }, (_v, i) => ({ number: offset + i, text: 'текст' })),
      totalLines,
    },
  }
  toolResult(handlers, exec, result)
}

/** Первая причина отказа среди зарегистрированных стражей. */
function guardReason(guards, exec) {
  for (const guard of guards) {
    const reason = guard(exec)
    if (typeof reason === 'string' && reason !== '') return reason
  }
  return undefined
}

function execFor(name, args, agent) {
  return { name, arguments: args, agent, token: Symbol('call'), signal: new AbortController().signal }
}

function readCore(handlers, agent, files) {
  readFile(handlers, agent, 'docs/ARCHITECTURE.md', files['docs/ARCHITECTURE.md'])
  readFile(handlers, agent, 'docs/AGENT_IMPLEMENTATION_RULES.md', files['docs/AGENT_IMPLEMENTATION_RULES.md'])
  readFile(handlers, agent, 'docs/internal/NATIVE.md', files['docs/internal/NATIVE.md'])
  readFile(handlers, agent, 'docs/HIGH_LEVEL_API.md', files['docs/HIGH_LEVEL_API.md'])
}

/* ------------------------------------------------------------------ policy */

test('findRoot ищет корень движка вверх по дереву и не срабатывает вне него', () => {
  const { root } = makeEngine()
  const settings = policy.loadSettings(undefined)
  assert.equal(policy.findRoot(path.join(root, 'src', 'highlevel'), settings, fs.existsSync), root)
  assert.equal(policy.findRoot(root, settings, fs.existsSync), root)
  const alien = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'not-engine-')))
  assert.equal(policy.findRoot(alien, settings, fs.existsSync), undefined)
})

test('настоящий репозиторий движка распознаётся по своим документам', () => {
  const settings = policy.loadSettings(undefined)
  const engineRoot = path.resolve(PACKAGE_ROOT, '..', '..')
  assert.equal(policy.findRoot(engineRoot, settings, fs.existsSync), engineRoot)
  for (const doc of settings.docs) {
    assert.ok(fs.existsSync(path.join(engineRoot, doc.path)), `нет обязательного документа ${doc.path}`)
  }
})

test('shellMutates ловит запись и пропускает чтение/сборку', () => {
  const settings = policy.loadSettings(undefined)
  const patterns = settings.shellMutationPatterns
  const denied = [
    'echo ok > src/highlevel/vfx.js',
    'printf x >> docs/internal/NATIVE.md',
    'cat > src/highlevel/new.js <<EOF',
    'sed -i "" s/a/b/ docs/internal/NATIVE.md',
    'tee src/highlevel/vfx.js',
    'git apply patch.diff',
    'rm -rf src/highlevel',
    'cp a.js src/highlevel/b.js',
    'mkdir -p src/highlevel',
  ]
  for (const command of denied) {
    assert.notEqual(policy.shellMutates(command, patterns), undefined, `должна блокироваться: ${command}`)
  }
  const allowed = [
    'cmake --build build -j8 2>&1 | tail -20',
    'python3 tools/run_tests.py',
    'grep -rn "installVfx" src/highlevel',
    'ls -la src/highlevel',
    'git status --short',
    'node tools/bench_highlevel.py > /dev/null',
    'pnpm install --frozen-lockfile',
    'printf \'%s\\n\' \'{"cmd":"state"}\' | ./russiano2d --agent',
  ]
  for (const command of allowed) {
    assert.equal(policy.shellMutates(command, patterns), undefined, `не должна блокироваться: ${command}`)
  }
})

test('requiredDocs добавляет контракт и doc подсистемы только к своей цели', () => {
  const { root } = makeEngine()
  const settings = policy.loadSettings(undefined)
  const core = policy.requiredDocs(root, 'src/core/render.c', [], settings, fs.existsSync)
  assert.deepEqual(core.map((doc) => doc.path), [
    'docs/ARCHITECTURE.md',
    'docs/AGENT_IMPLEMENTATION_RULES.md',
    'docs/internal/NATIVE.md',
    'docs/HIGH_LEVEL_API.md',
  ])
  const highlevel = policy.requiredDocs(root, 'src/highlevel/vfx.js', [], settings, fs.existsSync)
  assert.deepEqual(highlevel.map((doc) => doc.path), [
    'docs/ARCHITECTURE.md',
    'docs/AGENT_IMPLEMENTATION_RULES.md',
    'docs/internal/NATIVE.md',
    'docs/HIGH_LEVEL_API.md',
    'docs/highlevel/_CONTRACT.md',
    'docs/highlevel/vfx.md',
  ])
  const unknownModule = policy.requiredDocs(root, 'src/highlevel/unknown.js', [], settings, fs.existsSync)
  assert.equal(unknownModule.some((doc) => doc.path === 'docs/highlevel/unknown.md'), false)
})

test('покрытие строк: частичное чтение не закрывает документ', () => {
  const state = policy.createState()
  const abs = '/tmp/doc.md'
  policy.noteRead(state, abs, 1, 100, 400)
  assert.deepEqual(policy.coverageOf(state, abs).ranges, [[1, 100]])
  assert.equal(policy.isCovered(policy.coverageOf(state, abs).ranges, 400, 1), false)
  policy.noteRead(state, abs, 101, 400, 400)
  assert.deepEqual(policy.coverageOf(state, abs).ranges, [[1, 400]])
  assert.equal(policy.isCovered(policy.coverageOf(state, abs).ranges, 400, 1), true)
  const half = policy.createState()
  policy.noteRead(half, abs, 1, 200, 400)
  assert.equal(policy.isCovered(policy.coverageOf(half, abs).ranges, 400, 0.5), true)
  assert.equal(policy.isCovered(policy.coverageOf(half, abs).ranges, 400, 1), false)
})

/* -------------------------------------------------------------------- gate */

test('плагин регистрирует страж, секцию промпта и слушателей', () => {
  const { ctx, guards, sections, handlers } = fakeCtx()
  apply(ctx, undefined)
  assert.equal(guards.length, 1)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'russiano2d:docs-gate')
  assert.equal((handlers.get('tools/result') || []).length, 1)
  assert.equal((handlers.get('agent/disposed') || []).length, 1)
})

test('без документации write отклоняется с обязательным порядком', () => {
  const { root } = makeEngine()
  const { ctx, guards } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s1', root)
  const reason = guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent))
  assert.ok(reason, 'запись должна быть отклонена')
  assert.match(reason, /docs\/ARCHITECTURE\.md/)
  assert.match(reason, /docs\/internal\/NATIVE\.md/)
  assert.match(reason, /docs\/HIGH_LEVEL_API\.md/)
  assert.match(reason, /философия/)
  assert.match(reason, /повтори ровно тот же вызов/)
})

test('частичное чтение не открывает гейт, полное — открывает', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s2', root)

  readFile(handlers, agent, 'docs/ARCHITECTURE.md', files['docs/ARCHITECTURE.md'], { partial: true })
  assert.ok(guardReason(guards, execFor('edit', { file_path: 'src/core/render.c' }, agent)))

  readCore(handlers, agent, files)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent)), undefined)
})

test('чтение несколькими окнами складывается', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s3', root)
  const total = files['docs/ARCHITECTURE.md']
  readCore(handlers, agent, files)
  // перечитываем первый файл по частям вместо одного полного чтения
  const fresh = makeEngine()
  const freshAgent = makeAgent('s3b', fresh.root)
  readFile(handlers, freshAgent, 'docs/ARCHITECTURE.md', total, { lines: 5 })
  assert.ok(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, freshAgent)))
  readFile(handlers, freshAgent, 'docs/ARCHITECTURE.md', total, { lines: total - 5, offset: 6 })
  readFile(handlers, freshAgent, 'docs/AGENT_IMPLEMENTATION_RULES.md', fresh.files['docs/AGENT_IMPLEMENTATION_RULES.md'])
  readFile(handlers, freshAgent, 'docs/internal/NATIVE.md', files['docs/internal/NATIVE.md'])
  readFile(handlers, freshAgent, 'docs/HIGH_LEVEL_API.md', files['docs/HIGH_LEVEL_API.md'])
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, freshAgent)), undefined)
})

test('правка подсистемы требует doc подсистемы и контракт', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s4', root)
  readCore(handlers, agent, files)

  const denied = guardReason(guards, execFor('write', { file_path: 'src/highlevel/vfx.js' }, agent))
  assert.ok(denied)
  assert.match(denied, /docs\/highlevel\/vfx\.md/)
  assert.match(denied, /docs\/highlevel\/_CONTRACT\.md/)

  readFile(handlers, agent, 'docs/highlevel/_CONTRACT.md', files['docs/highlevel/_CONTRACT.md'])
  readFile(handlers, agent, 'docs/highlevel/vfx.md', files['docs/highlevel/vfx.md'])
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/highlevel/vfx.js' }, agent)), undefined)
})

test('bash: изменяющая команда блокируется, read-only — никогда', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s5', root)

  assert.equal(guardReason(guards, execFor('bash', { command: 'cmake --build build -j8' }, agent)), undefined)
  assert.equal(guardReason(guards, execFor('bash', { command: 'git status --short' }, agent)), undefined)
  const denied = guardReason(guards, execFor('bash', { command: 'cat > src/highlevel/vfx.js <<EOF' }, agent))
  assert.ok(denied)
  assert.match(denied, /bash/)

  readCore(handlers, agent, files)
  // Триада прочитана: правка обычного модуля движка командой уже не блокируется.
  assert.equal(guardReason(guards, execFor('bash', { command: 'echo x > src/core/render.c' }, agent)), undefined)
  // А правка подсистемы всё ещё требует её собственный doc и контракт.
  const highlevel = guardReason(guards, execFor('bash', { command: 'cat > src/highlevel/vfx.js <<EOF' }, agent))
  assert.ok(highlevel)
  assert.match(highlevel, /docs\/highlevel\/vfx\.md/)
  readFile(handlers, agent, 'docs/highlevel/_CONTRACT.md', files['docs/highlevel/_CONTRACT.md'])
  readFile(handlers, agent, 'docs/highlevel/vfx.md', files['docs/highlevel/vfx.md'])
  assert.equal(
    guardReason(guards, execFor('bash', { command: 'cat > src/highlevel/vfx.js <<EOF' }, agent)),
    undefined,
  )
})

test('вне корня движка и в чужом каталоге гейт молчит', () => {
  const { root } = makeEngine()
  const { ctx, guards } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s6', root)
  assert.equal(guardReason(guards, execFor('write', { file_path: path.join(os.tmpdir(), 'other.txt') }, agent)), undefined)

  const alien = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alien-')))
  const alienAgent = makeAgent('s7', alien)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'main.c' }, alienAgent)), undefined)
  assert.equal(guardReason(guards, execFor('bash', { command: 'rm -rf build' }, alienAgent)), undefined)
})

test('страж не бросает на мусорных вызовах и без агента', () => {
  const { ctx, guards } = fakeCtx()
  apply(ctx, undefined)
  assert.equal(guardReason(guards, undefined), undefined)
  assert.equal(guardReason(guards, { name: 'write' }), undefined)
  assert.equal(guardReason(guards, { name: 'write', arguments: null, agent: { id: 'x', session: {} } }), undefined)
  assert.equal(guardReason(guards, execFor('todo_write', { items: [] }, makeAgent('s8', os.tmpdir()))), undefined)
})

test('секция промпта пустая вне движка и содержит доктрину внутри', () => {
  const { root } = makeEngine()
  const { ctx, sections } = fakeCtx()
  apply(ctx, undefined)
  const section = sections[0]
  assert.equal(section.text({ agent: makeAgent('p1', os.tmpdir()) }), '')
  const text = section.text({ agent: makeAgent('p2', root) })
  assert.match(text, /обязательный порядок/)
  assert.match(text, /docs\/ARCHITECTURE\.md/)
  assert.match(text, /docs\/AGENT_IMPLEMENTATION_RULES\.md/)
  assert.match(text, /write\/edit/)
  assert.match(text, /docs\/highlevel\/_CONTRACT\.md/)
})

test('состояние сессии сбрасывается при её закрытии', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s9', root)
  readCore(handlers, agent, files)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent)), undefined)
  for (const listener of handlers.get('agent/disposed') || []) listener({ agent })
  assert.ok(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent)))
})

test('выключенный плагин ничего не регистрирует', () => {
  const { ctx, guards, sections } = fakeCtx()
  apply(ctx, { enabled: false })
  assert.equal(guards.length, 0)
  assert.equal(sections.length, 0)
})
