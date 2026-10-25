# Forma

Docs, Sheets, Forms, PDF and Tracker in one offline desktop app. Switch between them from the
box in the top-left corner (or `Ctrl+1` … `Ctrl+6`), like the app switcher in Gmail.

| App | What it does |
| --- | --- |
| **Files** | Every file you've made or opened, with search (`Ctrl+K`) across all apps. |
| **Docs** | Rich-text documents: headings, fonts, colors, lists, tables, images, find & replace. Opens `.docx`, `.html`, `.txt`, `.md`. Exports Word (`.doc`), HTML, text, or PDF through the print dialog. |
| **Sheets** | Spreadsheet with formulas (`SUM`, `AVERAGE`, `IF`, `COUNTIF`, `SUMIF`, `ROUND`, text functions and more), multiple tabs, sort, filter, copy/paste, undo. Opens `.csv`, `.tsv`, `.xlsx`, `.xls`, `.ods`. Exports `.csv` and `.xlsx`. |
| **Forms** | Form builder (short answer, paragraph, multiple choice, checkboxes, dropdown, number, email, date, 1–5 scale). Collect responses on this computer, see charts, export to CSV or open in Sheets. Share the form as a `.form.json` file. |
| **PDF** | Add text, dates, check marks, images, signatures and initials (draw, type or upload; saved for reuse). Highlight, white out, box, strike. Fill PDF form fields. Merge PDFs, insert blank pages, reorder and delete pages. |
| **Tracker** | Keep tabs on yourself: tasks with due dates and priority, daily habits with streaks, and a daily note. |

Everything is stored on your computer. Nothing is sent anywhere, except the update check
against this repository's GitHub Releases.

## Installing

Download the file for your system from the [latest release](https://github.com/Kingvic300/Forma/releases/latest):

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
