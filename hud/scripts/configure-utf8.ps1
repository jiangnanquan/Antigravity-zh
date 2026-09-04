<#
.SYNOPSIS
    Automatically configure PowerShell and Git to use UTF-8 encoding on Windows.
.DESCRIPTION
    1. Checks and creates the PowerShell profile.
    2. Appends UTF-8 output encoding setup to the PowerShell profile.
    3. Configures global Git options to handle UTF-8/Chinese filenames and logs correctly.
#>

$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# 1. Configure PowerShell Profile
Write-Host "Configuring PowerShell Profile..." -ForegroundColor Cyan
$profilePath = if ($env:AGY_HUD_PROFILE_PATH) { $env:AGY_HUD_PROFILE_PATH } else { $PROFILE }
$profileDir = Split-Path -Path $profilePath -Parent
if (!(Test-Path -Path $profileDir)) {
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
    Write-Host "Created Profile Directory: $profileDir" -ForegroundColor Green
}

$utf8Config = @"

# AGY-HUD UTF-8 encoding setup
# Force PowerShell console input/output encoding to UTF-8
[System.Console]::OutputEncoding = [System.Console]::InputEncoding = [System.Text.Encoding]::UTF8
`$OutputEncoding = [System.Text.Encoding]::UTF8
"@

if (Test-Path -Path $profilePath) {
    $content = Get-Content -Path $profilePath -Raw
    if ($content -notlike "*AGY-HUD UTF-8 encoding setup*") {
        Add-Content -Path $profilePath -Value $utf8Config -Encoding UTF8
        Write-Host "Appended UTF-8 configuration to existing Profile: $profilePath" -ForegroundColor Green
    } else {
        Write-Host "UTF-8 configuration already exists in Profile: $profilePath" -ForegroundColor Yellow
    }
} else {
    New-Item -ItemType File -Path $profilePath -Force | Out-Null
    Set-Content -Path $profilePath -Value $utf8Config -Encoding UTF8
    Write-Host "Created new Profile and configured UTF-8: $profilePath" -ForegroundColor Green
}

# 2. Configure Git Global Options
Write-Host "Configuring Git Global Encoding..." -ForegroundColor Cyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required but was not found on PATH."
}

Invoke-CheckedCommand -Command git -Arguments @('config', '--global', 'core.quotepath', 'false')
Invoke-CheckedCommand -Command git -Arguments @('config', '--global', 'gui.encoding', 'utf-8')
Invoke-CheckedCommand -Command git -Arguments @('config', '--global', 'i18n.commitencoding', 'utf-8')
Invoke-CheckedCommand -Command git -Arguments @('config', '--global', 'i18n.logoutputencoding', 'utf-8')
Write-Host "Git configured successfully!" -ForegroundColor Green

Write-Host "All configurations completed. Please restart your PowerShell terminal to apply changes." -ForegroundColor Cyan
