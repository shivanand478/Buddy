use crate::model::AppData;
use std::path::PathBuf;

pub fn data_file(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("buddy.json")
}

pub fn load(path: &PathBuf) -> AppData {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppData::default(),
    }
}

/// Writes via a temp file and rename, so a crash mid-write can't leave the
/// user with a truncated day.
pub fn save(path: &PathBuf, data: &AppData) {
    let Ok(text) = serde_json::to_string_pretty(data) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}
