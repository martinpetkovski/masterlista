# PowerShell script to manually update chart data
# This reads credentials from spotify-credentials.json and runs the generation script

$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$credentialsPath = Join-Path $scriptRoot "spotify-credentials.json"

if (-not (Test-Path $credentialsPath)) {
    Write-Error "Could not find spotify-credentials.json in $scriptRoot"
    exit 1
}

Write-Host "Reading Spotify credentials..."
try {
    $creds = Get-Content $credentialsPath -Raw | ConvertFrom-Json
}
catch {
    Write-Error "Failed to parse spotify-credentials.json"
    exit 1
}

if (-not $creds.clientId -or -not $creds.clientSecret) {
    Write-Error "spotify-credentials.json must contain clientId and clientSecret"
    exit 1
}

# Set environment variables for the node process
$env:SPOTIFY_CLIENT_ID = $creds.clientId
$env:SPOTIFY_CLIENT_SECRET = $creds.clientSecret

$nodeScript = Join-Path $scriptRoot "scripts\generate-chart-data.js"

Write-Host "Running data generation script..."
try {
    node $nodeScript
}
catch {
    Write-Error "Failed to run node script: $_"
    exit 1
}

Write-Host "Done."
