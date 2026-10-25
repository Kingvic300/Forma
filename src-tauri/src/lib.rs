use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Files handed to Forma by the OS ("Open with", double-click, command line) that the
/// web view has not picked up yet.
#[derive(Default)]
struct Opened(Mutex<Vec<PathBuf>>);

#[derive(Serialize)]
struct OpenedFile {
    name: String,
    bytes: Vec<u8>,
}

const EXTENSIONS: &[&str] = &[
    "pdf", "csv", "tsv", "xlsx", "xls", "ods", "docx", "html", "htm", "txt", "md", "json",
];

fn file_args<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        })
        .collect()
}

fn queue(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    app.state::<Opened>().0.lock().unwrap().extend(paths);
    let _ = app.emit("files-opened", ());
}

/// Hands queued files to the web view once, reading them here so the web view needs no
/// file-system access outside what the user picks in dialogs.
#[tauri::command]
fn take_opened_files(state: tauri::State<Opened>) -> Vec<OpenedFile> {
    let paths: Vec<PathBuf> = state.0.lock().unwrap().drain(..).collect();
    paths
        .into_iter()
        .filter_map(|p| {
            let bytes = std::fs::read(&p).ok()?;
            let name = p.file_name()?.to_string_lossy().into_owned();
            Some(OpenedFile { name, bytes })
        })
        .collect()
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // A second launch (e.g. double-clicking a PDF) focuses the running window instead.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            queue(app, file_args(args));
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(Opened::default())
        .invoke_handler(tauri::generate_handler![take_opened_files])
        .setup(|app| {
            let initial = file_args(std::env::args());
            app.state::<Opened>().0.lock().unwrap().extend(initial);
            // Linux and Windows: no native menu bar; the app has its own switcher and shortcuts.
            // macOS keeps the default menu because copy/paste shortcuts depend on it there.
            #[cfg(not(target_os = "macos"))]
            app.remove_menu()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Forma");

    app.run(|_app, _event| {
        // macOS delivers "Open with" files as an event rather than as arguments.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            queue(_app, paths);
        }
    });
}
