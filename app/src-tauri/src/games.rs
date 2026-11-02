//! "Playing VALORANT": which well-known game is running on this PC, like Discord's activity
//! status. Only the game's name leaves this module, and only if the person shares it (a setting).

/// Program file (lowercase) → the game's id and name. Only programs that are clearly the game:
/// a launcher or a shared runtime (javaw.exe) would say you play when you don't.
const GAMES: &[(&str, &str, &str)] = &[
    ("valorant-win64-shipping.exe", "valorant", "VALORANT"),
    ("minecraft.windows.exe", "minecraft", "Minecraft"),
    ("robloxplayerbeta.exe", "roblox", "Roblox"),
    ("cod.exe", "cod", "Call of Duty"),
    ("cod22-cod.exe", "cod", "Call of Duty"),
    ("cod23-cod.exe", "cod", "Call of Duty"),
    ("cod24-cod.exe", "cod", "Call of Duty"),
    ("modernwarfare.exe", "cod", "Call of Duty"),
    ("blackops6.exe", "cod", "Call of Duty"),
    ("blackopscoldwar.exe", "cod", "Call of Duty"),
    ("tslgame.exe", "pubg", "PUBG: BATTLEGROUNDS"),
    ("fortniteclient-win64-shipping.exe", "fortnite", "Fortnite"),
    ("cs2.exe", "cs2", "Counter-Strike 2"),
    ("league of legends.exe", "lol", "League of Legends"),
    ("dota2.exe", "dota2", "Dota 2"),
    ("r5apex.exe", "apex", "Apex Legends"),
    ("r5apex_dx12.exe", "apex", "Apex Legends"),
    ("overwatch.exe", "overwatch", "Overwatch 2"),
    ("gta5.exe", "gta5", "Grand Theft Auto V"),
    ("gta5_enhanced.exe", "gta5", "Grand Theft Auto V"),
    ("rdr2.exe", "rdr2", "Red Dead Redemption 2"),
    ("rocketleague.exe", "rocketleague", "Rocket League"),
    ("rainbowsix.exe", "r6", "Rainbow Six Siege"),
    ("rainbowsix_vulkan.exe", "r6", "Rainbow Six Siege"),
    ("genshinimpact.exe", "genshin", "Genshin Impact"),
    ("starrail.exe", "starrail", "Honkai: Star Rail"),
    ("zenlesszonezero.exe", "zzz", "Zenless Zone Zero"),
    ("marvel-win64-shipping.exe", "marvelrivals", "Marvel Rivals"),
    ("destiny2.exe", "destiny2", "Destiny 2"),
    ("eldenring.exe", "eldenring", "ELDEN RING"),
    ("cyberpunk2077.exe", "cyberpunk", "Cyberpunk 2077"),
    ("fc24.exe", "eafc", "EA SPORTS FC"),
    ("fc25.exe", "eafc", "EA SPORTS FC"),
    ("fc26.exe", "eafc", "EA SPORTS FC"),
    ("rustclient.exe", "rust", "Rust"),
    ("among us.exe", "amongus", "Among Us"),
    ("fallguys_client_game.exe", "fallguys", "Fall Guys"),
    ("deadbydaylight-win64-shipping.exe", "dbd", "Dead by Daylight"),
    ("helldivers2.exe", "helldivers2", "HELLDIVERS 2"),
    ("palworld-win64-shipping.exe", "palworld", "Palworld"),
    ("lethal company.exe", "lethalcompany", "Lethal Company"),
    ("phasmophobia.exe", "phasmophobia", "Phasmophobia"),
    ("terraria.exe", "terraria", "Terraria"),
    ("stardew valley.exe", "stardew", "Stardew Valley"),
    ("sotgame.exe", "seaofthieves", "Sea of Thieves"),
    ("tf_win64.exe", "tf2", "Team Fortress 2"),
    ("pathofexile.exe", "poe", "Path of Exile"),
    ("pathofexile_x64steam.exe", "poe", "Path of Exile"),
    ("wow.exe", "wow", "World of Warcraft"),
    ("hearthstone.exe", "hearthstone", "Hearthstone"),
    ("diablo iv.exe", "diablo4", "Diablo IV"),
    ("sc2_x64.exe", "sc2", "StarCraft II"),
    ("brawlhalla.exe", "brawlhalla", "Brawlhalla"),
    ("warframe.x64.exe", "warframe", "Warframe"),
    ("escapefromtarkov.exe", "tarkov", "Escape from Tarkov"),
    ("huntgame.exe", "hunt", "Hunt: Showdown"),
    ("forzahorizon5.exe", "fh5", "Forza Horizon 5"),
    ("bg3.exe", "bg3", "Baldur's Gate 3"),
    ("bg3_dx11.exe", "bg3", "Baldur's Gate 3"),
    ("hogwartslegacy.exe", "hogwarts", "Hogwarts Legacy"),
    ("b1-win64-shipping.exe", "wukong", "Black Myth: Wukong"),
    ("monsterhunterwilds.exe", "mhwilds", "Monster Hunter Wilds"),
    ("deltaforceclient-win64-shipping.exe", "deltaforce", "Delta Force"),
    ("aces.exe", "warthunder", "War Thunder"),
    ("worldoftanks.exe", "wot", "World of Tanks"),
    ("osu!.exe", "osu", "osu!"),
    ("geometrydash.exe", "geometrydash", "Geometry Dash"),
    ("factorygame-win64-shipping.exe", "satisfactory", "Satisfactory"),
    ("factorygamesteam-win64-shipping.exe", "satisfactory", "Satisfactory"),
    ("valheim.exe", "valheim", "Valheim"),
    ("sonsoftheforest.exe", "sonsoftheforest", "Sons of the Forest"),
];

#[derive(serde::Serialize)]
pub struct Game {
    id: &'static str,
    name: &'static str,
}

/// The game running now, if any (the first one found).
#[tauri::command]
pub async fn running_game() -> Option<Game> {
    tauri::async_runtime::spawn_blocking(find).await.ok().flatten()
}

fn find() -> Option<Game> {
    let names = programs();
    let known = names.iter().find_map(|n| GAMES.iter().find(|(exe, ..)| exe == n));
    if let Some((_, id, name)) = known {
        return Some(Game { id, name });
    }
    // Minecraft: Java Edition runs as javaw.exe, which other programs use too: only its window says.
    if names.iter().any(|n| n == "javaw.exe") && minecraft_window() {
        return Some(Game { id: "minecraft", name: "Minecraft" });
    }
    None
}

/// The program files running now, lowercase.
#[cfg(windows)]
fn programs() -> Vec<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(snap, &mut entry).is_ok();
        while more {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            out.push(String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase());
            more = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

#[cfg(windows)]
fn minecraft_window() -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};
    unsafe extern "system" fn check(hwnd: HWND, found: LPARAM) -> BOOL {
        let mut title = [0u16; 128];
        let len = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
        if unsafe { IsWindowVisible(hwnd) }.as_bool() && String::from_utf16_lossy(&title[..len]).starts_with("Minecraft") {
            unsafe { *(found.0 as *mut bool) = true };
            return false.into();
        }
        true.into()
    }
    let mut found = false;
    unsafe {
        let _ = EnumWindows(Some(check), LPARAM(&mut found as *mut bool as isize));
    }
    found
}

/// Mac and Linux: not yet (the list above is Windows programs).
#[cfg(not(windows))]
fn programs() -> Vec<String> {
    Vec::new()
}

#[cfg(not(windows))]
fn minecraft_window() -> bool {
    false
}
