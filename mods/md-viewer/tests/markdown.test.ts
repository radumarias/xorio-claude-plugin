import { describe, expect, test } from 'claude-code/testing'

import { CHUNK_CHARS, MARKDOWN_MAX, PAGE_CHARS, blocks, chunks, paginate } from '../hooks/markdown'
import { dirname, fromFileHref, join, normalize, tildify, toFileHref } from '../hooks/paths'

const fenceCount = (text: string): number => (text.match(/^```/gm) ?? []).length

describe('markdown cutting', () => {
  test('a list item paragraph stays with its item', () => {
    expect(blocks('1. one\n\n   more of one\n\n2. two')).toEqual(['1. one\n\n   more of one', '2. two'])
  })

  test('blank lines inside a fence do not cut it', () => {
    expect(blocks('```\na\n\nb\n```\n\nafter')).toEqual(['```\na\n\nb\n```', 'after'])
  })

  test('a huge fence is split into closed fences under the bound', () => {
    const code = Array.from({ length: 2_000 }, (_, i) => `let x${i} = ${i};`).join('\n')
    const parts = chunks(`# Code\n\n\`\`\`rust\n${code}\n\`\`\`\n\nThe end.`)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(CHUNK_CHARS)
      expect(fenceCount(part) % 2).toBe(0)
    }
    expect(parts.join('\n')).toContain('let x1999 = 1999;')
  })

  test('a huge table repeats its header in every piece', () => {
    const rows = Array.from({ length: 1_500 }, (_, i) => `| ${i} | row ${i} |`).join('\n')
    const parts = chunks(`| n | name |\n|---|---|\n${rows}`)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.startsWith('| n | name |\n|---|---|\n')).toBe(true)
  })

  test('a long document becomes pages under the tree bound, nothing lost', () => {
    const section = (i: number) => `## Section ${i}\n\n${'Lorem ipsum dolor sit amet. '.repeat(40)}`
    const text = Array.from({ length: 200 }, (_, i) => section(i)).join('\n\n')
    const pages = paginate(text, '/work/LONG.md')
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeLessThanOrEqual(PAGE_CHARS)
      for (const chunk of page) expect(chunk.text.length).toBeLessThanOrEqual(MARKDOWN_MAX)
    }
    expect(pages.flat().map(chunk => chunk.text).join('\n\n')).toBe(text)
  })

  test('reference links keep their definitions across a cut', () => {
    const filler = 'Filler paragraph. '.repeat(30)
    const text = `See [the docs][docs].\n\n${Array.from({ length: 40 }, () => filler).join('\n\n')}\n\n[docs]: https://example.com/docs`
    const first = paginate(text, '/work/README.md')[0]?.[0]
    expect(first?.text).toContain('[docs]: https://example.com/docs')
  })

  test('front matter is drawn as a yaml block, control characters dropped', () => {
    const [chunk] = paginate('---\ntitle: x\n---\n# Hi\r\n\u0007there', '/w/a.md')[0] ?? []
    expect(chunk?.text).toBe('```yaml\ntitle: x\n```\n# Hi\nthere')
  })

  test('only relative Markdown links become followable file links', () => {
    const [chunk] = paginate('[a](b.md) [c](https://x.dev/d.md) [e](#f) [g](img.png)\n\n```\n[h](i.md)\n```', '/w/docs/x.md')[0] ?? []
    expect(chunk?.links).toEqual(['file:///w/docs/b.md'])
    expect(chunk?.text).toContain('[c](https://x.dev/d.md)')
    expect(chunk?.text).toContain('[h](i.md)')
  })

  test('an empty file says so', () => {
    expect(paginate('  \n', '/w/e.md')).toEqual([[{ text: '*This file is empty.*', links: [] }]])
  })
})

describe('paths', () => {
  test('normalize, join and dirname', () => {
    expect(normalize('/a/./b/../c//d')).toBe('/a/c/d')
    expect(join('/a/b', '../c.md')).toBe('/a/c.md')
    expect(dirname('/a')).toBe('/')
    expect(dirname('/')).toBe('/')
    expect(normalize('C:\\a\\..\\b')).toBe('C:\\b')
  })

  test('file hrefs round-trip, odd characters included', () => {
    const path = '/w/my notes (draft)#1.md'
    expect(fromFileHref(toFileHref(path))).toBe(path)
    expect(toFileHref(path)).not.toContain('(')
  })

  test('tildify only a whole home prefix', () => {
    expect(tildify('/home/me/x.md', '/home/me')).toBe('~/x.md')
    expect(tildify('/home/meadow/x.md', '/home/me')).toBe('/home/meadow/x.md')
  })
})
