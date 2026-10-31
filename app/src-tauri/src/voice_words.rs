//! Spoken fun rules on Windows: while you're in a call, Windows' own speech recognizer listens
//! to your microphone, on this PC, for the channel's rule words only (a word list, not
//! dictation), and tells the page when it hears one. Nothing is recorded or sent anywhere: the
//! page only reports which rule word it was.

use std::sync::Mutex;
use tauri::{ipc::Channel, State};
use windows::core::{Ref, HSTRING};
use windows::Foundation::TypedEventHandler;
use windows_collections::IIterable;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession, SpeechRecognitionConfidence, SpeechRecognitionListConstraint,
    SpeechRecognitionResultStatus, SpeechRecognizer,
};

/// The recognizer while it listens.
#[derive(Default)]
pub struct VoiceWords(Mutex<Option<(SpeechRecognizer, SpeechContinuousRecognitionSession)>>);

#[tauri::command]
pub async fn voice_words_start(state: State<'_, VoiceWords>, words: Vec<String>, on_word: Channel<String>) -> Result<(), String> {
    stop(&state);
    let words: Vec<String> = words.into_iter().map(|w| w.trim().to_lowercase()).filter(|w| !w.is_empty() && w.len() <= 40).take(100).collect();
    if words.is_empty() {
        return Ok(());
    }
    let started = tauri::async_runtime::spawn_blocking(move || listen(words, on_word)).await.map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(started.map_err(|e| e.message().to_string())?);
    Ok(())
}

#[tauri::command]
pub fn voice_words_stop(state: State<'_, VoiceWords>) {
    stop(&state);
}

fn stop(state: &VoiceWords) {
    if let Some((recognizer, session)) = state.0.lock().unwrap().take() {
        if let Ok(op) = session.StopAsync() {
            let _ = op.join();
        }
        let _ = recognizer.Close();
    }
}

fn listen(words: Vec<String>, out: Channel<String>) -> windows::core::Result<(SpeechRecognizer, SpeechContinuousRecognitionSession)> {
    let recognizer = SpeechRecognizer::new()?;
    let list: IIterable<HSTRING> = words.iter().map(HSTRING::from).collect::<Vec<_>>().into();
    let constraint = SpeechRecognitionListConstraint::CreateWithTag(&list, &HSTRING::from("rules"))?;
    recognizer.Constraints()?.Append(&constraint)?;
    let compiled = recognizer.CompileConstraintsAsync()?.join()?;
    if compiled.Status()? != SpeechRecognitionResultStatus::Success {
        return Err(windows::core::Error::new(windows::core::HRESULT(-1), "Windows speech recognition isn't set up for your language"));
    }
    let session = recognizer.ContinuousRecognitionSession()?;
    session.ResultGenerated(&TypedEventHandler::new(move |_, args: Ref<SpeechContinuousRecognitionResultGeneratedEventArgs>| {
        if let Some(args) = args.as_ref() {
            let result = args.Result()?;
            // Only clear hits: a word list makes the recognizer try to match everything said.
            let sure = matches!(result.Confidence()?, SpeechRecognitionConfidence::High | SpeechRecognitionConfidence::Medium);
            let text = result.Text()?.to_string().to_lowercase();
            if sure && words.contains(&text) {
                let _ = out.send(text);
            }
        }
        Ok(())
    }))?;
    session.StartAsync()?.join()?;
    Ok((recognizer, session))
}
