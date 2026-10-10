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
const ENGINE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')

const PHILOSOPHY = 'docs/PHILOSOPHY.md'

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
    [PHILOSOPHY]: 30,
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

/** Прочитать философию целиком — гейт документации открыт. */
function readPhilosophy(handlers, agent, files) {
  readFile(handlers, agent, PHILOSOPHY, files[PHILOSOPHY])
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

test('настоящий репозиторий движка распознаётся, обязательный документ существует', () => {
  const settings = policy.loadSettings(undefined)
  assert.equal(policy.findRoot(ENGINE_ROOT, settings, fs.existsSync), ENGINE_ROOT)
  assert.equal(settings.docs.length, 1)
  assert.equal(settings.docs[0].path, PHILOSOPHY)
  for (const doc of settings.docs) {
    assert.ok(fs.existsSync(path.join(ENGINE_ROOT, doc.path)), `нет обязательного документа ${doc.path}`)
  }
  for (const ref of settings.references) {
    if (ref.path.includes('<')) continue
    assert.ok(fs.existsSync(path.join(ENGINE_ROOT, ref.path)), `нет справочника ${ref.path}`)
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

test('requiredDocs — ровно философия, без условных доков и страниц модулей', () => {
  const settings = policy.loadSettings(undefined)
  assert.deepEqual(policy.requiredDocs(settings).map((doc) => doc.path), [PHILOSOPHY])
  assert.equal(policy.requiredDocs(settings)[0].id, 'philosophy')
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

test('toolText достаёт содержимое write и новые строки edit', () => {
  const settings = policy.loadSettings(undefined)
  assert.equal(policy.toolText({ file_path: 'a.c', content: 'тело' }, settings), 'тело')
  assert.equal(policy.toolText({ file_path: 'a.c', old_string: 'было', new_string: 'стало' }, settings), 'стало')
  assert.equal(policy.toolText({ file_path: 'a.c', content: 'тело', new_string: 'ещё' }, settings), 'тело\nещё')
})

test('mentionedPaths находит только файлы внутри корня с проверяемым расширением', () => {
  const { root } = makeEngine()
  const settings = policy.loadSettings(undefined)
  const found = policy.mentionedPaths('echo x > src/core/render.c && cat docs/x.md', root, root, settings)
  assert.deepEqual(found, ['src/core/render.c'])
  assert.deepEqual(policy.mentionedPaths('rm -rf src/highlevel', root, root, settings), [])
  assert.deepEqual(policy.mentionedPaths('echo x > /tmp/other.c', root, root, settings), [])
})

test('главный гейт: запрещённые имена и освобождённые зоны', () => {
  const { root } = makeEngine()
  const settings = policy.loadSettings(undefined)
  const check = (target, payload) => policy.findForbidden3d({ targets: [target], payload, settings })

  assert.equal(check('src/render3d.c', '').kind, 'path')
  assert.equal(check('src/r3d/world.js', '').kind, 'path')
  assert.equal(check('game/mesh3d.js', '').kind, 'path')
  assert.equal(check('src/core/render.c', 'struct MeshRenderer { };').kind, 'content')
  assert.equal(check('src/core/render.c', 'Vector3 pos;').kind, 'content')
  assert.equal(check('src/core/render.c', '// R3D живёт отдельно').kind, 'content')
  assert.equal(check('src/core/render.c', 'RigidBody3D body;').kind, 'content')

  // RE2D — это 2D: projection, submitMesh, depth, sprite — всё разрешено.
  assert.equal(check('src/highlevel/re2d.js', 'engine.submitMesh(verts, n, tex)'), undefined)
  assert.equal(check('src/re2d_world_gpu.c', '// shared depth; ordinary 2D frame'), undefined)
  assert.equal(check('src/nodes.c', 'r2d_node_sync(&nodes[i]);'), undefined)

  // Освобождённые зоны: SDK-импорт, инструменты, доки, тесты, дистрибутивы.
  assert.equal(check('docs/SDK.md', 'MeshRenderer\'а в рантайме нет'), undefined)
  assert.equal(check('sdk/native/sdk_bake.c', 'ufbx_load(...); Vector3 v;'), undefined)
  assert.equal(check('tools/agents_doc.py', 'Camera3D'), undefined)
  assert.equal(check('tests/js/depth_test.mjs', 'const R3D = 1;'), undefined)
  assert.equal(check('dist/macos-arm64/AGENTS.md', 'MeshRenderer'), undefined)
})

test('главный гейт: содержимое проверяется только у проверяемых расширений', () => {
  const { root } = makeEngine()
  const settings = policy.loadSettings(undefined)
  assert.equal(
    policy.findForbidden3d({ targets: ['NOTES.md'], payload: 'MeshRenderer', settings }),
    undefined,
  )
  assert.notEqual(
    policy.findForbidden3d({ targets: ['src/render.c'], payload: 'MeshRenderer', settings }),
    undefined,
  )
})

test('law2d можно выключить и освободить конкретный путь', () => {
  const { root } = makeEngine()
  const off = policy.loadSettings({ law2d: { enabled: false } })
  assert.equal(off.law2d.enabled, false)
  assert.equal(policy.findForbidden3d({ targets: ['src/render3d.c'], payload: 'Vector3', settings: off }), undefined)

  const allowed = policy.loadSettings({ law2d: { allowPaths: ['src/render3d.c'] } })
  assert.deepEqual(allowed.law2d.allowPaths, ['src/render3d.c'])
  assert.equal(policy.findForbidden3d({ targets: ['src/render3d.c'], payload: 'Vector3', settings: allowed }), undefined)
  assert.notEqual(policy.findForbidden3d({ targets: ['src/other3d.c'], payload: '', settings: allowed }), undefined)
})

test('shellRemoves: только удаление — это путь к 2D, а не 3D-изация', () => {
  const settings = policy.loadSettings(undefined)
  assert.equal(policy.shellRemoves('rm src/render3d.c', settings), true)
  assert.equal(policy.shellRemoves('rm -rf src/r3d', settings), true)
  assert.equal(policy.shellRemoves('git rm src/mesh3d.c', settings), true)
  assert.equal(policy.shellRemoves('rm -rf src/render3d.c && echo "Vector3 v;" > src/a.c', settings), false)
  assert.equal(policy.shellRemoves('cp a.c src/render3d.c', settings), false)
  assert.equal(policy.shellRemoves('mkdir -p src/3d', settings), false)
  assert.equal(policy.shellRemoves('sed -i s/a/b/ src/render3d.c', settings), false)
  assert.equal(policy.shellRemoves('rm -rf build', settings), true)

  // Удаление 3D-файла гейт пропускает, запись — нет.
  assert.equal(
    policy.findForbidden3d({ targets: ['src/render3d.c'], payload: 'rm src/render3d.c', removing: true, settings }),
    undefined,
  )
  assert.notEqual(
    policy.findForbidden3d({ targets: ['src/render3d.c'], payload: 'cp a.c src/render3d.c', removing: false, settings }),
    undefined,
  )
})

/**
 * Калибровка: правила главного гейта не должны срабатывать на существующем коде
 * движка. Если этот тест падает — либо в репозиторий попала 3D-сущность, либо
 * шаблон слишком широкий.
 */
test('существующий код движка не попадает под главный гейт', () => {
  const settings = policy.loadSettings(undefined)
  const roots = ['src', 'game', 'demos'].map((dir) => path.join(ENGINE_ROOT, dir)).filter((dir) => fs.existsSync(dir))
  assert.ok(roots.length > 0, 'не нашёл исходники движка для калибровки')
  const hits = []
  let scanned = 0
  for (const dir of roots) {
    for (const file of walk(dir)) {
      const relative = path.relative(ENGINE_ROOT, file).split(path.sep).join('/')
      if (!policy.hasScanExtension(relative, settings)) continue
      let text
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (text.includes('\0')) continue
      scanned += 1
      const violation = policy.findForbidden3d({ targets: [relative], payload: text, settings })
      if (violation !== undefined) hits.push(`${relative} → ${violation.id} «${violation.sample}»`)
    }
  }
  assert.ok(scanned > 20, `просмотрено слишком мало файлов: ${scanned}`)
  assert.deepEqual(hits, [], `главный гейт сработал на существующем коде:\n${hits.join('\n')}`)
})

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

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

test('без философии write отклоняется с обязательным порядком', () => {
  const { root } = makeEngine()
  const { ctx, guards } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s1', root)
  const reason = guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent))
  assert.ok(reason, 'запись должна быть отклонена')
  assert.match(reason, /docs\/PHILOSOPHY\.md/)
  assert.match(reason, /философия/i)
  assert.match(reason, /повтори ровно тот же вызов/)
})

test('частичное чтение философии не открывает гейт, полное — открывает', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s2', root)

  readFile(handlers, agent, PHILOSOPHY, files[PHILOSOPHY], { partial: true })
  assert.ok(guardReason(guards, execFor('edit', { file_path: 'src/core/render.c' }, agent)))

  readPhilosophy(handlers, agent, files)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent)), undefined)
})

