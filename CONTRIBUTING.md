# Contributing to Forma

Thanks for helping. Forma is a desktop app (Tauri 2 + React) for documents, spreadsheets,
forms, PDFs and personal tracking. Everything runs offline on the user's computer, and that
promise shapes most of the rules below.

## Getting set up

You need Node 22 or newer, stable Rust, and on Linux the WebKitGTK libraries:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf
npm install
npm run tauri dev
```

`npm run tauri dev` opens the desktop window with hot reload. `npm run dev` serves the same
UI in a browser at http://127.0.0.1:1420, which is quicker for layout work; features that need
the desktop shell (native save dialogs, "Open with", updates) only work in the Tauri window.

Before opening a pull request, make sure both of these pass:

```sh
npm run build                                   # type-check and bundle the UI
cargo check --manifest-path src-tauri/Cargo.toml
```

## Where things live

| Path | What's there |
| --- | --- |
| `src/App.tsx` | Window shell: sidebar, app switcher, shortcuts, settings |
| `src/CommandPalette.tsx` | `Ctrl+K` palette |
| `src/Home.tsx` | File list for each app |
| `src/apps/` | One folder or file per app: Docs, Sheets, Forms, PDF, Tracker |
| `src/lib/store.ts` | File storage (IndexedDB) |
| `src/lib/useFile.ts` | Load a file and autosave changes |
| `src/lib/importers.ts` | Turning files from disk into Forma files |
| `src/lib/platform.ts` | The bridge between browser and native APIs |
| `src/lib/dialog.tsx` | In-app dialogs and toasts |
| `src/ui.tsx` | Shared components: logo, app icons, menus, modal |
| `src/styles.css` | The whole design system, one section per area |
| `src-tauri/` | Rust shell, window config, permissions, icons |

## Ground rules

- **Stay offline by default.** Don't add analytics, remote fonts or new network requests. Forma
  only goes online for the update check against GitHub Releases and, when the user sets it up,
  online forms against the user's own Supabase project (`src/lib/online.ts`).
- **Use the platform bridge.** Save files with `saveAs` from `src/lib/platform.ts`, and ask the
  user things with `askText`, `askConfirm` and `toast` from `src/lib/dialog.tsx`. Browser
  `prompt`, `confirm` and `alert` don't work reliably inside OS webviews.
- **Keep permissions small.** If you need a new Tauri permission, add only that permission to
  `src-tauri/capabilities/default.json` and say why in the pull request.
- **Don't break existing files.** Data is stored on users' machines. If you change the shape
  of a file type in `src/apps/*/types.ts`, keep reading the old shape.

## Design

Forma has one visual language. Please keep new UI inside it:

- Black and near-black surfaces with neutral greys. Cyan (`--cyan`) marks focus, the current
  selection and at most one primary action per screen.
- Use the tokens in `:root` in `src/styles.css`; don't hard-code new colors.
- Icons come from `lucide-react`. No emoji in the interface.
- Every new screen needs a loading state, an empty state that tells people what to do, and
  visible keyboard focus.
- Write labels in sentence case, from the user's point of view ("Download PDF", not "Export
  artifact").
- Don't change the logo.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat(sheets): add VLOOKUP`, `fix(pdf): keep annotations when deleting a page`.
  Keep the subject under 72 characters and use the body to explain why, when it isn't obvious.
- Keep pull requests focused on one change. Include screenshots for anything visual.
- Link the issue you're fixing, if there is one.

## Reporting bugs

Open an issue with your operating system, the Forma version (Settings shows it), what you did,
what you expected, and what happened. If a specific file triggers the problem and you can share
it, attach it; otherwise describe it (for example "a 40-page scanned PDF").

## Security

Please don't open a public issue for security problems. Report them privately from the
repository's **Security** tab (**Report a vulnerability**), and allow time for a fix to ship
before disclosing.

Release builds are signed with a private key that only the maintainers hold. Never commit
`*.key` files or paste a key into an issue or pull request.

## License

Forma is released under the [MIT License](LICENSE). By contributing, you agree that your
contributions are licensed under the same terms.
