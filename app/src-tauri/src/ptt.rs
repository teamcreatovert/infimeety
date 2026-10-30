//! Push to talk that works while another app, like a game, is in front. The key's state is read
//! from the system every few milliseconds, the way Discord does it: the game still gets the key
//! too, nothing is intercepted. Mac needs the Accessibility permission; Linux needs X11.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use device_query::{DeviceQuery, DeviceState, Keycode};
use tauri::{AppHandle, Emitter};

/// The running watcher's stop flag, if there is one.
#[derive(Default)]
pub struct PushToTalk(Mutex<Option<Arc<AtomicBool>>>);

enum Input {
    Key(Keycode),
    /// device_query's 1-based button number: 3 middle, 4 and 5 the side buttons.
    Mouse(usize),
}

/// A browser `KeyboardEvent.code` ("KeyV", "Backquote", "ShiftLeft") or "Mouse3"…"Mouse5".
fn parse(code: &str) -> Option<Input> {
    if let Some(n) = code.strip_prefix("Mouse") {
        return n.parse().ok().filter(|n| (3..=5).contains(n)).map(Input::Mouse);
    }
    let name = match code {
        "Backquote" => "Grave",
        "BracketLeft" => "LeftBracket",
        "BracketRight" => "RightBracket",
        "Backslash" => "BackSlash",
        "Quote" => "Apostrophe",
        "Period" => "Dot",
        "NumpadEqual" => "NumpadEquals",
        "ShiftLeft" => "LShift",
        "ShiftRight" => "RShift",
        "ControlLeft" => "LControl",
        "ControlRight" => "RControl",
        "AltLeft" => "LAlt",
        "AltRight" => "RAlt",
        "MetaLeft" => "LMeta",
        "MetaRight" => "RMeta",
        "ArrowUp" => "Up",
        "ArrowDown" => "Down",
        "ArrowLeft" => "Left",
        "ArrowRight" => "Right",
        // "KeyV" → "V", "Digit1" → "Key1"; the rest (F5, Space, CapsLock, Numpad0…) match already.
        other => {
            let name = match other.strip_prefix("Digit") {
                Some(digit) => format!("Key{digit}"),
                None => other.strip_prefix("Key").unwrap_or(other).to_string(),
            };
            return Keycode::from_str(&name).ok().map(Input::Key);
        }
    };
    Keycode::from_str(name).ok().map(Input::Key)
}

/// Watches `key` and emits "ptt" (true while it's held) to the app, or stops watching with
/// `None`. Returns false when it can't here (an unknown key, no Accessibility permission on a
/// Mac, no X11 on Linux): the app then listens inside its own window only.
#[tauri::command]
pub fn ptt_watch(app: AppHandle, state: tauri::State<PushToTalk>, key: Option<String>) -> bool {
    let Ok(mut current) = state.0.lock() else { return false };
    if let Some(stop) = current.take() {
        stop.store(true, Ordering::Relaxed);
    }
    let Some(input) = key.as_deref().and_then(parse) else { return key.is_none() };
    if DeviceState::checked_new().is_none() {
        return false;
    }

    let stop = Arc::new(AtomicBool::new(false));
    *current = Some(stop.clone());
    std::thread::spawn(move || {
        // Made here: on Linux and Mac it can't move between threads.
        let Some(device) = DeviceState::checked_new() else { return };
        let mut held = false;
        while !stop.load(Ordering::Relaxed) {
            let down = match &input {
                Input::Key(k) => device.get_keys().contains(k),
                Input::Mouse(b) => device.get_mouse().button_pressed.get(*b).copied().unwrap_or(false),
            };
            if down != held {
                held = down;
                let _ = app.emit("ptt", down);
            }
            std::thread::sleep(Duration::from_millis(12));
        }
        if held {
            let _ = app.emit("ptt", false);
        }
    });
    true
}
