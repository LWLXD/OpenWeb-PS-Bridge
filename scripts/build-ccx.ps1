$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$version = "1.0.2"
$tempZipPath = Join-Path $dist "PS-OpenWeb-Bridge-$version.ccx.zip"
$ccxPath = Join-Path $dist "PS-OpenWeb-Bridge-$version.ccx"

if (-not (Test-Path $dist)) {
    New-Item -ItemType Directory -Path $dist | Out-Null
}

if (Test-Path $tempZipPath) {
    Remove-Item -LiteralPath $tempZipPath -Force
}

if (Test-Path $ccxPath) {
    Remove-Item -LiteralPath $ccxPath -Force
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

Compress-Archive -Path $items -DestinationPath $tempZipPath -CompressionLevel Optimal
Move-Item -LiteralPath $tempZipPath -Destination $ccxPath

Write-Output "Created: $ccxPath"
