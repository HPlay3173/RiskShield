$ErrorActionPreference = "Stop"

$codexVersion = "0.145.0-win32-x64"
$desktopRoot = Split-Path -Parent $PSScriptRoot
$resourceRoot = Join-Path $desktopRoot "src-tauri/resources/codex"
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) "riskshield-codex-runtime"
$extractRoot = Join-Path $workRoot "extracted"

if (Test-Path $workRoot) {
    Remove-Item -Recurse -Force $workRoot
}
New-Item -ItemType Directory -Force $extractRoot | Out-Null
New-Item -ItemType Directory -Force $resourceRoot | Out-Null

$packJson = npm pack "@openai/codex@$codexVersion" --pack-destination $workRoot --json
if ($LASTEXITCODE -ne 0) {
    throw "npm pack failed for @openai/codex@$codexVersion"
}

$pack = $packJson | ConvertFrom-Json
$archive = Join-Path $workRoot $pack[0].filename
tar -xzf $archive -C $extractRoot
if ($LASTEXITCODE -ne 0) {
    throw "Could not extract $archive"
}

$packageRoot = Join-Path $extractRoot "package"
$vendorRoot = Join-Path $packageRoot "vendor/x86_64-pc-windows-msvc"
$codexBinary = Join-Path $vendorRoot "bin/codex.exe"
if (-not (Test-Path $codexBinary)) {
    throw "Official package did not contain vendor/x86_64-pc-windows-msvc/bin/codex.exe"
}

Copy-Item -Path (Join-Path $vendorRoot "*") -Destination $resourceRoot -Recurse -Force
Copy-Item -Path (Join-Path $packageRoot "package.json") -Destination $resourceRoot -Force
Copy-Item -Path (Join-Path $packageRoot "README.md") -Destination $resourceRoot -Force

$installedVersion = (Get-Content (Join-Path $resourceRoot "package.json") -Raw | ConvertFrom-Json).version
if ($installedVersion -ne "0.145.0-win32-x64") {
    throw "Unexpected bundled Codex version: $installedVersion"
}

& (Join-Path $resourceRoot "bin/codex.exe") --version
if ($LASTEXITCODE -ne 0) {
    throw "Bundled Codex executable failed its version smoke test"
}
