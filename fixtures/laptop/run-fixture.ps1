# The free IVR fixture.
#
# CALL-E dials your phone. You answer on speakerphone and put the phone next to the laptop.
# This script plays a synthetic phone menu into the call and records the whole thing through
# the laptop microphone, so the DTMF tones CALL-E sends land in the recording. Afterwards,
# `npm run dtmf -- <recording>` reads out exactly which keys were pressed and when.
#
# Open loop on purpose: the menu does not branch, it just advances. We are not testing whether
# a menu can branch — we are testing whether CALL-E presses keys at all, and whether the keys
# it presses are the ones the task prose told it to press. An open loop answers both, and it
# needs no carrier, no phone number, and no money.
#
#   powershell -ExecutionPolicy Bypass -File fixtures\laptop\run-fixture.ps1
#
# Optional: -MicDevice "<name>"  (default is the Realtek array; run
#   ffmpeg -list_devices true -f dshow -i dummy   to see yours)

param(
    [string]$MicDevice = 'Microphone Array (3- Realtek(R) Audio)',
    [int]$KeyWaitSeconds = 7,
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'

$audioDir = Join-Path $PSScriptRoot 'audio'
if (-not (Test-Path (Join-Path $audioDir '01-menu1.wav'))) {
    Write-Host 'Menu audio missing. Run make-audio.ps1 first.' -ForegroundColor Yellow
    exit 1
}

$recDir = Join-Path $PSScriptRoot 'recordings'
if (-not (Test-Path $recDir)) { New-Item -ItemType Directory -Path $recDir | Out-Null }
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutFile = Join-Path $recDir "call-$stamp.wav"
}

Write-Host ''
Write-Host '  1. Start the probe in the other terminal so CALL-E dials you.'
Write-Host '  2. Answer, switch to SPEAKERPHONE, put the phone next to this laptop.'
Write-Host '  3. Come back here and press Enter the moment the call connects.'
Write-Host ''
Read-Host 'Press Enter when the call is connected'

# 8 kHz mono 16-bit is exactly what the decoder expects, and it is the telephone band anyway.
$ffArgs = @(
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'dshow', '-i', "audio=$MicDevice",
    '-ac', '1', '-ar', '8000', '-sample_fmt', 's16',
    $OutFile
)
$rec = Start-Process -FilePath 'ffmpeg' -ArgumentList $ffArgs -PassThru -NoNewWindow -RedirectStandardInput 'NUL'
Start-Sleep -Milliseconds 800
Write-Host "recording -> $OutFile" -ForegroundColor Green

function Play($file) {
    $player = New-Object System.Media.SoundPlayer (Join-Path $audioDir $file)
    $player.PlaySync()
    $player.Dispose()
}

try {
    Write-Host 'playing: main menu'
    Play '01-menu1.wav'
    Write-Host "  waiting ${KeyWaitSeconds}s for a keypress..."
    Start-Sleep -Seconds $KeyWaitSeconds

    Write-Host 'playing: claims submenu'
    Play '02-menu2.wav'
    Write-Host "  waiting ${KeyWaitSeconds}s for a keypress..."
    Start-Sleep -Seconds $KeyWaitSeconds

    Write-Host 'playing: hold'
    Play '03-hold.wav'

    Write-Host 'playing: representative'
    Play '04-leaf.wav'
    Write-Host '  giving the caller 12s to respond...'
    Start-Sleep -Seconds 12
}
finally {
    Write-Host 'stopping recording'
    Stop-Process -Id $rec.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
}

Write-Host ''
Write-Host "Recording saved: $OutFile"
Write-Host 'Now decode which keys were pressed:'
Write-Host "  npm run dtmf -- `"$OutFile`""
