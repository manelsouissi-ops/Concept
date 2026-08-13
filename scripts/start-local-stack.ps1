Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Brings up the full local stack in dependency order so a missing piece
# (e.g. the callback signer) can't silently strand an n8n execution:
#   1. PostgreSQL   (Windows service)
#   2. Marker       :8000  (external repo: marker-fastapi-service)
#   3. Callback signer :8899  (scripts/n8n-tests/test_callback_capture_server.py)
#   4. n8n          :5678  (scripts/start-n8n-local.ps1)
#   5. Next.js app  (port read from PLATFORM_PUBLIC_BASE_URL in .env.local)
#
# Idempotent: any step already listening on its port is left alone.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
$envFile = Join-Path $projectRoot ".env.local"
$logDir = Join-Path $projectRoot "tmp\stack-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$postgresServiceName = "postgresql-x64-16"
$markerServiceRoot = "C:\Users\lotfi\Documents\marker-fastapi-service"
$signerScript = Join-Path $scriptDir "n8n-tests\test_callback_capture_server.py"
$n8nStartScript = Join-Path $scriptDir "start-n8n-local.ps1"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing environment file: $envFile"
}

function Test-PortOpen {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-ForPort {
  param([int]$Port, [string]$Name, [int]$TimeoutSeconds = 30)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen -Port $Port) {
      Write-Host "$Name is up on port $Port"
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$Name did not open port $Port within $TimeoutSeconds seconds. Check logs under $logDir."
}

function Get-AppPort {
  foreach ($rawLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $line = $rawLine.Trim()
    if ($line.StartsWith("PLATFORM_PUBLIC_BASE_URL=")) {
      $url = $line.Substring("PLATFORM_PUBLIC_BASE_URL=".Length).Trim()
      $parsed = [uri]$url
      if ($parsed.Port -gt 0) { return $parsed.Port }
    }
  }
  throw "Could not determine app port: PLATFORM_PUBLIC_BASE_URL not found in $envFile"
}

# 1. PostgreSQL
$pgService = Get-Service -Name $postgresServiceName -ErrorAction SilentlyContinue
if (-not $pgService) {
  throw "PostgreSQL service '$postgresServiceName' not found. Start it manually and re-run."
}
if ($pgService.Status -ne "Running") {
  Write-Host "Starting PostgreSQL service..."
  Start-Service -Name $postgresServiceName
}
Wait-ForPort -Port 5432 -Name "PostgreSQL"

# 2. Marker
if (-not (Test-PortOpen -Port 8000)) {
  if (-not (Test-Path -LiteralPath $markerServiceRoot)) {
    throw "Marker service root not found: $markerServiceRoot"
  }
  Write-Host "Starting Marker..."
  Start-Process -FilePath "python" -ArgumentList "marker_api.py" `
    -WorkingDirectory $markerServiceRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "marker.out.log") `
    -RedirectStandardError (Join-Path $logDir "marker.err.log")
  Wait-ForPort -Port 8000 -Name "Marker"
} else {
  Write-Host "Marker already running on :8000"
}

# 3. Callback signer
if (-not (Test-PortOpen -Port 8899)) {
  Write-Host "Starting callback signer..."
  Start-Process -FilePath "python" -ArgumentList "`"$signerScript`"" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "signer.out.log") `
    -RedirectStandardError (Join-Path $logDir "signer.err.log")
  Wait-ForPort -Port 8899 -Name "Callback signer"
} else {
  Write-Host "Callback signer already running on :8899"
}

# 4. n8n
if (-not (Test-PortOpen -Port 5678)) {
  Write-Host "Starting n8n..."
  Start-Process -FilePath "powershell" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$n8nStartScript`"" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "n8n.out.log") `
    -RedirectStandardError (Join-Path $logDir "n8n.err.log")
  Wait-ForPort -Port 5678 -Name "n8n" -TimeoutSeconds 60
} else {
  Write-Host "n8n already running on :5678"
}

# 5. Next.js app
$appPort = Get-AppPort
if (-not (Test-PortOpen -Port $appPort)) {
  Write-Host "Starting app on port $appPort..."
  $env:PORT = "$appPort"
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "app.out.log") `
    -RedirectStandardError (Join-Path $logDir "app.err.log")
  Wait-ForPort -Port $appPort -Name "App" -TimeoutSeconds 60
} else {
  Write-Host "App already running on :$appPort"
}

Write-Host ""
Write-Host "Local stack is up:"
Write-Host "  PostgreSQL       :5432"
Write-Host "  Marker           :8000"
Write-Host "  Callback signer  :8899"
Write-Host "  n8n              :5678"
Write-Host "  App              :$appPort"
Write-Host "Logs: $logDir"
