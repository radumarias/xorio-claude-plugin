import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, PaneOpenArgs, RenderPropsOf } from 'claude-code'

const README = '# Project\n\nSome **bold** text.\n\n- one\n- two\n\nSee the [guide](docs/guide.md).\n'
const GUIDE = '# Guide\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
const OLD_PLAN = '# Old plan\n'
const NEW_PLAN = '# New plan\n\n1. Do the thing\n'
const PLANS = '/home/me/.claude/plans'

const PANE: RenderPropsOf['Pane'] = {
  title: 'Markdown',
  isFocused: true,
  bodyColumns: 96,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const SCREEN = { columns: 200, rows: 50, isFullscreen: true }
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

type File = { text: string; mtimeMs: number }

/** A small disk, a terminal that places every pane, and a log of the opens. */
function world(on: On) {
  const files = new Map<string, File>([
    ['/work/README.md', { text: README, mtimeMs: 1 }],
    ['/work/docs/guide.md', { text: GUIDE, mtimeMs: 1 }],
    [`${PLANS}/old-plan.md`, { text: OLD_PLAN, mtimeMs: 1 }],
    [`${PLANS}/new-plan.md`, { text: NEW_PLAN, mtimeMs: 5 }],
  ])
  const dirs = new Set(['/work', '/work/docs', '/work/src', '/work/.git', PLANS])
  const opens: PaneOpenArgs[] = []

  const entries = (dir: string): FsEntry[] => {
    const below = (path: string) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')
    const name = (path: string) => path.slice(dir.length + 1)
    const extra: FsEntry[] = dir === '/work' ? [{ name: 'main.rs', kind: 'file', size: 9, mtimeMs: 1, isLink: false }] : []

    return [
      ...[...dirs].filter(below).map(path => ({ name: name(path), kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
      ...[...files]
        .filter(([path]) => below(path))
        .map(([path, file]) => ({ name: name(path), kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false })),
      ...extra,
    ]
  }

  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.list', (_$, e) => (dirs.has(e.path) ? { value: entries(e.path) } : { deny: `ENOENT: ${e.path}` }))
  on('fs.stat', (_$, e) => {
    const file = files.get(e.path)
    if (file !== undefined) return { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }

    return dirs.has(e.path)
      ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
      : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.read', (_$, e) => {
    const file = files.get(e.path)

    return file === undefined ? { deny: `ENOENT: ${e.path}` } : { value: file.text }
  })
  on('ui.open', (_$, e) => {
    opens.push(e)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: [{ id: 'md-viewer', title: 'Markdown', isShown: true, isFocused: true, isPlaced: true }],
  }))
  on('ui.scroll', () => ({}))
  on('ui.close', () => ({ value: undefined }))

  return { files, opens, clock }
}

const mountPane = <P extends 'terminal' | 'desktop' | 'mobile'>($: Engine, surface: P) =>
  $.ui.mount({ plugin: 'md-viewer', surface, component: 'Pane', requestId: 'md-viewer', props: PANE, viewport: SCREEN })

describe('md-viewer', () => {
  test('/md <file> renders it in the right half, and toggles full screen and back', async ($, on) => {
    const { opens } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const ran = await $.command.run({ command: 'md', args: 'README.md', ...TYPED })
    expect(ran.text).toContain('README.md')
    expect(opens.at(-1)).toMatchObject({ id: 'md-viewer', columns: 100 })

    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Markdown', text: /Some \*\*bold\*\* text/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /README\.md/ })).toBeDefined()
      await ui.unmount()
    }

    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'size' })
    expect(opens.at(-1)).toMatchObject({ id: 'md-viewer', columns: 1000, rows: 1000 })
    expect(await ui.find({ type: 'Button', text: 'Half screen' })).toBeDefined()

    await ui.press({ key: 'size' })
    expect(opens.at(-1)).toMatchObject({ id: 'md-viewer', columns: 100, rows: 25 })
    expect(await ui.find({ type: 'Button', text: 'Full screen' })).toBeDefined()
  })

  test('/md --full opens it full screen', async ($, on) => {
    const { opens } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    await $.command.run({ command: 'md', args: 'README.md --full', ...TYPED })
    expect(opens.at(-1)).toMatchObject({ columns: 1000 })
  })

  test('the picker lists folders and Markdown files and opens one', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const ran = await $.command.run({ command: 'md', args: '', ...TYPED })
    expect(ran.text).toContain('Pick a Markdown file')

    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Button', text: 'docs/' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'README.md' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'main.rs' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: '.git' })).toBeUndefined()

    const docs = await ui.find({ type: 'Button', text: 'docs/' })
    await ui.press({ key: String(docs?.key) })
    expect(await ui.find({ type: 'Button', text: 'guide.md' })).toBeDefined()

    await ui.input({ key: 'filter', text: 'gui', kind: 'change' })
    await ui.input({ key: 'filter', text: 'gui' })
    expect(await ui.find({ type: 'Markdown', text: /# Guide/ })).toBeDefined()
  })

  test('a typed path opens from the filter, a missing one says why', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'md', args: '', ...TYPED })
    const ui = await mountPane($, 'terminal')

    await ui.input({ key: 'filter', text: './nope.md' })
    expect(await ui.find({ type: 'Text', text: /Cannot open \/work\/nope\.md/ })).toBeDefined()

    await ui.input({ key: 'filter', text: 'docs/guide.md' })
    expect(await ui.find({ type: 'Markdown', text: /# Guide/ })).toBeDefined()
  })

  test('a relative link to a Markdown file opens it in the viewer', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'md', args: 'README.md', ...TYPED })
    const ui = await mountPane($, 'terminal')

    const body = await ui.find({ type: 'Markdown', text: /guide/ })
    expect(body?.props.text).toContain('](file:///work/docs/guide.md)')
    await ui.press({ key: String(body?.key), link: { href: 'file:///work/docs/guide.md' } })
    expect(await ui.find({ type: 'Markdown', text: /# Guide/ })).toBeDefined()
  })

  test('/md --plan opens the newest plan', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const ran = await $.command.run({ command: 'md', args: '--plan', ...TYPED })
    expect(ran.text).toContain('new-plan.md')
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Markdown', text: /# New plan/ })).toBeDefined()
  })

  test('the shown file reloads when it changes on disk', async ($, on) => {
    const { files, clock } = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'md', args: 'README.md', ...TYPED })
    const ui = await mountPane($, 'terminal')

    files.set('/work/README.md', { text: '# Project\n\nRewritten by Claude.\n', mtimeMs: 2 })
    await clock.advance(2_000)
    expect(await ui.find({ type: 'Markdown', text: /Rewritten by Claude/ })).toBeDefined()
  })

  test('Open… goes back to the picker, with the file in Recent', async ($, on) => {
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'md', args: 'docs/guide.md', ...TYPED })
    const ui = await mountPane($, 'terminal')

    await ui.press({ key: 'pick' })
    expect(await ui.find({ type: 'Text', text: 'Recent' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: '/work/docs/guide.md' })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Markdown', text: /# Guide/ })).toBeDefined()
  })
})
