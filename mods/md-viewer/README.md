# md-viewer: a Claude Code mod

Renders any Markdown file in a pane inside Claude Code, the same way Claude Code draws a plan or a reply: headings, emphasis, lists, tables, code fences and links. It has a file picker, a shortcut to your newest plan, live reload, and a toggle between the right half of the screen and full screen.

Built on Claude Code [mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) (function hooks, early access). It is a separate plugin from `xorio` and installs on its own.

## Use

| You type | What happens |
|---|---|
| `/md` | Opens the pane on the right half. With no file loaded yet, it opens the **file picker** in the project folder. Otherwise it shows the last file. |
| `/md README.md` | Opens a file. Paths can be relative to the project, absolute, or `~/…`. |
| `/md docs/` | Opens the picker in that folder. |
| `/md --plan` | Opens the **newest plan** in `~/.claude/plans/` (or `$CLAUDE_CONFIG_DIR/plans/`). |
| `/md <file> --full` / `--half` | Opens it full screen, or on the right half. |

**Viewer.** Buttons: **Open…**, **Full screen** / **Half screen**, **Reload**, **Close**. While the pane has the keyboard (`ctrl+x tab` or a click), the hotkeys are `o` open, `f` toggle full screen, `r` reload, and `n` / `p` for next and previous page. The arrow keys scroll, and `Esc` hands the keyboard back to the prompt.

- **Live reload.** The pane checks the file every 1.5 s and redraws when it changes on disk, without losing your page. You can watch Claude write a plan or a doc as it goes.
- **Links.** A relative link to another Markdown file (`[guide](docs/guide.md)`) opens that file in the viewer. Web links open in the browser, as usual.
- **Large files.** A file is split between blocks into `Markdown` elements of at most 10,000 characters each, never inside a code fence. Pages stay under the engine's 100,000-character limit per drawn tree. An oversized fence is closed and reopened, and an oversized table repeats its header. Reference-style links keep working across a split. Longer documents get **‹ Prev** / **Next ›** paging.
- YAML front matter shows as a `yaml` block. `\r\n` endings and control characters are normalized.

**Picker.** Quick places (**↑ Up**, **Project**, **Plans**, **Home**), then **Recent** (the last 8 files, kept across sessions), then the folder's subfolders and Markdown files. Plans are sorted newest first. Type in **Find** to filter. **Enter** opens the first match. If what you typed looks like a path (`docs/x.md`, `~/notes`, `../README.md`), Enter opens that path directly. The mobile app has no text fields yet, so there you browse with the buttons.

**Full screen and back.** In the terminal's fullscreen layout, the pane docks beside the transcript. **Half screen** asks for half the terminal's width. **Full screen** asks for all the width the layout can give, so the transcript shrinks to its minimum. On the main screen (non-fullscreen, e.g. tmux), the pane sits above the prompt and the toggle changes its height instead. If you drag the dock to a size yourself, that size wins until you toggle again or reopen the pane.

## Install

From this repo's marketplace:

```
/plugin marketplace add radumarias/xorio-claude-plugin
/plugin install md-viewer@xorio
/reload-plugins
```

For development, load it live from a checkout. Saving a file reloads the mod.

```bash
claude --plugin-dir /path/to/xorio-claude-plugin/mods/md-viewer
```

## Develop

```
hooks/hooks.json     { "modules": ["./register.tsx"] }
hooks/register.tsx   the /md command, the pane's drawing, the picker, live reload
hooks/markdown.ts    cuts a document into drawable chunks and pages; link rewriting
hooks/paths.ts       path helpers (a mod has no Node, so no node:path)
types/index.d.ts     the $.state contract (every value the pane draws from)
tests/*.test.ts      engine-run tests: commands, presses, filter input, live reload, chunking
```

```bash
claude plugin validate mods/md-viewer   # what the module hooks and calls, and what the engine would refuse
claude plugin test mods/md-viewer       # runs tests/*.test.ts against the engine
tsc -p mods/md-viewer                   # after one load, which writes .claude-plugin/types/ (gitignored)
```
