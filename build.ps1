param(
  [string]$Version = "1.0.0",
  [string]$Icon = "Icon.png"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

$buildDir = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$exeName = "sarpras-agent.exe"
$ldflags = "-s -w -H windowsgui -X main.version=$Version"

# regenerate version resource with requested version
$rc = Get-Content (Join-Path $root "versioninfo.rc") -Raw
$four = "$Version.0"
$rc = $rc -replace 'FILEVERSION [\d,]+', "FILEVERSION $($four -replace '\.',',')"
$rc = $rc -replace 'PRODUCTVERSION [\d,]+', "PRODUCTVERSION $($four -replace '\.',',')"
$rc = $rc -replace 'VALUE "FileVersion", "[^"]*"', "VALUE `"FileVersion`", `"$four`""
$rc = $rc -replace 'VALUE "ProductVersion", "[^"]*"', "VALUE `"ProductVersion`", `"$four`""
Set-Content -Path (Join-Path $root "versioninfo.rc") -Value $rc -NoNewline

Remove-Item (Join-Path $root "fyne.syso") -Force -ErrorAction SilentlyContinue
windres -O coff -o (Join-Path $root "resource_windows_amd64.syso") (Join-Path $root "versioninfo.rc") | Out-Null

Write-Host "Building $exeName ..."
go build -trimpath -ldflags $ldflags -o (Join-Path $buildDir $exeName) .

$zip = Join-Path $buildDir "sarpras-agent-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $buildDir $exeName) -DestinationPath $zip

$hash = (Get-FileHash -Algorithm SHA256 (Join-Path $buildDir $exeName)).Hash.ToLower()
Set-Content -Path (Join-Path $buildDir "SHA256SUMS.txt") -Value "$hash  $exeName"

Write-Host "Done: $exeName, $zip, SHA256SUMS.txt"