# D-Terminal installer asset generator.
#
# Tauri 2 `bundle.windows.{wix,nsis}` config'i için BMP üretir:
#   - wix-banner.bmp    493x58   (WiX üst banner, tüm sayfalarda)
#   - wix-dialog.bmp    493x312  (WiX welcome/finish sayfası arka planı)
#   - nsis-header.bmp   150x57   (NSIS üst banner)
#   - nsis-sidebar.bmp  164x314  (NSIS welcome/finish sayfası sol kolonu)
#
# Çıktı 24-bit BMP. Source: ../icons/256x256.png ortalanır, marka rengi
# (#0E1726 zemin, #3FC0CC vurgu) ile compose edilir. Brand görseli
# güncellenirse bu script'i yeniden çalıştır.

[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconPath  = Join-Path $root '..\icons\256x256.png'
$iconPath  = (Resolve-Path $iconPath).Path

$bg     = [System.Drawing.Color]::FromArgb(14, 23, 38)   # #0E1726 dark navy
$accent = [System.Drawing.Color]::FromArgb(63, 192, 204) # #3FC0CC cyan
$text   = [System.Drawing.Color]::FromArgb(230, 238, 246)

function New-Bmp {
    param(
        [int]$W, [int]$H, [string]$OutFile,
        [string]$Title, [string]$Subtitle,
        [string]$Layout  # 'horizontal' veya 'vertical'
    )
    $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear($bg)

    $icon = [System.Drawing.Image]::FromFile($iconPath)
    try {
        if ($Layout -eq 'horizontal') {
            # Banner: solda icon, sağında başlık.
            $iconSize = [Math]::Min($H - 8, 48)
            $iconX = 10
            $iconY = [int](($H - $iconSize) / 2)
            $g.DrawImage($icon, $iconX, $iconY, $iconSize, $iconSize)

            if ($Title) {
                $font  = New-Object System.Drawing.Font 'Segoe UI Semibold', ([Math]::Max(11, $H / 4)), ([System.Drawing.FontStyle]::Bold)
                $brush = New-Object System.Drawing.SolidBrush $text
                $sf    = New-Object System.Drawing.StringFormat
                $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
                $rect  = New-Object System.Drawing.RectangleF (($iconX + $iconSize + 12), 0, ($W - $iconX - $iconSize - 22), $H)
                $g.DrawString($Title, $font, $brush, $rect, $sf)
                $font.Dispose(); $brush.Dispose(); $sf.Dispose()
            }
        }
        else {
            # Sidebar/Dialog: üstte büyük icon, altında başlık + alt başlık.
            $iconSize = [Math]::Min([int]($W * 0.55), [int]($H * 0.45))
            $iconX = [int](($W - $iconSize) / 2)
            $iconY = [int]($H * 0.10)
            $g.DrawImage($icon, $iconX, $iconY, $iconSize, $iconSize)

            $titleY = $iconY + $iconSize + 16
            if ($Title) {
                $font  = New-Object System.Drawing.Font 'Segoe UI Semibold', 18, ([System.Drawing.FontStyle]::Bold)
                $brush = New-Object System.Drawing.SolidBrush $text
                $sf    = New-Object System.Drawing.StringFormat
                $sf.Alignment = [System.Drawing.StringAlignment]::Center
                $rect  = New-Object System.Drawing.RectangleF (0, $titleY, $W, 30)
                $g.DrawString($Title, $font, $brush, $rect, $sf)
                $font.Dispose(); $brush.Dispose(); $sf.Dispose()
                $titleY += 30
            }
            if ($Subtitle) {
                $font  = New-Object System.Drawing.Font 'Segoe UI', 9, ([System.Drawing.FontStyle]::Regular)
                $brush = New-Object System.Drawing.SolidBrush $accent
                $sf    = New-Object System.Drawing.StringFormat
                $sf.Alignment = [System.Drawing.StringAlignment]::Center
                $rect  = New-Object System.Drawing.RectangleF (0, $titleY, $W, 24)
                $g.DrawString($Subtitle, $font, $brush, $rect, $sf)
                $font.Dispose(); $brush.Dispose(); $sf.Dispose()
            }
        }
    } finally {
        $icon.Dispose()
    }

    $g.Dispose()
    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose()
    Write-Host "Wrote $OutFile  ($W x $H)"
}

New-Bmp -W 493 -H 58  -OutFile (Join-Path $root 'wix-banner.bmp')   -Title 'D-Terminal'                                  -Layout horizontal
New-Bmp -W 493 -H 312 -OutFile (Join-Path $root 'wix-dialog.bmp')   -Title 'D-Terminal' -Subtitle 'Agent-aware terminal'   -Layout vertical
New-Bmp -W 150 -H 57  -OutFile (Join-Path $root 'nsis-header.bmp')  -Title ''                                             -Layout horizontal
New-Bmp -W 164 -H 314 -OutFile (Join-Path $root 'nsis-sidebar.bmp') -Title 'D-Terminal' -Subtitle 'Welcome'                -Layout vertical
