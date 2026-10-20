// .tsx, not .ts: the repo's bare `node --test` runs *.test.ts files, and these
// belong to `claude plugin test`, which runs both.
import { describe, expect, test } from 'claude-code/testing'

import {
  asciiSource,
  classToFlowchart,
  ganttChart,
  pieChart,
  stateToFlowchart,
  textChart,
  diagramTitle,
  expandPath,
  flattenPeleSvg,
  formatFor,
  imageBox,
  inlineRuns,
  layoutColumns,
  pngSize,
  PELE_VERSION,
  PELE_THEMES,
  peleSvg,
  peleSvgAdaptive,
  previewHtml,
  rasterArgv,
  rendererError,
  renderKey,
  schemeFor,
  splitDoc,
  stripAnsi,
  tableAsList,
  tableLines,
  wrapRuns,
} from '../hooks/docs'
import type { Table, TableLine } from '../hooks/docs'

describe('splitDoc', () => {
  test('pulls ```mermaid blocks out of Markdown, in order', () => {
    const doc = '# Plan\n\nIntro\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nAfter\n\n```ts\nconst x = 1\n```\n'
    expect(splitDoc(doc, false)).toEqual([
      { kind: 'prose', text: '# Plan\n\nIntro\n' },
      { kind: 'mermaid', source: 'graph TD\n  A-->B' },
      { kind: 'prose', text: '\nAfter\n\n```ts\nconst x = 1\n```\n' },
    ])
  })

  test('a fence closes only on its own marker, at least as long', () => {
    const doc = '~~~~mermaid\nsequenceDiagram\n~~~\nA->>B: hi\n~~~~'
    expect(splitDoc(doc, false)).toEqual([
      { kind: 'mermaid', source: 'sequenceDiagram\n~~~\nA->>B: hi' },
    ])
  })

  test('a mermaid fence quoted inside another fence stays Markdown', () => {
    const doc = '````md\n```mermaid\ngraph TD\n```\n````'
    expect(splitDoc(doc, false)).toEqual([{ kind: 'prose', text: doc }])
  })

  test('an unclosed mermaid fence is shown as written', () => {
    expect(splitDoc('x\n```mermaid\ngraph TD', false)).toEqual([
      { kind: 'prose', text: 'x\n```mermaid\ngraph TD' },
    ])
  })

  test('a .mmd file is one diagram', () => {
    expect(splitDoc('\ngraph LR\n  A-->B\n', true)).toEqual([
      { kind: 'mermaid', source: 'graph LR\n  A-->B' },
    ])
  })
})

