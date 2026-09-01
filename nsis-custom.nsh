; Verifica se Npcap está instalado e instala se necessário
!macro customInstall
  ReadRegStr $0 HKLM "SOFTWARE\Npcap" ""
  ${If} $0 == ""
    MessageBox MB_YESNO|MB_ICONINFORMATION \
      "O HS Drop Logger precisa do Npcap para capturar pacotes de rede.$\n$\nDeseja instalar o Npcap agora?" \
      IDNO skip_npcap
    ExecWait '"$INSTDIR\resources\npcap-installer.exe"'
    skip_npcap:
  ${EndIf}
!macroend

!macro customUnInstall
!macroend
