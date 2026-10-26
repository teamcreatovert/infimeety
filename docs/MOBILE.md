# The phone apps (Android and iPhone)

The phone app is the web app inside a native shell, built with Tauri from the same code as the
desktop app. Calls, chat, meetings and watch parties work as they do in a phone's browser. The
shell adds what a browser tab can't do:

- It's an app on the home screen, with its own icon, that opens straight into Infimeety.
- Sign-in opens the phone's browser (Google won't sign in inside an app), then the
  **Back to Infimeety** button on the "You're signed in" page brings you back.
- `infimeety://invite/CODE` and `infimeety://meet/CODE` links open the app.
- Links in chat open in the phone's browser.
- Copies of friends' files are saved where the Files app finds them: **Downloads › Infimeety**
  on Android, **Files › On My iPhone › Infimeety** on iPhone.

Phones can't share their screen, the same as in a phone's browser.

## How it's built

`.github/workflows/mobile.yml` builds both on GitHub. It runs on every push to a branch that
changes the app, and from **Actions → Mobile → Run workflow**.

- **Android** makes `Infimeety.apk`. Open the run, download **Infimeety-android** at the bottom,
  unzip it and send `Infimeety.apk` to a phone. The phone asks to allow installing apps from
  that source the first time.
- **iPhone** builds for the iOS Simulator, which proves it compiles. Real iPhones need an Apple
  Developer account (below).

The Android project lives in `app/src-tauri/gen/android` and is kept in git, since it carries
the microphone and camera permissions and the screen insets (`MainActivity.kt`). The Xcode
project is made fresh on each build; iPhone settings go in `app/src-tauri/Info.ios.plist`.
Phone-only settings (the app id `app.infimeety`) are in `tauri.android.conf.json` and
`tauri.ios.conf.json`.

## Android signing key (do this once, before sharing the app)

Android only installs an update over an app signed with the same key. Until the key is set up,
each build is signed with a throwaway key, so installing a newer build means uninstalling the
old one first. Set up the real key once:

1. Make the key (any computer with Java; Android Studio includes it):

   ```
   keytool -genkeypair -keystore infimeety.jks -alias infimeety -keyalg RSA -keysize 2048 -validity 10000
   ```

   Choose a strong password. Keep `infimeety.jks` and the password somewhere safe and
   backed up: if it's lost, people have to uninstall and reinstall to get updates.

2. Turn it into text. PowerShell:
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("infimeety.jks")) | Set-Clipboard`

3. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**:
   - `ANDROID_KEYSTORE`: paste the text from step 2.
   - `ANDROID_KEYSTORE_PASSWORD`: the password.

Never commit the `.jks` file (`.gitignore` blocks it).

## iPhone: TestFlight and the App Store

Apple only lets apps onto iPhones through its developer program ($99 a year), via TestFlight
for testers or the App Store. With an account, the workflow can be extended to sign the app and
upload it to TestFlight. It needs these secrets: the team id (`APPLE_DEVELOPMENT_TEAM`), an App
Store Connect API key, and a distribution certificate with its provisioning profile.

## Trying it locally

With Android Studio installed (it brings the SDK and NDK):

```
cd app
npx tauri android dev      # on a plugged-in phone or an emulator
npx tauri android build --apk
```

iPhone needs a Mac with Xcode: `npx tauri ios init`, then `npx tauri ios dev`.
