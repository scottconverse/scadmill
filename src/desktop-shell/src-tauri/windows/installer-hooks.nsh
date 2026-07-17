!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "Software\Classes\OpenSCAD model\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.scad" "OpenSCAD model_backup"
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.scad" ""
  ${If} $R0 == ""
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.scad" ""
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.scad"
  ${EndIf}
!macroend