describe('tables', () => {
  const source = [
    '| Skill | Invoke as | Purpose |',
    '|:---|:---:|---:|',
    '| `tests` | `/xorio:tests [--no-docs]` | Coverage-gap analysis |',
    '| `x` | `a\\|b` | |',
  ].join('\n')
  const tableOf = (markdown: string): Table => {
    const block = splitDoc(markdown, false).find(b => b.kind === 'table')
    if (block?.kind !== 'table') throw new Error('no table found')
    return block.table
  }
  const textOf = (line: TableLine) => line.map(run => run.text).join('')
  const widthOf = (line: TableLine) => [...textOf(line)].length

  test('splitDoc finds a table between prose, and leaves a fenced one alone', () => {
    expect(splitDoc(`Intro\n\n${source}\n\nAfter`, false).map(b => b.kind)).toEqual(['prose', 'table', 'prose'])
    const table = tableOf(source)
    expect(table.align).toEqual(['left', 'center', 'right'])
    expect(table.rows[1]).toEqual(['`x`', '`a\\|b`', ''])
    expect(splitDoc(`\`\`\`\n${source}\n\`\`\``, false).map(b => b.kind)).toEqual(['prose'])
  })

  test('inlineRuns keeps code, bold and link text, and drops their markup', () => {
    expect(inlineRuns('run `a|b` with **care**, see [docs](x.md)')).toEqual([
      { text: 'run ' },
      { text: 'a|b', code: true },
      { text: ' with ' },
      { text: 'care', bold: true },
      { text: ', see ' },
      { text: 'docs', link: true },
    ])
  })

  test('wrapRuns breaks at spaces, and inside a word only when it is wider than the line', () => {
    const wrap = (text: string, width: number) => wrapRuns([{ text }], width).map(textOf)
    expect(wrap('one two three', 7)).toEqual(['one two', 'three'])
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  test('layoutColumns keeps widths that fit, else caps the widest at one level', () => {
    expect(layoutColumns([10, 20], [3, 3], 40)).toEqual([10, 20])
    expect(layoutColumns([10, 50], [3, 3], 40)).toEqual([10, 30])
    expect(layoutColumns([30, 50], [3, 3], 40)).toEqual([20, 20])
    expect(layoutColumns([30, 50], [25, 25], 40)).toBeNull()
  })

  test('tableLines draws a table at its natural width when it fits', () => {
    const lines = tableLines(tableOf(source), 200) ?? []
    expect(lines.every(line => widthOf(line) === 60)).toBe(true)
    expect(textOf(lines[0] ?? [])).toBe(`┌${'─'.repeat(7)}┬${'─'.repeat(26)}┬${'─'.repeat(23)}┐`)
  })

  test('tableLines fits a narrow pane by wrapping cells inside their column', () => {
    const lines = tableLines(tableOf(source), 40) ?? []
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every(line => widthOf(line) === 40)).toBe(true)
    const texts = lines.map(textOf)
    expect(texts.some(text => text.includes('/xorio:tests ') && !text.includes('[--no-docs]'))).toBe(true)
    expect(texts.some(text => text.includes('[--no-docs]'))).toBe(true)
    expect(lines[1]?.some(run => run.bold === true && run.text === 'Skill')).toBe(true)
  })

  test('tableLines gives up when even narrow columns cannot fit', () => {
    expect(tableLines(tableOf(source), 20)).toBeNull()
  })

  test('tableAsList: one item per row, `header: cell` under it', () => {
    expect(tableAsList(tableOf(source))).toBe(
      [
        '- **`tests`**',
        '  - Invoke as: `/xorio:tests [--no-docs]`',
        '  - Purpose: Coverage-gap analysis',
        '- **`x`**',
        '  - Invoke as: `a|b`',
      ].join('\n'),
    )
  })
})

describe('expandPath', () => {
  test('relative, parent, home, quoted and file:// paths', () => {
    expect(expandPath('docs/a.md', '/p', '/h')).toBe('/p/docs/a.md')
    expect(expandPath('../x.md', '/p/q', '/h')).toBe('/p/x.md')
    expect(expandPath('~/n.md', '/p', '/h')).toBe('/h/n.md')
    expect(expandPath('"/abs/a b.md"', '/p', '/h')).toBe('/abs/a b.md')
    expect(expandPath('file:///tmp/a%20b.md', '/p', '/h')).toBe('/tmp/a b.md')
  })
})

describe('diagramTitle', () => {
  test('the diagram type, with a frontmatter title when there is one', () => {
    expect(diagramTitle('flowchart TD\nA-->B')).toBe('flowchart')
    expect(diagramTitle('---\ntitle: Login\n---\nsequenceDiagram\nA->>B: hi')).toBe('sequenceDiagram: Login')
    expect(diagramTitle('%% a comment\ngraph LR')).toBe('graph')
  })
})

describe('diagrams mermaid-ascii cannot draw', () => {
  test('pieChart draws bars scaled to the largest slice, with value and share', () => {
    const lines = (pieChart('pie title Orders\n  "Web" : 60\n  "App" : 30\n  "API" : 10', 40) ?? '').split('\n')
    expect(lines.slice(0, 2)).toEqual(['Orders', ''])
    expect(lines.slice(2).map(line => /█+/.exec(line)?.[0].length)).toEqual([24, 12, 4])
    expect(lines.slice(2).every(line => [...line].length === 40)).toBe(true)
    expect(lines[2]).toMatch(/^Web +█+ 60 +60\.0%$/)
    expect(pieChart('pie\n  "x" : nope', 40)).toBeNull()
  })

  test('ganttChart lays tasks on a day scale under their sections', () => {
    const source = [
      'gantt',
      '  title Plan',
      '  dateFormat YYYY-MM-DD',
      '  section Build',
      '    API   :done, a1, 2026-10-01, 5d',
      '    Stock :a2, after a1, 5d',
      '  section Ship',
      '    Go    :milestone, after a2, 0d',
    ].join('\n')
    const lines = (ganttChart(source, 40) ?? '').split('\n')
    expect(lines.slice(0, 2)).toEqual(['Plan', ''])
    expect(lines[2]).toContain('2026-10-01')
    expect(lines[2]).toContain('2026-10-11')
    expect(lines[3]).toBe('Build')
    expect(lines[4]).toMatch(/^ {2}API +▒+$/)
    expect(lines[5]).toMatch(/^ {2}Stock +█+$/)
    expect(lines[6]).toBe('Ship')
    expect(lines[7]).toMatch(/◆$/)
    expect(ganttChart('gantt\n  dateFormat DD-MM-YYYY\n  A :01-10-2026, 1d', 40)).toBeNull()
  })

  test('stateToFlowchart turns transitions into labelled edges and [*] into start and end', () => {
    expect(stateToFlowchart('stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: job\n  Busy --> [*]')).toBe(
      [
        'flowchart LR',
        '  START[start]',
        '  Idle[Idle]',
        '  Busy[Busy]',
        '  END[end]',
        '  START --> Idle',
        '  Idle -->|job| Busy',
        '  Busy --> END',
      ].join('\n'),
    )
    expect(stateToFlowchart('stateDiagram-v2\n  state Outer {\n    A --> B\n  }')).toBeNull()
  })

  test('classToFlowchart keeps classes and relationships, drops members', () => {
    const source = [
      'classDiagram',
      '  class Animal {',
      '    +name: string',
      '  }',
      '  Animal <|-- Dog',
      '  Owner "1" --> "*" Dog : walks',
      '  Dog : +bark()',
    ].join('\n')
    expect(classToFlowchart(source)).toBe(
      [
        'flowchart LR',
        '  Animal[Animal]',
        '  Dog[Dog]',
        '  Owner[Owner]',
        '  Dog -->|extends| Animal',
        '  Owner -->|walks| Dog',
      ].join('\n'),
    )
  })

  test('a Windows-saved diagram keeps its frontmatter title and kind', () => {
    const source = '---\r\ntitle: Shares\r\n---\r\npie\r\n  "a" : 1\r\n'
    expect(diagramTitle(source)).toBe('pie: Shares')
    expect(textChart(source, 40)).toContain('Shares')
  })

  test('classDiagram-v2 is converted like classDiagram', () => {
    expect(asciiSource('classDiagram-v2\n  A <|-- B')).toContain('B -->|extends| A')
  })

  test('textChart and asciiSource route each kind', () => {
    expect(textChart('flowchart LR\n  A --> B', 40)).toBeNull()
    expect(asciiSource('flowchart LR\n  A --> B')).toBe('flowchart LR\n  A --> B')
    expect(asciiSource('stateDiagram\n  A --> B')).toContain('flowchart LR')
  })
})

describe('rendering helpers', () => {
  test('stripAnsi keeps text, tabs and newlines', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m\r\n\tx')).toBe('red\n\tx')
  })

  test('rendererError unwraps a logrus line and names an unsupported kind', () => {
    const fatal = (msg: string) => `time="2026-10-06T14:17:21+03:00" level=fatal msg="${msg}"`
    expect(rendererError(fatal("failed to parse graph diagram: unsupported graph type 'pie'. Supported types: 'graph'"), 'pie')).toBe(
      "mermaid-ascii can't draw pie diagrams",
    )
    expect(rendererError(fatal('bad edge \\"A--\\"'), 'flowchart')).toBe('bad edge "A--"')
    expect(rendererError('\n  Error: Chromium not found\n', 'flowchart')).toBe('Error: Chromium not found')
  })

  test('pngSize reads the IHDR chunk', () => {
    expect(pngSize('iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQCAYAAAA=')).toEqual({ width: 800, height: 400 })
    expect(pngSize('aGVsbG8gd29ybGQsIG5vdCBhIHBuZyBhdCBhbGw=')).toBeNull()
  })

  test('imageBox keeps the aspect for cells twice as tall as wide', () => {
    expect(imageBox({ width: 1600, height: 800 }, 200)).toEqual({ columns: 100, rows: 25 })
    expect(imageBox({ width: 1600, height: 800 }, 40)).toEqual({ columns: 40, rows: 10 })
  })

  test('formatFor picks pixels, text or nothing per surface', () => {
    const all = { ascii: true, mmdc: false, rasterizer: 'resvg' as const, drawsImages: false, scheme: 'dark' as const }
    expect(formatFor('terminal', { ...all, drawsImages: true })).toBe('png')
    expect(formatFor('terminal', { ...all, drawsImages: true, rasterizer: null, mmdc: true })).toBe('png')
    expect(formatFor('terminal', { ...all, drawsImages: true, rasterizer: null })).toBe('ascii')
    expect(formatFor('terminal', all)).toBe('ascii')
    expect(formatFor('terminal', { ...all, ascii: false })).toBeNull()
    expect(formatFor('terminal', null)).toBeNull()
    // Pele is built in: the GUI surfaces draw SVG whatever is installed.
    expect(formatFor('desktop', { ...all, rasterizer: null })).toBe('svg')
    expect(formatFor('vscode', null)).toBe('svg')
  })
})

