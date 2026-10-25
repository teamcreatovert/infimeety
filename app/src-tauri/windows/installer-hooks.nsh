; Hooks for Tauri's NSIS installer (bundle.windows.nsis.installerHooks).

; Runs right before the app files are copied. The installer runs without admin rights, so a
; folder picked on the directory page can be off-limits (a drive root whose permissions came
; from another Windows install, Program Files, a read-only drive). That used to stop the
; install with "Error opening file for writing". Fall back to the per-user default instead.
!macro NSIS_HOOK_PREINSTALL
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
!macroend
