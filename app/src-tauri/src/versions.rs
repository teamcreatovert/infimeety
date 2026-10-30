//! Installing a chosen version, older or newer (Settings > Updates > Other versions). Every
//! GitHub release carries its own latest.json, which says where that version's signed build for
//! this computer is; the normal updater installs it, checking the same signature as any update.

use tauri::{AppHandle, Url};
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub async fn install_version(app: AppHandle, version: String) -> Result<(), String> {
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return Err("That isn't a version number.".into());
    }
    let url: Url = format!("https://github.com/teamcreatovert/infimeety/releases/download/v{version}/latest.json")
        .parse()
        .map_err(|e| format!("{e}"))?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        // Any version but the one running, older ones included.
        .version_comparator(|current, release| release.version != current)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Infimeety {version} has no build for this computer."))?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}
