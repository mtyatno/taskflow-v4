use tauri::Manager;

#[tauri::command]
fn get_pending_share(app: tauri::AppHandle) -> Option<String> {
    // The Android MainActivity writes the shared text to this file on an
    // ACTION_SEND intent. Read it once, then delete it.
    let dir = app.path().app_local_data_dir().ok()?;
    let path = dir.join("pending_share.json");
    if !path.exists() {
        return None;
    }
    let data = std::fs::read_to_string(&path).ok();
    let _ = std::fs::remove_file(&path);
    data
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_pending_share])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
