mod media;
mod system_audio;

use tauri::{DragDropEvent, Manager, WebviewEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch focuses the running window instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let registry = media::Registry::load(app.handle())?;
            app.manage(registry);
            app.manage(system_audio::SystemAudio::default());
            Ok(())
        })
        // Only files the user physically dropped can be shared; the webview can't name arbitrary paths.
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                window.state::<media::Registry>().set_dropped(paths.clone());
            }
        })
        .on_webview_event(|webview, event| {
            if let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                webview.state::<media::Registry>().set_dropped(paths.clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            media::media_pick,
            media::media_take_dropped,
            media::media_save_bytes,
            media::media_read,
            media::media_stat,
            media::media_missing,
            media::media_forget,
            system_audio::system_audio_start,
            system_audio::system_audio_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Infimeety");
}
