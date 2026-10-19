/**
 * Pele 1.6.0 (MIT, https://github.com/obsidianmd/pele): `dist/pele.js` from the
 * npm package, unmodified. Only what doc-preview calls is declared here.
 * To update: copy the new `dist/pele.js` over `pele.js` and bump `PELE_VERSION`
 * in `../docs.ts` and the browser page's script URL and SRI hash.
 */
export type RenderOptions = {
  fontFamily?: string
  /** Links in the diagram (`click` lines); off here, the pane can't follow them. */
  links?: boolean
  images?: boolean
}
export type RenderResult = { svg: string }
/** Mermaid source to a standalone SVG string; throws on syntax it can't read. */
export function render(source: string, options?: RenderOptions): RenderResult
