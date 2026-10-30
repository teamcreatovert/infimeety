; Hooks for Tauri's NSIS installer (bundle.windows.nsis.installerHooks).

; Runs right before the app files are copied.
!macro NSIS_HOOK_PREINSTALL
  ; The installer runs without admin rights, so a folder picked on the directory page can be
  ; off-limits (a drive root whose permissions came from another Windows install, Program
  ; Files, a read-only drive). That used to stop the install with "Error opening file for
  ; writing". Fall back to the per-user default instead.
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\.infimeety-write-test" w
  ${If} ${Errors}
    StrCpy $1 "$LOCALAPPDATA\${PRODUCTNAME}"
    ${If} $PassiveMode != 1
      MessageBox MB_OK|MB_ICONINFORMATION "Windows doesn't allow installing to:$\r$\n$INSTDIR$\r$\n$\r$\nInfimeety will be installed to your user folder instead:$\r$\n$1" /SD IDOK
    ${EndIf}
    StrCpy $INSTDIR $1
    SetOutPath $INSTDIR
  ${Else}
    FileClose $0
    Delete "$INSTDIR\.infimeety-write-test"
  ${EndIf}

  ; Infimeety keeps running in the tray when its window is closed, and a running copy holds its
  ; own file: writing the new one then fails with "Extract: error writing to file
  ; infimeety.exe". Close it first, wherever it runs from (Tauri's own check only looks in the
  ; install folder). A normal install asks; an update from inside the app just goes ahead.
  nsExec::Exec `cmd /c tasklist /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" /NH | find /I "${MAINBINARYNAME}.exe"`
  Pop $0
  ${If} $0 == 0
    ${If} $PassiveMode != 1
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Infimeety is open. It keeps running in the tray, by the clock, when its window is closed.$\r$\n$\r$\nClick OK to close it and continue installing." /SD IDOK IDOK infimeety_close_running
      Abort
    ${EndIf}
    infimeety_close_running:
    nsExec::Exec `taskkill /F /T /IM ${MAINBINARYNAME}.exe`
    Pop $0
    Sleep 1500
  ${EndIf}

  ; Even closed, a program file can stay locked for a moment (antivirus scanning it, a process
  ; still exiting). Windows lets a program file be renamed while it's in use, so move the old
  ; one aside: the new one never has to overwrite it. The app deletes the leftover on start.
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\${MAINBINARYNAME}.old.exe"
    Rename "$INSTDIR\${MAINBINARYNAME}.exe" "$INSTDIR\${MAINBINARYNAME}.old.exe"
    Delete "$INSTDIR\${MAINBINARYNAME}.old.exe"
  ${EndIf}
!macroend

; Runs after the app's files are removed: take the leftover from an update along.
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\${MAINBINARYNAME}.old.exe"
  RMDir "$INSTDIR"
!macroend

; Runs before the uninstaller removes anything: a copy running in the tray would keep its file.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec `cmd /c tasklist /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" /NH | find /I "${MAINBINARYNAME}.exe"`
  Pop $0
  ${If} $0 == 0
    nsExec::Exec `taskkill /F /T /IM ${MAINBINARYNAME}.exe`
    Pop $0
    Sleep 1500
  ${EndIf}
!macroend
