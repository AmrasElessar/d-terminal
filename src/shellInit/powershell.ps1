function global:prompt {
  $exit = $LASTEXITCODE
  if ($null -eq $exit) { $exit = 0 }
  $loc = (Get-Location).Path
  $time = (Get-Date).ToString('HH:mm:ss')
  $end = "$([char]27)]133;D;$exit$([char]7)"
  $cwd = "$([char]27)]133;P;cwd=$loc$([char]7)"
  # OSC 7 — D-Terminal git diff tracking için cwd yayını (file://[host]/path).
  # Windows path'inde ters slash forward'a çevrilir; format: file:///C:/path
  $osc7Path = "/$($loc -replace '\\', '/')"
  $osc7 = "$([char]27)]7;file://$($env:COMPUTERNAME)$osc7Path$([char]7)"
  $start = "$([char]27)]133;A$([char]7)"
  $head = "$([char]27)]0;PS $loc$([char]7)"
  $body = "$([char]27)[38;5;243m$time$([char]27)[0m $([char]27)[36m❯$([char]27)[0m $([char]27)[33m$loc$([char]27)[0m $([char]27)[35m›$([char]27)[0m "
  $cmd_start = "$([char]27)]133;B$([char]7)"
  return "$end$cwd$osc7$start$head$body$cmd_start"
}
Clear-Host
# D-Terminal banner — Splash ile aynı kalın D-T logosu, sürüm + ipucu.
# 256-color ANSI: cyan logo + magenta versiyon + dim açıklama.
$dtVersion = '0.9.4'
$psVersion = $PSVersionTable.PSVersion.ToString()
# $PSEdition built-in read-only değişken — case-insensitive collision; farklı isim:
$dtPsEdition = $PSVersionTable.PSEdition
Write-Host ""
Write-Host "$([char]27)[36m  ██████╗     ████████╗$([char]27)[0m"
Write-Host "$([char]27)[36m  ██╔══██╗    ╚══██╔══╝$([char]27)[0m"
Write-Host "$([char]27)[36m  ██║  ██║━━━    ██║      $([char]27)[35mD-Terminal v$dtVersion$([char]27)[0m"
Write-Host "$([char]27)[36m  ██████╔╝       ██║      $([char]27)[38;5;243mAgent-aware Windows terminal$([char]27)[0m"
Write-Host "$([char]27)[36m  ╚═════╝        ╚═╝$([char]27)[0m"
Write-Host ""
Write-Host "$([char]27)[38;5;243m  PowerShell $psVersion  ·  $dtPsEdition  ·  ConPTY + OSC 133$([char]27)[0m"
Write-Host "$([char]27)[38;5;243m  Copyright (c) 2026 Orhan Engin OKAY (D Brand) — MIT License$([char]27)[0m"
Write-Host ""
Write-Host "$([char]27)[38;5;243m  Type $([char]27)[36mGet-Help$([char]27)[38;5;243m for built-ins, $([char]27)[36mCtrl+Shift+P$([char]27)[38;5;243m for command palette.$([char]27)[0m"
Write-Host ""
