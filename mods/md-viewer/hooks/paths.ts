// Path helpers: a hooks module has no Node, so no `node:path`.
// POSIX first; a Windows drive path (`C:\x`) keeps its own separator.

const ROOT = /^(?:[A-Za-z]:)?[\\/]/
const MARKDOWN = /\.(?:md|markdown|mdx|mdown|mkdn?)$/i

const separatorOf = (path: string): string => (/^[A-Za-z]:\\/.test(path) ? '\\' : '/')

export const isAbsolute = (path: string): boolean => ROOT.test(path)

export const isMarkdownPath = (path: string): boolean => MARKDOWN.test(path)

/** Folds `.`, `..` and repeated separators, as `path.normalize` does. */
export function normalize(path: string): string {
  const root = ROOT.exec(path)?.[0] ?? ''
  const parts: string[] = []
  for (const part of path.slice(root.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (part !== '..' || root === '') parts.push(part)
  }

  return root + parts.join(separatorOf(path)) || '.'
}

export const join = (dir: string, name: string): string =>
  normalize(`${dir}${separatorOf(dir)}${name}`)

export const resolve = (base: string, path: string): string =>
  isAbsolute(path) ? normalize(path) : join(base, path)

export function dirname(path: string): string {
  const clean = normalize(path)
  const root = ROOT.exec(clean)?.[0] ?? ''
  const cut = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  if (cut < 0) return '.'

  return cut < root.length ? root : clean.slice(0, cut)
}

export function basename(path: string): string {
  const clean = normalize(path)
  const cut = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))

  return clean.slice(cut + 1) || clean
}

/** `~` and `~/x` against `home`; anything else as given. */
export function expandHome(path: string, home: string): string {
  if (home === '') return path
  if (path === '~') return home

  return /^~[\\/]/.test(path) ? join(home, path.slice(2)) : path
}

/** `home/x` as `~/x`, for display. */
export function tildify(path: string, home: string): string {
  if (home === '' || home === '/') return path
  if (path === home) return '~'
  const rest = path.slice(home.length)

  return path.startsWith(home) && /^[\\/]/.test(rest) ? `~${rest}` : path
}

/** A `file:` URL for an absolute path, each segment percent-encoded. */
export function toFileHref(path: string): string {
  const posix = path.replace(/\\/g, '/')
  // Parentheses too, so the URL can stand inside a Markdown link's `(...)`.
  const encoded = posix
    .split('/')
    .map(segment => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/')

  return `file://${posix.startsWith('/') ? '' : '/'}${encoded}`
}

/** The path a `file:` URL names (its host, query and fragment dropped). */
export function fromFileHref(href: string): string | undefined {
  if (!/^file:/i.test(href)) return undefined
  let path = href.replace(/^file:(?:\/\/[^/]*)?/i, '').replace(/[?#].*$/, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // a stray `%` stays as written
  }

  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
}
