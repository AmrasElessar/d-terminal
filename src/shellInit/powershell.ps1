function global:prompt {
  $exit = $LASTEXITCODE
  if ($null -eq $exit) { $exit = 0 }
  $loc = (Get-Location).Path
  $time = (Get-Date).ToString('HH:mm:ss')
  $end = "$([char]27)]133;D;$exit$([char]7)"
  $cwd = "$([char]27)]133;P;cwd=$loc$([char]7)"
  $start = "$([char]27)]133;A$([char]7)"
  $head = "$([char]27)]0;PS $loc$([char]7)"
  $body = "$([char]27)[38;5;243m$time$([char]27)[0m $([char]27)[36m❯$([char]27)[0m $([char]27)[33m$loc$([char]27)[0m $([char]27)[35m›$([char]27)[0m "
  $cmd_start = "$([char]27)]133;B$([char]7)"
  return "$end$cwd$start$head$body$cmd_start"
}
Clear-Host
Write-Host "$([char]27)[36m┌─ D-Terminal session ready$([char]27)[0m  $([char]27)[38;5;243m($([char]27)[35mpwsh$([char]27)[38;5;243m, ConPTY, OSC 133)$([char]27)[0m"
Write-Host "$([char]27)[38;5;243m└─ ❯ type a command, $([char]27)[36mGet-Help$([char]27)[38;5;243m for built-ins$([char]27)[0m"
Write-Host ""
