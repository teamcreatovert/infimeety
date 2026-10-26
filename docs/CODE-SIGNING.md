# Code signing for the Windows installer

Infimeety's installer and `infimeety.exe` aren't code-signed yet. This page is the plan to get
them signed for free, the exact steps only you can take, and what to do about antivirus blocks
until then. Researched October 2026.

## What you need to do

| # | Step | Your time | Then wait |
| --- | --- | --- | --- |
| 1 | [Release from GitHub Actions](#1-release-from-github-actions-do-this-now): add one secret | 5 min | ~10–15 min per release build |
| 2 | [Report false positives](#meanwhile-false-positive-reports) for each new release | 20–30 min per release | Microsoft: a few days. Others: no promise, often 1–5 days |
| 3 | [Choose a license](#2-choose-a-license-your-decision) | 15 min (deciding takes longer) | — |
| 4 | [Write a privacy policy and the code signing policy section](#3-privacy-policy-and-code-signing-policy) | 1–2 h | — |
| 5 | [Turn on two-factor sign-in on GitHub](#4-two-factor-sign-in) | 5 min | — |
| 6 | [Get some visibility, then apply to SignPath Foundation](#5-apply-to-signpath-foundation) | 15 min to apply | 1 day to ~2 months. New projects are often declined |
| 7 | [Connect SignPath to the repo](#6-after-approval-connect-signpath) | ~1 h | — |
| 8 | [Ship the first signed release](#7-first-signed-release) | 30 min, plus 2 approval clicks per release | — |

Steps 1–5 are useful now even if SignPath says no.

## Why friends' installs fail

"Error opening file for writing: …\infimeety.exe" is what the NSIS installer shows when
something stops it from writing the file. A non-writable install folder was one cause (fixed in
v0.1.1 by `app/src-tauri/windows/installer-hooks.nsh`). The other is antivirus (360, Avast,
Kaspersky and the like) blocking a brand-new, unsigned exe as it's extracted. Defender and
VirusTotal call the build clean. The problem is reputation, not malware: a file nobody has seen
before, with no publisher signature, looks like a fresh dropper to a heuristic engine.

A valid Authenticode signature from a trusted certificate is the strongest signal these engines
use. It doesn't make SmartScreen trust a file instantly. Since 2024 even EV certificates build
reputation over time like everyone else, but consistent signing lets reputation carry over from
release to release.

## Free routes in 2026

The owner has no credit card, which rules out most options.

| Option | Cost | Fits Infimeety? |
| --- | --- | --- |
| **[SignPath Foundation](https://signpath.org)** | Free for open-source projects, no card | **Yes, once eligible** (license, policies, visibility; below). The only free, publicly trusted certificate I found. Signatures show the publisher as **SignPath Foundation**, not Infimeety. |
| **[Microsoft Store](https://storedeveloper.microsoft.com)**, MSIX package | Free individual developer account since Sept 2025. No card: ID plus selfie | **Later, maybe.** Microsoft re-signs MSIX packages, so Store installs get no SmartScreen or reputation trouble. But Tauri doesn't build MSIX, Store installs update through the Store instead of the Tauri updater, and a Store **EXE/MSI** submission must already be signed with a trusted certificate. It's a separate project. |
| Azure Artifact Signing (formerly Trusted Signing) | ~$9.99/month, needs a card | No. Individual developers are limited to the USA and Canada. |
| OV / EV certificate from a CA | $150–400+/year | No (paid). Certum's open-source certificate isn't free any more either. |
| Self-signed certificate | Free | No. Worse than unsigned for the public. |
| Sigstore / cosign | Free | No. Not Authenticode, so Windows ignores it. |

## SignPath Foundation's rules, checked against Infimeety

From [signpath.org/terms](https://signpath.org/terms):

| Rule | Infimeety today |
| --- | --- |
| OSI-approved license for every component, no commercial dual-licensing, no proprietary parts | ❌ No `LICENSE` yet ([step 2](#2-choose-a-license-your-decision)) |
| Actively maintained, already released in the form to be signed | ✅ v0.1.0 and v0.1.1 on GitHub Releases |
| Functionality described on the download page | ✅ README and the landing page |
| You develop the project and own the repo. Only your own binaries get signed | ✅ |
| Software that sends data needs a privacy policy. Sending to "unspecified systems" also requires showing it during install and an option to turn that off | ❌ No privacy policy yet ([step 3](#3-privacy-policy-and-code-signing-policy)) |
| Uninstall must be offered | ✅ NSIS uninstaller |
| MFA for everyone on SignPath and GitHub | ⚠️ Check ([step 4](#4-two-factor-sign-in)) |
| A "Code signing policy" section/link on the home page and download/release pages, with the SignPath attribution, team roles and privacy link | ❌ Text ready below. `publish-release.mjs` already adds the link to signed GitHub releases |
| Signed files carry product name and version metadata, enforced in SignPath | ✅ Tauri sets ProductName `Infimeety` and the version. `.signpath/artifact-configurations/` enforces both |
| Built from source on GitHub-hosted CI, every release approved by hand | ✅ `.github/workflows/release.yml` |
| **Visibility.** The Foundation checks a project's reputation before accepting it | ❌ The repo is from 25 Oct 2026 and has 0 stars |

About visibility: in October 2026, two brand-new projects were declined within about a day. The
reason given was that the program is for projects that already have public trust and visibility:
stars, forks, contributors, outside articles or discussions (Reddit, YouTube, Stack Overflow), or
institutional backing. SignPath invited them to reapply later. If you apply today, expect the
same answer.

---

## 1. Release from GitHub Actions (do this now)

SignPath only signs builds made by GitHub Actions, and CI builds are what you'll ship from now
on anyway. The v0.1.0 and v0.1.1 workflow runs failed because the updater key secret is missing.

1. GitHub → **teamcreatovert/infimeety → Settings → Secrets and variables → Actions → New
   repository secret**:
   - Name `TAURI_SIGNING_PRIVATE_KEY`
   - Value: the whole contents of `~/.tauri/infimeety.key`. To copy it:
     `Get-Content ~/.tauri/infimeety.key -Raw | Set-Clipboard`
   - Your key has no password, so skip `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. GitHub can't
     store an empty secret, and the workflow treats a missing one as "no password".
2. To ship a version, bump it in `app/package.json`, `app/src-tauri/tauri.conf.json` and
   `app/src-tauri/Cargo.toml`, commit, push `main`, then either:
   - push a tag: `git tag v0.1.2` then `git push origin v0.1.2`, or
   - **Actions → Release → Run workflow**, where you can type release notes or tick
     **dry-run** (builds, keeps the installer as a downloadable artifact, publishes nothing).
3. The workflow publishes through `app/scripts/publish-release.mjs`: the installer, its `.sig`,
   `Infimeety-Setup.exe` for the website button, and `latest.json`.

Until SignPath is connected, CI builds are unsigned too (the run shows a warning). Stop
publishing from your PC: local builds are never code-signed. Also, the tag the script creates
would start the workflow, which would then fail with "already released".

The workflow refuses to run when the tag doesn't match the version in `tauri.conf.json`, when
the version is already released, or when you try to publish a test-signed build.

## 2. Choose a license (your decision)

SignPath needs an OSI-approved license covering the whole repo (app, server, shared). Pick one
of these and add it as `LICENSE` in the repo root. On GitHub: **Add file → Create new file**,
type `LICENSE`, then **Choose a license template**.

| License | What it means for Infimeety |
| --- | --- |
| **MIT** | Shortest and most permissive. Anyone can reuse or fork the app and backend, even closed-source. |
| **Apache-2.0** | Like MIT, plus an explicit patent grant. A common choice in the Rust/Tauri world. |
| **GPL-3.0** | Anyone who distributes a modified app must publish its source. Doesn't cover someone running a modified *server* privately. |
| **AGPL-3.0** | GPL plus the network clause: anyone hosting a modified Infimeety backend for others must publish their changes. The strongest protection against closed clones of a hosted service. Some companies avoid AGPL code. |

My suggestion: **AGPL-3.0** if your priority is that every fork of this free service stays open,
**Apache-2.0** if it's the most adoption and contributors. Avoid "source-available" licenses
(BSL, Commons Clause, non-commercial clauses). They aren't OSI-approved and would disqualify the
project. Don't plan a paid closed license alongside it either: SignPath forbids commercial
dual-licensing.

Optional: also set `bundle.copyright` in `app/src-tauri/tauri.conf.json` (for example
`"Copyright © 2026 <your name>"`). Tauri writes it into the exe and installer, where it's empty
today. Complete version info looks more legitimate to some antivirus heuristics.

## 3. Privacy policy and code signing policy

**Privacy policy.** Infimeety sends data, so it needs a short policy, for example a
`privacy.html` on infimeety.pages.dev. Cover what it collects and where it goes:

- Sign-in through Google or Discord: account id, email, name, photo
- Profiles, channels, rooms and chat messages, stored on Cloudflare (Workers, Durable Objects,
  D1). Custom avatars in Workers KV
- Voice, video, screen share and shared media go directly between users' PCs (WebRTC). Media
  files are never uploaded. A TURN relay forwards encrypted traffic when a direct connection
  fails
- Update checks to GitHub Releases
- How to delete an account or data, and a contact address

The Google OAuth consent screen asks for a privacy policy link too, so one page covers both. When
you apply, ask SignPath whether they also want it shown in the installer.

**Code signing policy.** Add this section to `README.md` once SignPath approves you. The
"Code signing policy" link must also appear on the website (it's the download page), so add a
link to `#code-signing-policy` in the footer of `server/pages/public/index.html`.
`publish-release.mjs` adds the same link to GitHub release pages automatically once the
installer is properly signed.

```markdown
## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

- Committers and reviewers: [@teamcreatovert](https://github.com/teamcreatovert)
- Approvers: [@teamcreatovert](https://github.com/teamcreatovert)

Every Windows release is built from this repository by the
[Release workflow](.github/workflows/release.yml) on GitHub Actions and signed only after an
approver confirms it.

Privacy: see the [privacy policy](https://infimeety.pages.dev/privacy). Infimeety only sends
data needed for the features you use: signing in, chat, calls and update checks.
```

## 4. Two-factor sign-in

GitHub → **Settings → Password and authentication → Enable two-factor authentication**. Do the
same on SignPath once you have an account. The terms require it for everyone on the project.

## 5. Apply to SignPath Foundation

Get some visibility before applying: stars, a few outside mentions (a Reddit post, a short
video), contributors. A declined project can reapply, but there's no point applying the week
the repo goes public.

Apply at <https://signpath.org/apply> (about 15 minutes). The form asks for:

- **Repository URL:** `https://github.com/teamcreatovert/infimeety`
- **License:** the one from step 2
- **Download URL:** `https://github.com/teamcreatovert/infimeety/releases` (and the landing page)
- **Description**, in English: what Infimeety is, who uses it, and what gets signed: an NSIS
  installer (`Infimeety_<version>_x64-setup.exe`) and the app (`infimeety.exe`), built by
  GitHub Actions on GitHub-hosted runners
- A contact email you read. Everything after this happens by email

SignPath publishes no review time or status page. Reported waits: declines within a day,
approvals from about a week to about two months, and in one case three-plus weeks of silence.

## 6. After approval: connect SignPath

About an hour, in [app.signpath.io](https://app.signpath.io) and GitHub. SignPath's onboarding
email may do some of this for you. Keep the names below where you can, so nothing in the
workflow needs to change.

1. Copy your **Organization ID**.
2. Project slug: `infimeety`. If it's different, set the variable in step 7.
3. **Trusted build systems:** add the predefined **GitHub.com** one and link it to the project.
   Install the SignPath GitHub App for the repo if they ask.
4. **Artifact configurations:** create two, with these slugs and with the contents of these
   files (or send the files to SignPath if they set it up):
   - `app` ← `.signpath/artifact-configurations/app.xml`
   - `installer` ← `.signpath/artifact-configurations/installer.xml`

   Both take a `version` parameter, which the workflow sends, and both lock product name and
   version.
5. **Signing policies:** Foundation projects get a test policy (SignPath's test certificate) and
   a release policy (the Foundation certificate, needing your approval each time). The workflow
   expects `release-signing` and `test-signing`. Make yourself the approver.
6. Create a **CI user** that can submit to both policies, and copy its **API token**.
7. GitHub → **Settings → Secrets and variables → Actions**:
   - Secret `SIGNPATH_API_TOKEN` ← the CI user's token
   - Variable `SIGNPATH_ORGANIZATION_ID` ← your organization id. **Setting this turns signing on.**
   - Only if your names differ: variables `SIGNPATH_PROJECT_SLUG` and
     `SIGNPATH_SIGNING_POLICY_SLUG`
8. Add the code signing policy section (step 3) to the README and the website.

## 7. First signed release

1. **Test run:** set the variable `SIGNPATH_SIGNING_POLICY_SLUG` = `test-signing`, then
   **Actions → Release → Run workflow** with **dry-run** ticked. Two signing requests appear in
   SignPath (exe, then installer). Approve them if asked. Download the `…-dry-run` artifact and
   check **right-click → Properties → Digital Signatures**. A test certificate shows as untrusted.
   That's expected.
2. **Real release:** delete `SIGNPATH_SIGNING_POLICY_SLUG` (back to `release-signing`), bump the
   version and push the tag. SignPath emails you twice per release: first `infimeety.exe`, a few
   minutes later the installer. Each request waits up to 2 hours for your approval. If one times
   out, use **Re-run failed jobs**.
3. Check the published `Infimeety-Setup.exe`:
   `Get-AuthenticodeSignature .\Infimeety-Setup.exe | Format-List Status, SignerCertificate`
   should say `Valid` and `SignPath Foundation`. Installed apps keep updating as before: the
   updater signature is made after code signing.

---

## How the workflow signs

`.github/workflows/release.yml`, in order:

1. `tauri build --bundles nsis` with updater artifacts turned off. This compiles
   `infimeety.exe` and stamps its bundle type (the installer it also makes gets replaced).
2. Upload `infimeety.exe` → SignPath (`app`) → put the signed exe back in `target/release`.
3. `tauri bundle --no-binary-patching` rebuilds the installer around the signed exe. Tested
   locally: the flag leaves the exe byte-for-byte unchanged, and the NSIS script packs
   `target/release/infimeety.exe` directly, so the signature survives. Without the flag, Tauri
   rewrites the exe and breaks its signature.
4. Upload the installer → SignPath (`installer`) → the signed installer replaces the unsigned one.
5. Check both signatures. Release builds must be `Valid`.
6. `tauri signer sign --app-version <version>` makes the updater `.sig` over the final bytes.
   The `.sig` covers exact bytes, so it must come last, or every installed app would reject the
   update.
7. `publish-release.mjs` creates the release, `Infimeety-Setup.exe` and `latest.json`.

Without `SIGNPATH_ORGANIZATION_ID`, steps 2–5 are skipped and the build ships unsigned, as now.

**Why not `bundle.windows.signCommand`?** Tauri runs that command on each file while it bundles,
which suits a certificate on your PC or a signing service with a command-line tool. SignPath
Foundation signs only artifacts uploaded from the workflow run (it checks where they came from),
and each release needs your approval, so it can't run inside `signCommand`. If you ever get a
certificate or service with a CLI, switch to `signCommand`: it's simpler and also signs the
uninstaller.

**Known limits**

- `uninstall.exe` and the small NSIS helper DLLs the installer unpacks to a temp folder stay
  unsigned. Tauri signs the uninstaller only through `signCommand`. SignPath allows unsigned
  files inside a signed installer but asks for as much coverage as possible.
- Signatures name **SignPath Foundation** as the publisher.
- SmartScreen can still warn on the first downloads of a new version until reputation builds.
- Two approval clicks per release.

---

## Meanwhile: false-positive reports

Every release is a new file with a new hash, so report each version that gets flagged. Start
with whatever your friends' antivirus said, and keep their screenshot: most forms want the
detection name.

1. Download the exact file from the release (`Infimeety-Setup.exe`). If a friend's antivirus
   flagged the installed app instead, use `%LOCALAPPDATA%\Infimeety\infimeety.exe`.
2. Upload it to <https://www.virustotal.com>, copy the link and note any detection names.
3. Submit it to each vendor that flags it:

| Vendor | Where | Notes |
| --- | --- | --- |
| **Microsoft** (Defender, SmartScreen) | <https://www.microsoft.com/en-us/wdsi/filesubmission> | Choose **Software developer**, then the product (**Microsoft Defender Antivirus** or **Microsoft Defender SmartScreen**), then **Incorrectly detected as malware/malicious**. 50 MB max. Medium priority means an analyst looks within a few days. Sign in with a Microsoft account to track it. |
| **Avast** (AVG shares its engine) | <https://www.avast.com/submitsample> → **False positive** ([help](https://support.avast.com/en-us/article/submit-file-url/)) | Wants your email, the detection name and the alert ID |
| **Norton** | Norton Submission Portal → **False positive** ([help](https://support.norton.com/sp/en/us/home/current/solutions/kb20090410134005EN)) | |
| **Kaspersky** | <https://opentip.kaspersky.com> → upload → **Submit to reanalyze** ([help](https://support.kaspersky.com/1870)) | If Kaspersky on your own PC blocks the upload, use a browser on a PC without it. |
| **360 Total Security** | <https://www.360totalsecurity.com/en/suspicion/> → **False Positive Files** | 20 MB max. Needs email and a screenshot. In the app: menu → Feedback → Report false positive |
| **Bitdefender** | <https://www.bitdefender.com/submit/> | |
| **ESET** | Email `samples@eset.com` ([KB141](https://support.eset.com/en/kb141-submit-a-virus-website-or-potential-false-positive-sample-to-the-eset-lab)) | Zip the file with the password `infected`. Subject: "False positive" |

Something like this works for the description field:

> Infimeety is a free voice and chat app for Windows (Tauri: Rust + WebView2), built from
> public source at https://github.com/teamcreatovert/infimeety by GitHub Actions.
> File: Infimeety_<version>_x64-setup.exe, SHA-256 <hash>, from
> https://github.com/teamcreatovert/infimeety/releases. VirusTotal: <link>. Microsoft Defender
> finds nothing. Your product blocks the installer while it writes infimeety.exe, so users
> can't install it. Please review and remove the detection.

Get the hash with `Get-FileHash .\Infimeety-Setup.exe` (SHA-256 is the default).

**What friends can do right now:** allow the installer in their antivirus (restore it from
quarantine and add it to the trust or exclusions list, for example
`%LOCALAPPDATA%\Infimeety`), then run it again. For the SmartScreen "Windows protected your PC"
screen: **More info → Run anyway**.

## Sources

- SignPath Foundation terms: <https://signpath.org/terms>
- SignPath GitHub Actions integration: <https://docs.signpath.io/trusted-build-systems/github>
- SignPath artifact configuration syntax: <https://docs.signpath.io/artifact-configuration/syntax>
- Microsoft, code signing options: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- Microsoft Store, free individual accounts: <https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/>
- Microsoft Store EXE/MSI rules: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements>
- SignPath declines and waits (community reports):
  [ravi-bhu/network-speed-monitor#32](https://github.com/ravi-bhu/network-speed-monitor/issues/32),
  [SAPHO](https://www.nipscern.com/news/signpath-foundation-sapho-oss),
  [zenn.dev write-up](https://zenn.dev/shm_7ec/articles/signpath-oss-code-signing?locale=en)
