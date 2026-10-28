; D-Terminal NSIS installer hook'ları.
; Tauri 2 `bundle.windows.nsis.installerHooks` config'i ile kayıtlanır.
;
; Sebep: Önceki kurulumdan kalan process'ler (d-terminal.exe ve sidecar
; dterminal-pty-bridge.exe) çalışıyorsa NSIS dosya üzerine yazma denerken
; "Dosya yazmak için açılırken hata meydana geldi" diyalogu çıkar. Kullanıcı
; "Yoksay" demek zorunda kalır, kurulum yarım kalır. Pre-install hook ile
; bu process'leri sessizce sonlandırıyoruz.
;
; Güvenlik notları:
;   - taskkill TAM YOL ile çağrılır ("$SYSDIR\taskkill.exe"). Çıplak
;     `taskkill` CreateProcess arama sırası gereği önce installer'ın
;     bulunduğu klasöre bakar (genelde Downloads) — oraya bırakılmış sahte
;     bir taskkill.exe çalışabilirdi.
;   - Yalnızca kurulumu yapan kullanıcının süreçleri sonlandırılır
;     (/FI "USERNAME eq ..."). Çok kullanıcılı makinede başka oturumlardaki
;     D-Terminal'ler ve shell'leri öldürülmez.
;   - /T (process tree) kullanılmaz: shell'ler sidecar'ın Job Object'ine
;     bağlıdır (kill-on-close), sidecar sonlanınca onlar da kapanır; /T ise
;     kullanıcının terminalden başlattığı ilgisiz programları da öldürürdü.
;   - Hata yutulur: process yoksa taskkill 128 döner, kurulum devam eder.

!macro DTERM_KILL_RUNNING
  ReadEnvStr $0 USERNAME
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /FI "USERNAME eq $0" /IM d-terminal.exe'
  Pop $1
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /FI "USERNAME eq $0" /IM dterminal-pty-bridge.exe'
  Pop $1
  ; Windows file handle'ları release etsin diye kısa bekleme (ms).
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Önceki D-Terminal süreçleri durduruluyor..."
  !insertmacro DTERM_KILL_RUNNING
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "D-Terminal süreçleri durduruluyor..."
  !insertmacro DTERM_KILL_RUNNING
!macroend
