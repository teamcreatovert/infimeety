# Draws the installer's branded images (24-bit BMPs, the sizes NSIS expects) from the app icon.
# Run from this folder after changing the icon: powershell -File make-installer-art.ps1
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$icon = [System.Drawing.Image]::FromFile((Join-Path $here '..\icons\128x128@2x.png'))
$top = [System.Drawing.Color]::FromArgb(255, 79, 107, 255)     # the icon's blue
$bottom = [System.Drawing.Color]::FromArgb(255, 150, 82, 255)  # and its violet

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  return @($bmp, $g)
}

function Fill-Gradient($g, $w, $h, $angle) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $top, $bottom, $angle
  $g.FillRectangle($brush, $rect)
  # A soft light in the top corner, like the app's glass.
  $glow = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glow.AddEllipse(-$w * 0.6, -$h * 0.35, $w * 1.6, $h * 0.8)
  $pb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
  $pb.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 255, 255)
  $pb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  $g.FillPath($pb, $glow)
}

function Draw-Centered($g, $text, $font, $color, $w, $y) {
  $size = $g.MeasureString($text, $font)
  $g.DrawString($text, $font, (New-Object System.Drawing.SolidBrush $color), ($w - $size.Width) / 2, $y)
}

$white = [System.Drawing.Color]::White
$soft = [System.Drawing.Color]::FromArgb(215, 255, 255, 255)

# Welcome / finish page sidebar: 164 x 314.
$c = New-Canvas 164 314; $bmp = $c[0]; $g = $c[1]
Fill-Gradient $g 164 314 90
$shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 20, 10, 80))
$g.FillEllipse($shadow, 36, 92, 92, 18)
$g.DrawImage($icon, 34, 20, 96, 96)
Draw-Centered $g 'Infimeety' (New-Object System.Drawing.Font 'Segoe UI Semibold', 17) $white 164 128
Draw-Centered $g 'Voice rooms, chat' (New-Object System.Drawing.Font 'Segoe UI', 8.5) $soft 164 162
Draw-Centered $g 'and watch parties' (New-Object System.Drawing.Font 'Segoe UI', 8.5) $soft 164 177
Draw-Centered $g 'No time limits. Ever.' (New-Object System.Drawing.Font 'Segoe UI Semibold', 8) $white 164 280
$bmp.Save((Join-Path $here 'installer-sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()

# Page header (top right of every page): 150 x 57.
$c = New-Canvas 150 57; $bmp = $c[0]; $g = $c[1]
Fill-Gradient $g 150 57 0
$g.DrawImage($icon, 10, 10, 37, 37)
$g.DrawString('Infimeety', (New-Object System.Drawing.Font 'Segoe UI Semibold', 13), (New-Object System.Drawing.SolidBrush $white), 52, 15)
$bmp.Save((Join-Path $here 'installer-header.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()

$icon.Dispose()
'made installer-sidebar.bmp and installer-header.bmp'
