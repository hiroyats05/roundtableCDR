mod share;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(share::ShareState::default())
        .invoke_handler(tauri::generate_handler![
            share::list_capture_sources,
            share::start_native_share,
            share::stop_native_share
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
