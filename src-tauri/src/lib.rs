use tauri::Manager;

// The Android MainActivity writes the shared text to `pending_share.json` inside
// the app's private `filesDir`. Tauri's path API does not guarantee which logical
// directory maps to that exact folder across versions, so we probe every plausible
// candidate (and their `files` subdir / parent) and read whichever actually holds
// the file. This makes the Kotlin↔Rust handoff robust to path-mapping differences.
fn candidate_share_paths(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let p = app.path();
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    let mut push = |dirs: &mut Vec<std::path::PathBuf>, d: std::path::PathBuf| {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    };
    for base in [
        p.app_local_data_dir().ok(),
        p.app_data_dir().ok(),
        p.app_config_dir().ok(),
        p.app_cache_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        push(&mut dirs, base.clone());
        push(&mut dirs, base.join("files"));
        if let Some(parent) = base.parent() {
            push(&mut dirs, parent.to_path_buf());
            push(&mut dirs, parent.join("files"));
        }
    }
    dirs.into_iter()
        .map(|d| d.join("pending_share.json"))
        .collect()
}

#[tauri::command]
fn get_pending_share(app: tauri::AppHandle) -> Option<String> {
    // Read the shared-text file once, then delete it.
    for path in candidate_share_paths(&app) {
        if path.exists() {
            let data = std::fs::read_to_string(&path).ok();
            let _ = std::fs::remove_file(&path);
            if data.is_some() {
                return data;
            }
        }
    }
    None
}

// Diagnostic: report every candidate path and whether the share file exists there.
// Surfaced on-screen by the frontend when a share-launch produced nothing, so the
// real filesDir↔Tauri mapping can be confirmed on-device.
#[tauri::command]
fn share_debug(app: tauri::AppHandle) -> String {
    candidate_share_paths(&app)
        .into_iter()
        .map(|path| {
            format!(
                "{} : {}",
                path.display(),
                if path.exists() { "EXISTS" } else { "-" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_pending_share, share_debug])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
