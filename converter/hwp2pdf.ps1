# .hwpx -> PDF using the Hangul (HWP) program installed on this PC.
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File hwp2pdf.ps1 -InPath a.hwpx -OutPath a.pdf
param(
  [Parameter(Mandatory = $true)][string]$InPath,
  [Parameter(Mandatory = $true)][string]$OutPath
)
$ErrorActionPreference = "Stop"
$hwp = $null
try {
  $hwp = New-Object -ComObject HWPFrame.HwpObject
  $hwp.XHwpWindows.Item(0).Visible = $false
  if (-not $hwp.Open($InPath, "HWPX", "forceopen:true")) { throw "OPEN_FAILED" }
  if (-not $hwp.SaveAs($OutPath, "PDF", "")) { throw "SAVE_FAILED" }
  $hwp.Clear(1) | Out-Null   # discard changes, never touch the input
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($hwp) { try { $hwp.Quit() } catch {} }
}
