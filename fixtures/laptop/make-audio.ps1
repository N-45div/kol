# Generates the synthetic IVR menu as WAV files using the Windows speech engine.
# Offline, no API key, no vendor. Run once.
#
#   powershell -ExecutionPolicy Bypass -File fixtures\laptop\make-audio.ps1

Add-Type -AssemblyName System.Speech

$outDir = Join-Path $PSScriptRoot 'audio'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# A deliberately flat, synthetic delivery. A menu that sounds like a person invites CALL-E to
# talk back instead of pressing keys, which would make the probe measure the wrong thing.
$segments = @{
    '01-menu1' = 'Thank you for calling Fixture Health Plan. This is a test line. ' +
                 'Please listen carefully, as our menu options have recently changed. ' +
                 'For member eligibility, press 1. For claims, press 2. ' +
                 'For provider services, press 3. To repeat this menu, press 9.'

    '02-menu2' = 'Claims. For the status of an existing claim, press 1. ' +
                 'To file a new claim, press 2. To speak with a representative, press 0.'

    '03-hold'  = 'Thank you. Connecting you to a claims representative. ' +
                 'Your call is important to us. Please continue to hold. ' +
                 'All of our representatives are currently assisting other callers. ' +
                 'Please continue to hold. Thank you for your patience.'

    '04-leaf'  = 'Claims department, this is Dana speaking. Let me look that up for you. ' +
                 'Claim four four seven one was paid on August twelfth, in the amount of ' +
                 'one thousand two hundred and forty dollars. Your confirmation reference is ' +
                 'GREEN FALCON SEVEN. I repeat, GREEN FALCON SEVEN. ' +
                 'Is there anything else I can help you with today?'
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1

foreach ($name in ($segments.Keys | Sort-Object)) {
    $path = Join-Path $outDir "$name.wav"
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($segments[$name])
    Write-Host "wrote $path"
}

$synth.SetOutputToNull()
$synth.Dispose()

Write-Host ''
Write-Host 'Menu audio ready. Next: fixtures\laptop\run-fixture.ps1'