test('чтение философии несколькими окнами складывается', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s3', root)
  const total = files[PHILOSOPHY]

  readFile(handlers, agent, PHILOSOPHY, total, { lines: 5 })
  assert.ok(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent)))
  readFile(handlers, agent, PHILOSOPHY, total, { lines: total - 5, offset: 6 })
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/core/render.c' }, agent)), undefined)
})

test('после философии правка подсистемы не требует отдельных доков', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s4', root)
  readPhilosophy(handlers, agent, files)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/highlevel/vfx.js' }, agent)), undefined)
})

test('bash: изменяющая команда блокируется до философии, read-only — никогда', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s5', root)

  assert.equal(guardReason(guards, execFor('bash', { command: 'cmake --build build -j8' }, agent)), undefined)
  assert.equal(guardReason(guards, execFor('bash', { command: 'git status --short' }, agent)), undefined)
  const denied = guardReason(guards, execFor('bash', { command: 'cat > src/highlevel/vfx.js <<EOF' }, agent))
  assert.ok(denied)
  assert.match(denied, /bash/)
  assert.match(denied, /docs\/PHILOSOPHY\.md/)

  readPhilosophy(handlers, agent, files)
  assert.equal(guardReason(guards, execFor('bash', { command: 'echo x > src/core/render.c' }, agent)), undefined)
})

