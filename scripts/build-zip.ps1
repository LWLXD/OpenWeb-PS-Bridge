$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$zipPath = Join-Path $dist "PS-OpenWeb-Bridge-1.0.2.zip"

if (-not (Test-Path $dist)) {
    New-Item -ItemType Directory -Path $dist | Out-Null
}

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$items = @(
    "manifest.json",
    "index.html",
    "main.js",
    "styles.css",
    "README.md",
    "icons",
    "src"
) | ForEach-Object {
    Join-Path $root $_
}

Compress-Archive -Path $items -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output "Created: $zipPath"
