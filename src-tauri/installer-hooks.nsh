; D-Terminal NSIS installer hook'ları.
; Tauri 2 `bundle.windows.nsis.installerHooks` config'i ile kayıtlanır.
;
; Sebep: Önceki kurulumdan kalan process'ler (d-terminal.exe ve sidecar
; dterminal-pty-bridge.exe) çalışıyorsa NSIS dosya üzerine yazma denerken
; "Dosya yazmak için açılırken hata meydana geldi" diyalogu çıkar. Kullanıcı
; "Yoksay" demek zorunda kalır, kurulum yarım kalır. Pre-install hook ile
; bu process'leri sessizce sonlandırıyoruz.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Önceki D-Terminal süreçleri durduruluyor..."
  ; /F = force, /T = process tree (alt process'ler dahil). Hata yutulur:
  ; process zaten yoksa taskkill 128 dönüyor, kurulum devam etsin.
  nsExec::Exec 'taskkill /F /IM d-terminal.exe /T'
  nsExec::Exec 'taskkill /F /IM dterminal-pty-bridge.exe /T'
  ; Windows file handle'ları release etsin diye kısa bekleme (ms).
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "D-Terminal süreçleri durduruluyor..."
  nsExec::Exec 'taskkill /F /IM d-terminal.exe /T'
  nsExec::Exec 'taskkill /F /IM dterminal-pty-bridge.exe /T'
  Sleep 500
!macroend