test('главный гейт останавливает 3D и после прочитанной философии', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s6', root)
  readPhilosophy(handlers, agent, files)

  const byPath = guardReason(guards, execFor('write', { file_path: 'src/render3d.c' }, agent))
  assert.ok(byPath)
  assert.match(byPath, /только 2D/)
  assert.match(byPath, /PHILOSOPHY\.md/)

  const byContent = guardReason(
    guards,
    execFor('write', { file_path: 'src/core/render.c', content: 'struct MeshRenderer { Vector3 pos; };' }, agent),
  )
  assert.ok(byContent)
  assert.match(byContent, /MeshRenderer/)

  const byEdit = guardReason(
    guards,
    execFor('edit', { file_path: 'src/scene.js', old_string: 'a', new_string: 'const R3D = {};' }, agent),
  )
  assert.ok(byEdit)

  // 2D-код проходит.
  assert.equal(
    guardReason(guards, execFor('write', { file_path: 'src/re2d_world_gpu.c', content: '// ordinary 2D frame, submitMesh' }, agent)),
    undefined,
  )
  // Освобождённые зоны проходят (SDK/инструменты/доки/тесты).
  assert.equal(
    guardReason(guards, execFor('write', { file_path: 'sdk/native/sdk_bake.c', content: 'Vector3 v;' }, agent)),
    undefined,
  )
  assert.equal(
    guardReason(guards, execFor('write', { file_path: 'docs/SDK.md', content: 'MeshRenderer' }, agent)),
    undefined,
  )
})

