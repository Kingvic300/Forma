# Forma roadmap

Feature checklists for Slides, Docs, PDF and Sheets, cut down to what fits an offline, private
desktop app. ✅ means it's in Forma today. Everything else is planned and gets built in batches,
each one tested and released before the next.

## What was removed

These items don't fit Forma, so they're not on the list:

- **Servers and accounts:** real-time collaboration, live cursors and presence, sharing by link or
  email, permissions and ownership, cloud storage and sync, cross-device sync, team workspaces,
  sign-in, single sign-on, two-factor authentication, session management, audit logs.
- **Other products:** Android and iOS apps, web app, plugin and template marketplaces, stock photo,
  video, audio and 3D libraries, public galleries.
- **Third-party services:** OneDrive, Google Drive and Docs, Dropbox, Teams, Zoom, Slack, Canva,
  Figma, DocuSign and Adobe Sign, Salesforce, QuickBooks, SAP, database connectors, BigQuery,
  Snowflake, map services, REST APIs, webhooks, SDKs.
- **Excel subsystems:** VBA, macros, Office Scripts, Power Query and the M language, Power Pivot,
  DAX, the data model, cube functions, Solver.
- **Publishing and audiences:** broadcasting, live streaming, audience polls, Q&A and feedback,
  viewer analytics and view counts, publishing online.
- **Enterprise:** approval workflows, retention and classification policies, organization admin,
  usage analytics, data residency, compliance reporting.
- **Security services:** malware scanning, data-loss prevention, certificate authorities and
  signature-request workflows (sending documents for others to sign).

---

## Sheets

Done: **Sheets core** (v0.1.19) and **Tables and PivotTables** (next release).
Next batches, in order: **Charts** (more types, axis titles, trendlines, sparklines) →
**Analysis and formula checks** (goal seek, data tables, statistics, trace precedents, error checking,
evaluate formula) → **Protection, templates, page setup, comments, grouping and outlines**.

