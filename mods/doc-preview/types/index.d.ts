/** What the preview pane shows. `rev` bumps when the file changes, so the pane re-reads it. */
export type DocView =
  | { kind: 'file'; path: string; rev: number }
  | { kind: 'diagram'; id: string }
  | { kind: 'picker'; dir: string }

/** A Markdown or Mermaid file Claude wrote or edited this session (absolute path). */
export type GeneratedDoc = { path: string; at: number }

/** A ```mermaid block from one of Claude's replies, keyed by a hash of its source. */
export type ReplyDiagram = { id: string; source: string; title: string; at: number }

/** One diagram drawn for inline display; svg and png stay on disk, named by path. */
export type DiagramRender =
  | { format: 'ascii'; text: string }
  | { format: 'svg'; file: string }
  | { format: 'png'; file: string; width: number; height: number }
  | { format: 'error'; message: string }

/** The pane size asked for: body columns (null, the engine's default) or the whole screen. */
export type PaneSize = { columns: number | null; isFull: boolean }

/** Which inline renderers this machine has, and whether the terminal draws pixels. */
export type Renderers = { ascii: boolean; mmdc: boolean; isKitty: boolean }

declare module 'claude-code' {
  interface PluginState {
    'doc-preview': {
      view: DocView | null
      generated: GeneratedDoc[]
      diagrams: ReplyDiagram[]
      seenAt: number
      renders: Record<string, DiagramRender>
      renderers: Renderers | null
      notice: string | null
      size: PaneSize
    }
  }
}