test('главный гейт работает и для bash-записи', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s7', root)
  readPhilosophy(handlers, agent, files)

  const byPath = guardReason(guards, execFor('bash', { command: 'cat > src/mesh3d.c <<EOF' }, agent))
  assert.ok(byPath)
  assert.match(byPath, /только 2D/)

  const byContent = guardReason(guards, execFor('bash', { command: 'echo "Vector3 v;" > src/core/math.c' }, agent))
  assert.ok(byContent)

  assert.equal(guardReason(guards, execFor('bash', { command: 'echo x > src/core/render.c' }, agent)), undefined)
  assert.equal(guardReason(guards, execFor('bash', { command: 'rm -rf src/highlevel' }, agent)), undefined)
  // Удаление 3D-файла возвращает движок к 2D — гейт пропускает.
  assert.equal(guardReason(guards, execFor('bash', { command: 'rm src/render3d.c' }, agent)), undefined)
  // А запись под видом удаления — нет.
  assert.ok(
    guardReason(guards, execFor('bash', { command: 'rm src/render3d.c && cp a.c src/render3d.c' }, agent)),
  )
})

test('выключенный главный гейт оставляет только гейт философии', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, { law2d: { enabled: false } })
  const agent = makeAgent('s8', root)
  assert.ok(guardReason(guards, execFor('write', { file_path: 'src/render3d.c' }, agent)))
  readPhilosophy(handlers, agent, files)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/render3d.c' }, agent)), undefined)
})

test('вне корня движка и в чужом каталоге гейт молчит', () => {
  const { root } = makeEngine()
  const { ctx, guards } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s9', root)
  assert.equal(guardReason(guards, execFor('write', { file_path: path.join(os.tmpdir(), 'other.txt') }, agent)), undefined)

  const alien = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alien-')))
  const alienAgent = makeAgent('s10', alien)
  assert.equal(guardReason(guards, execFor('write', { file_path: 'src/render3d.c' }, alienAgent)), undefined)
  assert.equal(guardReason(guards, execFor('bash', { command: 'rm -rf build' }, alienAgent)), undefined)
})

test('страж не бросает на мусорных вызовах и без агента', () => {
  const { ctx, guards } = fakeCtx()
  apply(ctx, undefined)
  assert.equal(guardReason(guards, undefined), undefined)
  assert.equal(guardReason(guards, { name: 'write' }), undefined)
  assert.equal(guardReason(guards, { name: 'write', arguments: null, agent: { id: 'x', session: {} } }), undefined)
  assert.equal(guardReason(guards, execFor('todo_write', { items: [] }, makeAgent('s11', os.tmpdir()))), undefined)
  assert.equal(guardReason(guards, execFor('str_replace_editor', undefined, makeAgent('s12', os.tmpdir()))), undefined)
})

test('секция промпта пустая вне движка и содержит обе доктрины внутри', () => {
  const { root } = makeEngine()
  const { ctx, sections } = fakeCtx()
  apply(ctx, undefined)
  const section = sections[0]
  assert.equal(section.text({ agent: makeAgent('p1', os.tmpdir()) }), '')
  const text = section.text({ agent: makeAgent('p2', root) })
  assert.match(text, /сначала философия/i)
  assert.match(text, /docs\/PHILOSOPHY\.md/)
  assert.match(text, /ГЛАВНЫЙ ГЕЙТ/)
  assert.match(text, /только 2D/)
  assert.match(text, /RE2D/)
  assert.match(text, /write\/edit/)
  assert.match(text, /docs\/ARCHITECTURE\.md/)
})

test('в промпте видно счётчики отказов после попыток записи', () => {
  const engine = makeEngine()
  const fake = fakeCtx()
  apply(fake.ctx, undefined)
  const agent = makeAgent('p3', engine.root)

  const before = fake.sections[0].text({ agent })
  assert.doesNotMatch(before, /Отклонённых попыток записи/)

  readPhilosophy(fake.handlers, agent, engine.files)
  guardReason(fake.guards, execFor('write', { file_path: 'src/render3d.c' }, agent))

  const after = fake.sections[0].text({ agent })
  assert.match(after, /Отклонённых попыток записи/)
  assert.match(after, /главный гейт/)
})

test('состояние сессии сбрасывается при её закрытии', () => {
  const { root, files } = makeEngine()
  const { ctx, guards, handlers } = fakeCtx()
  apply(ctx, undefined)
  const agent = makeAgent('s13', root)
  readPhilosophy(handlers, agent, files)
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