- **Workbook:** ✅ new, open, save (automatic), rename, duplicate, delete, recent files, import, export, multiple workbooks side by side. Planned: templates, workbook properties, read-only mode, compare workbooks, password protection and encryption, version history.
- **Worksheets:** ✅ create, delete, rename, reorder by drag, duplicate, hide and unhide, tab colors. Planned: move and copy between workbooks, protect and lock, worksheet background.
- **Rows and columns:** ✅ insert, delete, hide and unhide, resize by drag, autofit, custom height and width, freeze panes. Planned: move by drag, group and outline, split view, delete blank rows and columns.
- **Cells:** ✅ select ranges, enter and edit, clear, copy, cut, paste, merge and unmerge, merge and center, merge across, AutoFill and drag-to-fill (numbers, dates, weekdays, months, formulas), paste special (values, formats, transposed), notes, links, named ranges, absolute and mixed references (F4), references to other sheets. Planned: Flash Fill, custom fill lists, threaded comments, paste column widths.
- **Data entry:** ✅ in-cell and formula-bar editing, line breaks in cells (Alt+Enter), find and replace (sheet or workbook, by value or formula, match case, whole cell), Ctrl+Enter fills the selection, undo and redo. Planned: find in selection only.
- **Cell formatting:** ✅ font, size, color, bold, italic, underline, strikethrough, fill color, borders (all, outside, inside, each side, thick, double, color, style), horizontal and vertical alignment, wrap text, rotation, indent, format painter, clear formatting. Planned: double underline, superscript, subscript, diagonal borders, shrink to fit, cell styles.
- **Number formats:** ✅ general, number, currency, accounting, percent, fraction, scientific, date, time, text, custom Excel format codes with colors and sections, decimal places, thousands separator, automatic recognition of typed numbers, dates, percentages and currency.
- **Formula engine:** ✅ formulas, formula bar, automatic recalculation, circular reference detection, error values, function autocomplete and argument hints, references to other sheets, named ranges, whole-column and whole-row ranges, dynamic arrays and spill ranges, LET and LAMBDA, show formulas (Ctrl+\`), structured table references. Planned: trace precedents and dependents, evaluate step by step, iterative calculation, manual calculation mode, formula error checking.
- **Functions:** ✅ about 370 Excel functions: math and trig, statistical, logical, text, date and time, lookup and reference (VLOOKUP, HLOOKUP, XLOOKUP, INDEX, MATCH, XMATCH, OFFSET, INDIRECT), financial, information, engineering, database (DSUM and friends) and dynamic arrays (FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, LET, LAMBDA, MAP, REDUCE, SCAN, BYROW, BYCOL, TAKE, DROP, HSTACK, VSTACK, TEXTSPLIT). Planned: the remaining rarely used ones.
- **Sort and filter:** ✅ sort A–Z and Z–A, multi-level sort, AutoFilter dropdowns per column (by value, with search), text filter across rows. Planned: sort by color, left-to-right sort, number, date, color and top/bottom filters, advanced criteria ranges.
- **Data validation:** ✅ whole number, decimal, list (dropdowns, from a range), date, text length and formula rules, reject or warn, error messages. Planned: dependent dropdowns, input messages, circle invalid data.
- **Conditional formatting:** ✅ greater/less/between/equal, text contains, begins and ends with, blanks, duplicates and unique values, top and bottom N or %, above and below average, two- and three-color scales, data bars, formula rules, rule manager with priority and stop-if-true. Planned: date rules, icon sets.
- **Tables:** ✅ format as table (Ctrl+T), header and total rows (sum, average, count, max, min and more), banded rows and columns, first and last column, 35 table styles, filter buttons, calculated columns, structured references (Table[Col], [@Col], [#Totals] and the rest), automatic expansion, rename, resize, convert to range, .xlsx import and export.
- **Charts:** ✅ column, bar, line, area (clustered, stacked and 100%), pie, doughnut, scatter; titles, legends, data labels. Planned: bubble, radar, histogram, Pareto, box and whisker, waterfall, funnel, treemap, sunburst, combo and dual-axis, sparklines, axis titles, gridlines, trendlines, error bars, colors and styles.
- **Pivot tables:** ✅ create from a range or table, rows, columns, values and filters, sum, count, count numbers, average, min, max, distinct count, product, standard deviation, variance, grouping (dates by year, quarter, month or day; numbers into ranges), show values as % of grand, row or column total or as a running total, subtotals and grand totals, sort by label or value, refresh. Planned: slicers, pivot charts, GETPIVOTDATA.
- **Analysis:** Planned: descriptive statistics, histogram, correlation, regression, moving averages, sampling, t-test, goal seek, scenarios, one- and two-variable data tables, forecast sheet.
- **Data cleaning:** ✅ remove duplicates, trim spaces, split text to columns, text case. Planned: remove blank rows, convert text to numbers and dates.
- **Printing and page layout:** ✅ print and save as PDF, print the selection. Planned: print area, page breaks and preview, orientation, paper size, margins, scaling and fit to page, gridlines and headings, repeat header rows, headers and footers.
- **Views and navigation:** ✅ formula bar, name box (go to a cell, range or name), zoom (Ctrl+wheel), freeze panes, hide gridlines, show formulas. Planned: Go To Special, hide headings, page layout view, full screen, navigation between errors, comments and formulas.
- **Keyboard:** ✅ arrows, Tab, Enter, F2, F4, Ctrl+arrow jumps, Ctrl+Shift selection, Shift+Space and Ctrl+Space, Ctrl+D and Ctrl+R fill, Alt+= AutoSum, Ctrl+; date, Ctrl+B/I/U, Ctrl+\` show formulas, Ctrl+T table, Ctrl+Z/Y, Ctrl+A, copy and paste. Planned: Ctrl+1 format cells dialog.
- **Import and export:** ✅ import XLSX, XLSM, XLS, ODS, CSV, TSV; export XLSX (keeping formatting, widths, merges, freeze panes, validation, conditional formatting and tables), CSV, TSV, JSON, HTML, PDF. Planned: export ODS; import JSON and HTML tables; keep pivot definitions in .xlsx.
- **Protection:** Planned: protect sheet and workbook structure, lock cells, hide formulas, password-protected files.
- **Quality checks:** Planned: error checking, inconsistent formula detection, broken references, hidden rows, columns and sheets, workbook statistics.
- **AI:** ✅ ask questions about data, generate tables and formulas from plain language, add totals and summaries, sort and clean data. Planned: explain and fix formulas, recommend charts and pivot tables, detect anomalies and duplicates, generate conditional formatting and validation, write reports from data.
- **Templates:** Planned: budget, invoice, expense tracker, loan calculator, project tracker, inventory, attendance, sales tracker.
- **Accessibility and language:** Planned: keyboard-only use, screen reader labels, high contrast, right-to-left sheets, regional number and date formats.

## Slides

- **Files:** ✅ new, open, save, PowerPoint import and export, rename, duplicate, delete, recent files. Planned: templates, file properties, export PDF and images.
- **Slides:** ✅ new, delete, duplicate, reorder by drag, hide, thumbnails, notes, transitions, backgrounds, layouts. Planned: copy and paste between decks, sections, slide sorter view, reuse slides from another deck, slide numbers.
- **Layouts and masters:** ✅ title, title and content, section header, two content, title only, blank; PowerPoint masters and layouts are read and drawn. Planned: comparison and picture-with-caption layouts, change a slide's layout, slide master editing, custom layouts.
- **Text:** ✅ text boxes, fonts, size, color, bold, italic, underline, alignment, bullets, numbering, levels, line spacing (from files), vertical text (from files), text autofit (from files). Planned: strikethrough, superscript, subscript, highlight, change case, clear formatting, line and paragraph spacing controls, indentation, custom bullets, columns, text effects (outline, shadow, glow), WordArt styles, find and replace, spell check, hyperlinks and links to slides, symbols, equations.
- **Shapes:** ✅ 80+ preset shapes (drawn from files), insert 18 common shapes, move, resize, rotate, fill, outline, arrange. Planned: full shape gallery, connectors, freeform and scribble, align and distribute, group and ungroup, merge shapes, gradient and pattern fills, transparency, shadow, glow, soft edges, edit points, change shape, format painter, selection pane, lock.
- **Pictures:** ✅ insert, paste, drop, crop (from files), resize, rotate, flip (from files). Planned: crop tool, crop to shape, transparency, borders, shadows, brightness, contrast, saturation, recolor, filters, replace picture, compress, alt text.
- **Video and audio:** ✅ insert and play video and audio. Planned: trim, poster frame, volume, loop, start automatically, play across slides, fade in and out, record audio narration, captions.
- **Tables:** ✅ shown from PowerPoint files with table styles. Planned: insert and edit tables, rows and columns, merge and split cells, shading, borders, styles, banded rows, import from Sheets.
- **Charts:** ✅ column, bar, line, area, pie, doughnut and scatter charts shown from files. Planned: insert and edit charts with a data sheet, more chart types, axis and label options, link to Sheets.
- **SmartArt and diagrams:** ✅ SmartArt from files is drawn. Planned: insert process, cycle, hierarchy, matrix, pyramid, Venn and timeline diagrams, convert bullets to a diagram.
- **Themes and design:** Planned: built-in themes, theme colors and fonts, variants, apply to all or selected slides, gradient, picture and pattern backgrounds, eyedropper, brand colors and fonts, design suggestions.
- **Animations:** ✅ entrance, exit, emphasis and motion-path effects, fade, fly in, zoom, spin, grow and shrink, wipe, split, float, bounce, duration, delay, direction, start on click, with previous and after previous, reordering, preview, animation pane, multiple effects per object, by paragraph, group animation. Planned: custom drawn motion paths, repeat, triggers on click of a shape, animation painter, by word and by letter.
- **Transitions:** ✅ none, fade, fade through black, push, wipe, split, zoom, circle, cover, uncover, flip, dissolve, duration, direction, apply to all, advance automatically. Planned: reveal, random bars, shape, morph, gallery, cube, transition sound, transition preview.
- **Slide show:** ✅ start from beginning or current slide, full screen, black and white screen, keyboard, mouse and wheel navigation, go to slide number, end show, automatic advance. Planned: presenter view (notes, next slide, timer) on a second screen, laser pointer, pen and highlighter, eraser, windowed and kiosk modes, loop, custom shows, slide ranges, rehearse timings, record a slide show.
- **Notes:** ✅ add and edit notes, notes pane. Planned: notes page view, print and export notes, search notes.
- **Accessibility:** Planned: alt text, reading order, accessibility checker, contrast checker, captions, reduced motion.
- **Import and export:** ✅ import PPTX, PPSX, POTX; export PPTX with animations and transitions. Planned: export PDF, PNG, JPEG, SVG, MP4 video and GIF; import and export ODP; import PDF and images as slides; export handouts and notes.
- **Printing:** Planned: print slides, handouts (several per page), notes and outline; ranges, orientation, paper size, grayscale, preview.
- **Views:** ✅ normal view with thumbnails, zoom to fit, side by side with another file. Planned: slide sorter, reading view, outline view, rulers, grid and guides, custom zoom.
- **Editing tools:** ✅ drag to move, resize and rotate, snap to slide centre and edges, nudge with arrow keys, duplicate, copy and paste, undo and redo. Planned: smart guides between objects, snap to grid, exact position and size boxes, multi-select with a drag rectangle, lock objects, clipboard history.
- **Technical content:** Planned: equation editor with LaTeX input, code blocks with highlighting, flowchart tools.
- **AI:** ✅ generate a deck from a prompt, rewrite and restyle slides, speaker notes, animations, transitions, backgrounds. Planned: generate a deck from a Word document or PDF, translate a deck, design review (crowded slides, inconsistent fonts), quizzes and flashcards from a deck.
- **Quality checks:** Planned: text overflow, missing fonts, low-resolution pictures, broken links, spelling, consistency.
- **Professional:** ✅ widescreen and standard sizes from files. Planned: custom slide size and portrait slides, headers and footers, date and slide number placeholders, watermarks, file properties.

## Docs

- **Files:** ✅ new, open (DOCX, HTML, TXT, Markdown), save (automatic), rename, delete, recent files. Planned: templates, file properties, version history, export DOCX with formatting, PDF, ODT, RTF, Markdown, EPUB.
- **Editing:** ✅ text, undo and redo, find and replace, fonts, size, color, bold, italic, underline, strikethrough, highlight, alignment, lists, tables, images, links, comments, word count, special characters. Planned: superscript and subscript controls, change case, line and paragraph spacing, indents, multilevel lists, custom bullets, columns, page and section breaks, drop caps, format painter.
- **Styles:** ✅ headings 1–5, title, quote. Planned: style gallery with custom styles, heading numbering, navigation pane by headings.
- **Page layout:** Planned: page size, orientation, margins, columns, page borders and color, watermark, section breaks.
- **Headers and footers:** Planned: headers, footers, page numbers, total pages, date, different first page, odd and even pages.
- **Tables:** ✅ insert, add and delete rows and columns, merge cells, table properties. Planned: split cells, table styles, banded rows, repeat header row, sort, formulas, convert text to table.
- **Pictures and objects:** ✅ insert and paste pictures. Planned: resize, crop, rotate, text wrapping options, captions, shapes, text boxes, charts, equations, QR codes.
- **References:** Planned: table of contents, footnotes and endnotes, citations and bibliography (APA, MLA, Chicago, Harvard, IEEE), captions, cross-references, index.
- **Review:** Planned: spell check, track changes (accept and reject), compare documents, readability statistics.
- **Mail merge:** Planned: merge with a Sheets or CSV file into letters, labels and envelopes.
- **Printing:** ✅ print and PDF through the print dialog. Planned: page ranges, copies, print preview with layout.
- **AI:** ✅ write, rewrite, summarize, translate, change tone, fix grammar, turn into lists or tables, chat that edits the document. Planned: generate from an outline or PDF, extract action items, dates and names, quizzes, flashcards, study guides.

## PDF

- **Viewing:** ✅ render pages, continuous scrolling, zoom, links, side by side. Planned: page thumbnails sidebar, two-page and facing views, fit width and page, go to page, search with highlighting, outline and bookmarks panel, attachments panel, night and sepia reading modes.
- **Text editing:** ✅ edit existing text, add text, fonts, size, color, bold, move, resize, rotate. Planned: italic, underline, alignment, spacing, find and replace, OCR for scanned pages.
- **Pages:** ✅ insert blank page, merge PDFs, reorder, delete, drag pages between PDFs. Planned: rotate, crop, resize, extract, split, duplicate, replace, reverse order, odd and even page selection, remove blank pages, page numbers, page labels, background color and image.
- **Annotation:** ✅ highlight, text boxes, shapes, rectangles, circles, lines, arrows, freehand drawing, checkmark and cross stamps, date stamps, move, resize, color, thickness. Planned: underline, strikethrough and squiggly text markup, sticky notes, callouts, polygons and clouds, custom stamps, annotation list, show and hide, flatten, import and export annotations.
- **Forms:** ✅ fill text fields, checkboxes, radio buttons and dropdowns, save filled forms. Planned: create and edit form fields, validation, calculations, tab order, flatten, export and import form data.
- **Signatures:** ✅ draw, type and upload signatures, initials, save for reuse, place, move, resize. Planned: signature fields, date next to signature, sign with a certificate, verify signatures.
- **OCR and scanning:** Planned: OCR scanned PDFs and images into searchable text, images to PDF, deskew, contrast cleanup.
- **Security:** ✅ permanent redaction with black boxes. Planned: password protection and encryption, permission restrictions, remove passwords, remove metadata and hidden content, search-based redaction (emails, phone numbers, card numbers).
- **Conversion:** ✅ PDF to Word, PNG and text. Planned: PDF to Excel, PowerPoint, HTML, Markdown and JPEG; images, Word, Sheets and Slides to PDF; batch conversion.
- **Optimization:** Planned: compress, downsample images, remove unused objects, repair.
- **Compare:** Planned: compare two PDFs side by side with text differences highlighted.
- **Watermarks, headers and footers:** Planned: text and image watermarks, headers, footers, page numbers, dates, all or selected pages.
- **Advanced:** Planned: edit metadata, bookmarks, attachments, links, PDF/A export.
- **AI:** ✅ edit by instruction, summarize. Planned: chat with PDF with page citations, extract tables, key data and action items, translate.

## Every app

- **Keyboard and workspace:** ✅ command palette, app switcher, side-by-side files, full screen, shortcuts. Planned: shortcut list in each app, customizable shortcuts.
- **Reliability:** ✅ automatic saving, signed automatic updates. Planned: version history per file, backups, crash recovery.
- **Language:** Planned: interface languages, right-to-left text, regional formats.
- **Accessibility:** Planned: screen reader labels throughout, high contrast theme, reduced motion, accessibility checkers.
