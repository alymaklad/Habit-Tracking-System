<#
    Creates a Desktop shortcut that launches the built app.

    Also generates the .ico, because a shortcut pointing at electron.exe would
    otherwise wear Electron's own logo rather than the app's mark.

    Run:  npm run shortcut
#>

[CmdletBinding()]
param(
    # Where to put the shortcut. Defaults to the Desktop.
    [string] $Destination = [Environment]::GetFolderPath('Desktop'),
    [string] $ShortcutName = 'Adaptive Habit League',
    # Remove the shortcut instead of creating it.
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$linkPath = Join-Path $Destination "$ShortcutName.lnk"

if ($Uninstall) {
    if (Test-Path $linkPath) {
        Remove-Item $linkPath -Force
        Write-Output "Removed $linkPath"
    } else {
        Write-Output "Nothing to remove at $linkPath"
    }
    exit 0
}

# ---------------------------------------------------------------- preflight

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$entry = Join-Path $root 'out\main\index.js'

if (-not (Test-Path $electron)) {
    throw "Electron is not installed. Run 'npm install' first (looked for $electron)."
}
if (-not (Test-Path $entry)) {
    throw "The app has not been built. Run 'npm run build' first (looked for $entry)."
}

# ------------------------------------------------------------------- icon
# The app mark: a violet hexagon with a dark flame, matching the tray icon and
# the rank badge in the sidebar.

Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Everything below is authored in a 32-unit space and scaled up, so the shape
# stays identical to the SVG used for the tray.
$s = $size / 32.0
function P([double] $x, [double] $y) {
    return New-Object System.Drawing.PointF(($x * $s), ($y * $s))
}

$hex = New-Object System.Drawing.Drawing2D.GraphicsPath
$hex.AddPolygon(@((P 16 1.5), (P 29.5 9.25), (P 29.5 22.75), (P 16 30.5), (P 2.5 22.75), (P 2.5 9.25)))

$violet = [System.Drawing.ColorTranslator]::FromHtml('#B07CFF')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#141018')

$brush = New-Object System.Drawing.SolidBrush($violet)
$g.FillPath($brush, $hex)

# Flame: a teardrop with a pinched tip. Bold rather than intricate, so it still
# reads at 16 px in the taskbar.
$flame = New-Object System.Drawing.Drawing2D.GraphicsPath
$flame.AddBezier((P 16 7), (P 19 11), (P 22 13.5), (P 22 17.5))
$flame.AddBezier((P 22 17.5), (P 22 22.5), (P 19.5 25.5), (P 16 25.5))
$flame.AddBezier((P 16 25.5), (P 12.5 25.5), (P 10 22.5), (P 10 17.5))
$flame.AddBezier((P 10 17.5), (P 10 13.5), (P 13 11), (P 16 7))
$flame.CloseFigure()

$inkBrush = New-Object System.Drawing.SolidBrush($ink)
$g.FillPath($inkBrush, $flame)

$g.Dispose()

# Wrap the PNG in an ICO container. Windows Vista and later read PNG-compressed
# icon entries directly, so no DIB conversion is needed.
$png = New-Object System.IO.MemoryStream
$bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $png.ToArray()
$png.Dispose()
$bitmap.Dispose()

$assetsDir = Join-Path $root 'assets'
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }
$icoPath = Join-Path $assetsDir 'app.ico'

$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([uint16]0)                 # reserved
$w.Write([uint16]1)                 # type: icon
$w.Write([uint16]1)                 # image count
$w.Write([byte]0)                   # width  (0 means 256)
$w.Write([byte]0)                   # height (0 means 256)
$w.Write([byte]0)                   # palette size
$w.Write([byte]0)                   # reserved
$w.Write([uint16]1)                 # colour planes
$w.Write([uint16]32)                # bits per pixel
$w.Write([uint32]$pngBytes.Length)  # payload size
$w.Write([uint32]22)                # payload offset (6 + 16)
$w.Write($pngBytes)
$w.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
$w.Dispose()
$ico.Dispose()

# --------------------------------------------------------------- shortcut

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = $electron
$link.Arguments = "`"$entry`""
$link.WorkingDirectory = $root
$link.IconLocation = "$icoPath,0"
$link.Description = 'Adaptive Habit League - habit tracker with Google Tasks sync'
$link.WindowStyle = 1
$link.Save()

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

Write-Output "Icon:     $icoPath"
Write-Output "Shortcut: $linkPath"
Write-Output "Target:   $electron"
Write-Output "Argument: $entry"
