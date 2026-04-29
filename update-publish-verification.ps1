param(
    [int]$VerificationTimeoutMinutes = 60
)

$scriptPath = Join-Path $PSScriptRoot "update-all.ps1"
& $scriptPath -AutomationPhase publish-verification -VerificationTimeoutMinutes $VerificationTimeoutMinutes
exit $LASTEXITCODE
