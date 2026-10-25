# Forma

Docs, Sheets, PDF and Tracker in one offline desktop app. Switch between them from the
box in the top-left corner (or `Ctrl+1` … `Ctrl+6`), like the app switcher in Gmail.

| App | What it does |
| --- | --- |
| **Files** | Every file you've made or opened, with search (`Ctrl+K`) across all apps. |
| **Docs** | Rich-text documents: headings, fonts, colors, lists, tables, images, find & replace. Opens `.docx`, `.html`, `.txt`, `.md`. Exports Word (`.doc`), HTML, text, or PDF through the print dialog. |
| **Sheets** | Spreadsheet with formulas (`SUM`, `AVERAGE`, `IF`, `COUNTIF`, `SUMIF`, `ROUND`, text functions and more), multiple tabs, sort, filter, copy/paste, undo. Opens `.csv`, `.tsv`, `.xlsx`, `.xls`, `.ods`. Exports `.csv` and `.xlsx`. |
| **PDF** | Add text, dates, check marks, images, signatures and initials (draw, type or upload; saved for reuse). Highlight, white out, box, strike. Black out: remove anything under black boxes for good in the downloaded copy. Fill PDF form fields. Click links. Merge PDFs, insert blank pages, reorder and delete pages. |
| **Tracker** | Keep tabs on yourself: tasks with due dates and priority, daily habits with streaks, and a daily note. |

Everything is stored on your computer. Forma only goes online to check for updates, and to share
forms if you set that up.

### Sharing forms online

To let anyone fill in a form from a link, Forma keeps that form and its answers in a free
[Supabase](https://supabase.com) project that you own. Set it up once from **Settings → Online
forms** (Forma shows each step and gives you the setup code), then click **Share** on any form.
Only the project's public key goes into links. Respondents can read the form and send answers,
but can't read anyone's answers; reading answers or changing the form needs an owner code that
stays on your computer.

## Installing

Get it from the [download page](https://kingvic300.github.io/Forma/), which picks the right installer for your computer, or from the [latest release](https://github.com/Kingvic300/Forma/releases/latest):

- **Linux**: `.deb` (`sudo apt install ./Forma_*.deb`), `.AppImage` (`chmod +x`, then run) or `.rpm`
- **macOS**: `.dmg`. The builds are not notarized yet: on first launch, right-click the app and choose **Open**.
- **Windows**: `-setup.exe`. If SmartScreen warns, choose **More info → Run anyway**.

You only install once. Forma checks for a new version in the background, downloads it, and asks
you to restart. Updates are signed; the app only installs updates signed with the project's key.

## Development

Needs Node 22+, Rust (stable) and, on Linux, the WebKitGTK libraries:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf
npm install
npm run tauri dev        # desktop app with hot reload
npm run tauri build      # installers in src-tauri/target/release/bundle/
```

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

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; it
covers setup, the ground rules for staying offline, and the design system.

## License

Forma is released under the [MIT License](LICENSE).