describe('pele', () => {
  test('peleSvg draws every kind as one self-contained SVG in the scheme asked, no CSS variables left', () => {
    const kinds = [
      'flowchart LR\n  A[Start] --> B{ok?}\n  B -->|yes| C[Done]',
      'sequenceDiagram\n  Alice->>Bob: hi\n  Bob-->>Alice: hello',
      'classDiagram\n  Animal <|-- Duck',
      'stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]',
      'erDiagram\n  USER ||--o{ ORDER : places',
      'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2',
      'gantt\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-01-01, 3d',
      'mindmap\n  root((x))\n    a\n    b',
    ]
    for (const source of kinds) {
      for (const scheme of ['light', 'dark'] as const) {
        const svg = peleSvg(source, scheme)
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg.includes('var(')).toBe(false)
        expect(svg.includes(`<rect width="100%" height="100%" fill="${PELE_THEMES[scheme].bg}"/>`)).toBe(true)
      }
    }
    expect(peleSvg('flowchart LR\n  A --> B', 'dark').includes(PELE_THEMES.dark.fg)).toBe(true)
  })

  test('peleSvgAdaptive keeps the variables and turns dark under prefers-color-scheme', () => {
    const svg = peleSvgAdaptive('flowchart LR\n  A --> B')
    expect(svg.includes('<rect width="100%" height="100%" fill="var(--_bg)"/>')).toBe(true)
    expect(svg.includes(`@media (prefers-color-scheme: dark){svg{--pele-bg:${PELE_THEMES.dark.bg};`)).toBe(true)
  })

  test('renderKey keeps a PNG per scheme and one SVG for both', () => {
    const source = 'flowchart LR\n  A --> B'
    expect(renderKey(source, 'png', 'light')).not.toBe(renderKey(source, 'png', 'dark'))
    expect(renderKey(source, 'svg', 'light')).toBe(renderKey(source, 'svg', 'dark'))
  })

  test('schemeFor reads the theme setting, then COLORFGBG, then says dark', () => {
    expect(schemeFor('light', undefined)).toBe('light')
    expect(schemeFor('light-daltonized', '15;0')).toBe('light')
    expect(schemeFor('dark-ansi', '0;15')).toBe('dark')
    expect(schemeFor('auto', '0;15')).toBe('light')
    expect(schemeFor('auto', '15;0')).toBe('dark')
    expect(schemeFor('auto', '0;default;7')).toBe('light')
    expect(schemeFor(undefined, undefined)).toBe('dark')
  })

  test('flattenPeleSvg resolves both levels of variables, theme first, then the fallback', () => {
    const svg = '<svg style="--_fg:var(--pele-fg,#111);--_r:var(--pele-radius,4px);font-family:var(--pele-font,sans-serif)" fill="var(--_fg)"><rect rx="var(--_r)"/></svg>'
    expect(flattenPeleSvg(svg, { fg: '#abc' })).toBe('<svg style="font-family:sans-serif" fill="#abc"><rect rx="4px"/></svg>')
  })

  test('flattenPeleSvg leaves a label that reads like a variable as written', () => {
    // Pele wraps it on two lines.
    const svg = peleSvg('flowchart LR\n  A["var(--_fg) and --_x:var(--pele-bg,red);"] --> B', 'dark')
    expect(svg.includes('>var(--_fg) and<')).toBe(true)
    expect(svg.includes('>--_x:var(--pele-bg,red);<')).toBe(true)
  })

  test('peleSvg throws on a diagram it cannot read', () => {
    expect(() => peleSvg('not a diagram at all', 'light')).toThrow()
  })

  test('rasterArgv doubles the size with either tool', () => {
    expect(rasterArgv('resvg', '/c/a.svg', '/c/a.png')).toEqual(['resvg', '--zoom', '2', '/c/a.svg', '/c/a.png'])
    expect(rasterArgv('rsvg-convert', '/c/a.svg', '/c/a.png')).toEqual(['rsvg-convert', '--zoom', '2', '--output', '/c/a.png', '/c/a.svg'])
  })
})

describe('previewHtml', () => {
  test('embeds the source so it cannot close the script, and escapes the title', () => {
    const html = previewHtml({ title: '<b>x</b>', source: '</script><script>alert(1)</script>', isMermaid: false })
    expect(html.includes('</script><script>alert(1)')).toBe(false)
    expect(html.includes('\\u003c/script>')).toBe(true)
    expect(html.includes('<title>&#60;b&#62;x&#60;/b&#62;</title>')).toBe(true)
  })

  test('draws diagrams with the pinned pele build, not mermaid.js', () => {
    const html = previewHtml({ title: 't', source: 'graph TD\n  A-->B', isMermaid: true })
    expect(html.includes(`npm/pele@${PELE_VERSION}/dist/pele.global.js" integrity="sha384-`)).toBe(true)
    expect(html.includes('mermaid.min.js')).toBe(false)
  })
})
