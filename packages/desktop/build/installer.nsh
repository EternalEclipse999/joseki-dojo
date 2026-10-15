; Spec (languages) 8.1. preInit runs right before the template's language dialog (MUI_LANGDLL_DISPLAY in installer.nsi).
!macro preInit
  ; English is preselected whatever the Windows language is.
  StrCpy $LANGUAGE 1033
!macroend

; The chosen language for the app's first start; a silent run (an update) writes nothing, so the player's language stays.
!macro customInstall
  ${IfNot} ${Silent}
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    FileOpen $0 "$APPDATA\${PRODUCT_NAME}\installer-language" w
    FileWrite $0 "$LANGUAGE"
    FileClose $0
  ${EndIf}
!macroend
