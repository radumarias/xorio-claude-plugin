/** The file the viewer shows: where it is, its text, and what it was when read. */
export type MdDoc = { path: string; text: string; size: number; mtimeMs: number }

/** One row of the picker: a folder, or a Markdown file in it. */
export type MdEntry = { name: string; isDir: boolean; size: number; mtimeMs: number }

/** The folder the picker shows, its rows, and why it could not be listed. */
export type MdListing = { dir: string; entries: MdEntry[]; error?: string }

/** Which face the pane shows: the file picker or the rendered file. */
export type MdMode = 'pick' | 'read'

/** The picker's quick places: the project, Claude Code's plans folder, home. */
export type MdPlaces = { cwd: string; home: string; plans: string }

declare module 'claude-code' {
  interface PluginState {
    'md-viewer': {
      mode: MdMode
      doc: MdDoc | null
      page: number
      listing: MdListing
      filter: string
      notice: string
      isExpanded: boolean
      recent: string[]
      places: MdPlaces
    }
  }
}
