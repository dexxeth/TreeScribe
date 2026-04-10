# Project Tree Extension

Generate clean project trees with layered ignore rules and export them as
Markdown, JSON, or HTML.

## Features

- Layered ignore system:
    - Built-in defaults for common noisy folders and files.
    - `.gitignore` support.
    - Optional `.projecttreeignore` support.
    - Additional ignore patterns from settings.
- Safe traversal:
    - Directories-first sorting.
    - Graceful permission-error handling.
    - Symlink-safe traversal (follow optional, circular links guarded).
- Per-run interactive flow:
    - Prompt to choose icons or text-only output.
    - Prompt to choose export formats for that run.
- Multi-format export:
    - Markdown (`project_tree.md` by default).
    - JSON (`project_tree.json` by default).
    - HTML (`project_tree.html` by default).
- Explorer integration:
    - Right-click any folder and generate from that subfolder.
- README marker injection:
    - Inject/update tree between `PROJECT-TREE:START` and `PROJECT-TREE:END`.
- Rich metadata:
    - Scan duration.
    - Ignore and skip counters with reason breakdown.
    - Total scanned file size.
    - Top file-type breakdown.
    - Effective settings snapshot used for the run.

## Commands

- `projectTree.generate` - Generate Project Tree
- `projectTree.generateFromHere` - Generate Project Tree From Here

## Shortcuts

- `Ctrl+Shift+T` (Windows/Linux)
- `Cmd+Shift+T` (macOS)

Note: This shortcut may conflict with existing VS Code keybindings. Rebind in
Keyboard Shortcuts if needed.

## Settings

| Key                               | Default               | Description                                              |
| --------------------------------- | --------------------- | -------------------------------------------------------- |
| `projectTree.additionalIgnore`    | `[]`                  | Extra ignore patterns.                                   |
| `projectTree.maxDepth`            | `10`                   | Maximum scan depth.                                      |
| `projectTree.showFileSize`        | `true`                | Show file sizes next to files.                           |
| `projectTree.followSymlinks`      | `false`               | Follow symlinks during traversal.                        |
| `projectTree.binaryHandling`      | `mark`                | `off`, `mark`, or `skip` for binary files.               |
| `projectTree.asciiOnly`           | `false`               | Render text-only tree (no icons).                        |
| `projectTree.iconSource`          | `bundled`             | `bundled`, `local`, or `remote`.                         |
| `projectTree.iconAssetsDirectory` | `.project-tree-icons` | Local icon directory (used when icon source is `local`). |
| `projectTree.outputFileName`      | `project_tree.md`     | Markdown output path.                                    |
| `projectTree.outputJsonFileName`  | `project_tree.json`   | JSON output path.                                        |
| `projectTree.outputHtmlFileName`  | `project_tree.html`   | HTML output path.                                        |
| `projectTree.exportFormats`       | `['markdown']`        | Default export formats.                                  |
| `projectTree.injectIntoReadme`    | `true`                | Inject tree into README markers if found.                |

## Icon Rendering

- `bundled` (recommended): Uses vendored icon assets shipped with the extension.
- `local`: Downloads missing icons to the configured local icon directory.
- `remote`: Uses CDN icon URLs.
- If you choose "Without Icons" in the command prompt, output is text-only for
  that run regardless of icon source.

## Generated Metadata

Each run includes:

- `Scan Duration` (milliseconds)
- `Ignored` count
- `Skipped` count and reason split:
    - `binary`
    - `symlink`
    - `circular`
    - `permission`
    - `fs`
- `Total Size`
- `Top Types` (extension breakdown)
- `Effective Settings` snapshot:
    - max depth
    - symlink mode
    - binary mode
    - icon mode
    - export formats

## README Injection

If `projectTree.injectIntoReadme` is enabled and root `README.md` contains both
markers below, the tree snippet is replaced between them:

```markdown
<!-- PROJECT-TREE:START -->
<!-- PROJECT-TREE:END -->
```

## Vendoring Icon Pack

Download and cache the full icon set into `assets/icons/`:

```bash
npm run icons:vendor
```

This is also called by `vscode:prepublish`.

## Run This Project

```bash
npm install
npm run icons:vendor
npm run compile
```

Then in VS Code:

1. Press `F5` to launch the Extension Development Host.
2. Open Command Palette and run `Generate Project Tree`.
3. Choose icon mode for this run.
4. Choose export formats for this run.

Alternative:

1. Right-click any folder in Explorer.
2. Run `Generate Project Tree From Here`.

## Publish/Package

```bash
npm run icons:vendor
npm run compile
npx @vscode/vsce package
```

Then publish with `vsce publish` after setting your publisher and token.

## Troubleshooting

- `Generate Project Tree` is a VS Code command, not a shell command. Run it from
  Command Palette or Explorer context menu.
- If icons do not appear as expected, check icon source and run choice (with
  icons vs without icons).
