import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'doc-preview'
const PANE = {
  component: 'Pane',
  requestId: 'doc-preview',
  props: { title: 'Preview', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const
/** What the engine answers beneath the plugin in every test. */
const world = (on: On, opened: { columns?: number; rows?: number }[] = []) => {
  mock.env(on, { HOME: '/home/u' })
  on('session.cwd', () => ({ value: '/proj' }))
  on('ui.log', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('ui.open', (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
}
/** An assistant reply row with `text`. Nothing in the kit stores a row, so the append rejects; the plugin has looked by then. */
const reply = ($: Engine, uuid: string, text: string) =>
  $.session
    .append({
      door: 'response',
      origin: { kind: 'model', model: 'claude' },
      uuid,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    } as never)
    .catch(() => undefined)
const PLAN ='# Plan\n\nShip it.\n\n```mermaid\ngraph TD\n  A-->B\n```\n'
const file = (size: number) => ({ value: { kind: 'file' as const, size, mtimeMs: 1, isLink: false } })
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('a Markdown file Claude writes is offered in the band and opens in the pane', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Write' }, () => ({ result: {} as never }))
  // What the engine draws in the band once the plugin has nothing to show.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('fs.read', () => ({ value: PLAN }))
  on('fs.stat', () => file(PLAN.length))

  await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: '/proj/docs/plan.md', content: PLAN })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await band.find({ type: 'Text', text: /plan\.md/ })).toBeDefined()
    await band.unmount()
  }

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await band.press({ key: 'preview' })
  expect(await band.find({ key: 'preview' })).toBeUndefined()

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(String((await pane.find({ type: 'Markdown' }))?.props.text)).toContain('Ship it.')
    expect((await pane.find({ type: 'Code' }))?.props.source).toBe('graph TD\n  A-->B')
    await pane.unmount()
  }
})

test('/xorio:preview opens a path and says why when it will not', async ($, on) => {
  world(on)
  on('fs.stat', (_$, e) => {
    if (e.path.endsWith('/missing.md')) return { deny: 'ENOENT' }
    return file(4)
  })
  on('fs.read', () => ({ value: '# Hi' }))

  const missing = await $.command.run({ ...RUN, command: 'xorio:preview', args: 'missing.md' })
  expect(missing.text).toContain('Not found')
  const secret = await $.command.run({ ...RUN, command: 'xorio:preview', args: '.env' })
  expect(secret.text).toContain('Not a Markdown or Mermaid file')
  const opened = await $.command.run({ ...RUN, command: 'xorio:preview', args: 'docs/a.md' })
  expect(opened.text).toBeUndefined()

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('# Hi')
})

test('the picker lists folders and previewable files, and opens a pick', async ($, on) => {
  world(on)
  const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })
  on('fs.list', () => ({ value: [
    entry('docs', 'dir'),
    entry('node_modules', 'dir'),
    entry('README.md', 'file'),
    entry('main.rs', 'file'),
    entry('flow.mmd', 'file'),
  ] }))
  on('fs.stat', () => file(9))
  on('fs.read', () => ({ value: '# Readme' }))

  await $.command.run({ ...RUN, command: 'xorio:preview', args: '' })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const browse = await pane.find({ key: 'browse' })
  const options = browse?.props.options as { value: string; label: string }[]
  expect(options.map(o => o.label)).toEqual(['choose…', '../', 'docs/', 'flow.mmd', 'README.md'])

  const readme = options.find(o => o.label === 'README.md')?.value ?? ''
  await pane.select({ key: 'browse', value: readme })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('# Readme')
})

test('a mermaid diagram in a reply can be previewed from the band', async ($, on) => {
  world(on)
  await reply($, 'r1', 'Here:\n\n```mermaid\nflowchart LR\n  A-->B\n```\n')

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /1 diagram/ })).toBeDefined()
  await band.press({ key: 'preview' })

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Code' }))?.props.source).toBe('flowchart LR\n  A-->B')
})

test('a diagram repeated in one reply is offered once', async ($, on) => {
  world(on)
  const block = '```mermaid\nflowchart LR\n  A-->C\n```'
  await reply($, 'r2', `${block}\n\nAgain:\n\n${block}\n`)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /^1 diagram$/ })).toBeDefined()
})

test('the toolbar stays on the top row as the pane scrolls, on the terminal', async ($, on) => {
  world(on)
  on('fs.read', () => ({ value: '# Pinned\n\ntext' }))
  on('fs.stat', () => file(16))

  await $.command.run({ ...RUN, command: 'xorio:preview', args: 'pinned.md' })
  const scrolled = { ...PANE, props: { ...PANE.props, scroll: { offset: 7, bodyRows: 40 } } }
  const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...scrolled })
  const bar = await terminal.find({ key: 'toolbar' })
  expect(bar?.props.position).toBe('absolute')
  expect(bar?.props.top).toBe(7)
  expect(await terminal.find({ key: 'close' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...scrolled })
  expect((await desktop.find({ key: 'toolbar' }))?.props.position).toBeUndefined()
})

test('w and n step the width, z toggles full screen and back', async ($, on) => {
  const opened: { columns?: number; rows?: number }[] = []
  world(on, opened)
  on('fs.read', () => ({ value: '# Sizes' }))
  on('fs.stat', () => file(7))

  await $.command.run({ ...RUN, command: 'xorio:preview', args: 'sizes.md' })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, viewport: { columns: 200, rows: 50 } })
  const asked = () => opened.at(-1)

  await pane.press({ key: 'wider' })
  expect(asked()?.columns).toBe(120)
  await pane.press({ key: 'wider' })
  expect(asked()?.columns).toBe(140)
  await pane.press({ key: 'narrower' })
  expect(asked()?.columns).toBe(120)

  await pane.press({ key: 'full' })
  expect(asked()).toMatchObject({ columns: 200, rows: 50 })
  expect((await pane.find({ key: 'full' }))?.props.label).toBe('exit full')
  await pane.press({ key: 'full' })
  expect(asked()?.columns).toBe(120)
  expect(asked()?.rows).toBeUndefined()

  for (let i = 0; i < 6; i++) await pane.press({ key: 'narrower' })
  expect(asked()?.columns).toBe(40)
  for (let i = 0; i < 9; i++) await pane.press({ key: 'wider' })
  expect(asked()?.columns).toBe(170)
})

test('the terminal draws tables fitted to the pane; desktop gets the Markdown table', async ($, on) => {
  world(on)
  const table = '| Skill | Invoke as | Purpose |\n|---|---|---|\n| `tests` | `/xorio:tests [--no-docs]` | Coverage-gap analysis |\n'
  on('fs.read', () => ({ value: table }))
  on('fs.stat', () => file(table.length))

  await $.command.run({ ...RUN, command: 'xorio:preview', args: 'table.md' })
  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 40 } })
  expect(await narrow.find({ type: 'Text', text: /┌/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /\[--no-docs\]/ })).toBeDefined()
  expect(await narrow.find({ type: 'Markdown' })).toBeUndefined()
  await narrow.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(String((await desktop.find({ type: 'Markdown' }))?.props.text)).toContain('| Skill |')
})
