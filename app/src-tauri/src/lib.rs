#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
mod media;
mod names;
#[cfg(mobile)]
mod phone;
#[cfg(desktop)]
mod ptt;
#[cfg(windows)]
mod screen_share;
/// Mac and Linux share through the webview's own picker; these just say so.
#[cfg(all(desktop, not(windows)))]
mod screen_share {
    #[derive(Default)]
    pub struct ScreenShare;
    #[tauri::command]
    pub async fn screen_sources() -> Result<Vec<()>, String> {
        Err("unsupported".into())
    }
    #[tauri::command]
    pub async fn screen_share_start(id: String, fps: u32) -> Result<(), String> {
        let _ = (id, fps);
        Err("unsupported".into())
    }
    #[tauri::command]
    pub fn screen_share_stop() {}
}
#[cfg(desktop)]
mod system_audio;
#[cfg(desktop)]
mod tarball;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let builder = desktop_app();
    #[cfg(mobile)]
    let builder = phone_app();
    builder
        .build(tauri::generate_context!())
        .expect("error while building Infimeety")
        .run(|_app, _event| {
            // Mac: closing hides the window (the app stays in the menu bar); the Dock icon brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                desktop::show_main(_app);
            }
        });
}

#[cfg(desktop)]
fn desktop_app() -> tauri::Builder<tauri::Wry> {
    use tauri::{DragDropEvent, Manager, WebviewEvent, WindowEvent};

    tauri::Builder::default()
        // A second launch brings back the running window (even from the tray) instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)))
        // infimeety://invite/CODE links; a second launch hands its link to the running app.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Pop-ups for messages and calls while the app is in the background.
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let registry = media::Registry::load(app.handle())?;
            app.manage(registry);
            app.manage(media::Receivers::default());
            app.manage(system_audio::SystemAudio::default());
            app.manage(screen_share::ScreenShare::default());
            app.manage(desktop::CloseToTray::default());
            app.manage(ptt::PushToTalk::default());
            desktop::setup_tray(app)?;
            #[cfg(target_os = "macos")]
            desktop::offer_move_to_applications(app);
            #[cfg(windows)]
            desktop::remove_update_leftover();
            // The installer registers infimeety:// too; this keeps it pointing at the running build.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        // Only files the user physically dropped can be shared; the webview can't name arbitrary paths.
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                window.state::<media::Registry>().set_dropped(paths.clone());
            }
            desktop::on_window_event(window, event);
        })
        .on_webview_event(|webview, event| {
            if let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                webview.state::<media::Registry>().set_dropped(paths.clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            media::media_pick,
            media::media_pick_folder,
            media::media_take_dropped,
            media::media_save_bytes,
            media::media_read,
            media::media_stat,
            media::media_missing,
            media::media_forget,
            media::media_reveal,
            media::media_choose_folder,
            media::media_receive_open,
            media::media_receive_write,
            media::media_receive_close,
            ptt::ptt_watch,
            system_audio::system_audio_start,
            system_audio::system_audio_stop,
            screen_share::screen_sources,
            screen_share::screen_share_start,
            screen_share::screen_share_stop,
            desktop::set_close_to_tray,
            desktop::overlay_open,
            desktop::overlay_close,
            desktop::notify,
        ])
}

/// Android and iPhone: the web app in a native shell, plus saving copies where the Files app finds them.
#[cfg(mobile)]
fn phone_app() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        // infimeety://invite/CODE and infimeety://meet/CODE open the app.
        .plugin(tauri_plugin_deep_link::init())
        // Links and sign-in open in the phone's browser.
        .plugin(tauri_plugin_opener::init())
        .manage(phone::Saves::default())
        .invoke_handler(tauri::generate_handler![phone::save_open, phone::save_write, phone::save_close])
}
