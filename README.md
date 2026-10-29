# Forma

Documents, spreadsheets, forms, PDFs and a personal tracker in one desktop app. Your files live on
your computer and Forma works fully offline. It only uses the network for the optional features
listed under [Privacy](#privacy).

[Download](https://kingvic300.github.io/Forma/) · [Latest release](https://github.com/Kingvic300/Forma/releases/latest) · [Contributing](CONTRIBUTING.md)

## What's inside

Switch apps from the box in the top-left corner, or with `Ctrl+1` … `Ctrl+6`. Press `Ctrl+K` to
search every file across all apps.

| App | What it does |
| --- | --- |
| **Files** | Everything you've made or opened, in one place. |
| **Docs** | Rich-text documents with headings, fonts, colors, lists, tables, images and find & replace. Opens `.docx`, `.html`, `.txt` and `.md`. Exports Word (`.doc`), HTML, text, or PDF through the print dialog. |
| **Sheets** | Spreadsheets with formulas (`SUM`, `AVERAGE`, `IF`, `COUNTIF`, `SUMIF`, `ROUND`, text functions and more), multiple tabs, sort, filter, copy/paste and undo. Opens `.csv`, `.tsv`, `.xlsx`, `.xls` and `.ods`. Exports `.csv` and `.xlsx`. |
| **Forms** | Build a form, fill it in, and collect answers. Optionally share it by link. |
| **PDF** | Edit text already printed on a page, or add text, dates, ticks, images, signatures and initials. Draw lines, boxes and highlights. Fill form fields, merge PDFs, and reorder, insert or delete pages. See below. |
| **Tracker** | Tasks with due dates and priority, daily habits with streaks, and a daily note. |

### PDF editor

- **Edit anything.** Double-click printed text to change it. Every shape, image and mark can be
  moved, resized from any corner or edge, and recolored. Boxes, images and marks can be rotated,
  and lines have a handle on each end.
- **Undo and redo.** `Ctrl+Z` and `Ctrl+Y` (or `Ctrl+Shift+Z`) cover every change, including page
  moves and form fields.
- **Zoom.** `Ctrl` + wheel, pinch, or `Ctrl` + `+` / `-` zooms the PDF. `Ctrl+0` resets it.
- **Black out.** Anything under a black box is removed for good from the downloaded copy, not just
  hidden. Pages with black boxes are saved as pictures so the words can't be copied or searched.
- **Ask AI.** Open the **AI** panel and describe a change in plain words, such as "change the date
  to 5 May 2026" or "add a red box around the total". The AI's edits arrive as ordinary
  annotations, and one `Ctrl+Z` undoes the whole answer. It needs your own free
  [Groq](https://console.groq.com) API key. See [Privacy](#privacy).

### Sharing forms online

To let anyone fill in a form from a link, Forma keeps that form and its answers in a free
[Supabase](https://supabase.com) project that you own. Set it up once from **Settings → Online
forms**, where Forma shows each step and gives you the setup code. Then click **Share** on any form.

Only the project's public key goes into links. Respondents can read the form and send answers, but
can't read anyone's answers. Reading answers or changing the form needs an owner code that stays on
your computer.

## Privacy

Your files never leave your computer unless you choose one of these:

| Feature | What is sent, and where |
| --- | --- |
| Update check | A request to GitHub for the latest version. Updates are signed, and Forma only installs updates signed with the project's key. |
| Online forms | The form and its answers, to the Supabase project you set up. |
| Ask AI (PDF) | Your request, the PDF's text and its annotations, to Groq, only when you send a message. Your API key is stored on your computer and sent only to Groq. |

## Installing

Get it from the [download page](https://kingvic300.github.io/Forma/), which picks the right
installer for your computer, or from the [latest release](https://github.com/Kingvic300/Forma/releases/latest):

- **Linux:** `.deb` (`sudo apt install ./Forma_*.deb`), `.AppImage` (`chmod +x`, then run) or `.rpm`
- **macOS:** `.dmg`. The builds are not notarized yet. On first launch, right-click the app and choose **Open**.
- **Windows:** `-setup.exe`. If SmartScreen warns, choose **More info → Run anyway**.

You only install once. Forma checks for new versions in the background, downloads them, and asks
you to restart.

## Development

Forma is a [Tauri 2](https://tauri.app) app with a React and TypeScript front end. It needs Node 22+,
stable Rust and, on Linux, the WebKitGTK libraries:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf
npm install
npm run tauri dev        # desktop app with hot reload
npm run tauri build      # installers in src-tauri/target/release/bundle/
```

`npm run dev` serves the same UI in a browser at <http://127.0.0.1:1420>. It's quicker for layout
work, but native features (save dialogs, updates) only work in the Tauri window.

Before opening a pull request, check that these pass:

```sh
npm run build                                   # type-check and bundle the UI
cargo check --manifest-path src-tauri/Cargo.toml
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the code layout, the rules for staying offline, and the
design system.

## Releasing

1. One-time: add two repository secrets (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: contents of `~/.tauri/forma.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key's password (empty for the generated key)

   Keep `~/.tauri/forma.key` backed up. Without it, installed copies can't receive updates.
2. Run `scripts/bump.sh 0.2.0`. It sets the version in `package.json`, `Cargo.toml` and
   `tauri.conf.json`, commits, tags `v0.2.0` and pushes.
3. The **Release** workflow builds Linux, macOS (Apple silicon and Intel) and Windows installers,
   signs the update packages, and publishes them with `latest.json`. Installed copies pick it up
   within six hours, or immediately from **Settings → Check for updates**.

## License

Forma is released under the [MIT License](LICENSE).
