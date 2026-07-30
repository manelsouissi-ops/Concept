Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
$envFile = Join-Path $projectRoot ".env.local"
$n8nCmd = Join-Path $env:APPDATA "npm\n8n.cmd"
$sharedStorageRoot = Join-Path $projectRoot "data"
$legacyN8nFilesRoot = Join-Path $HOME ".n8n-files"
$markerBaseUrl = "http://127.0.0.1:8000"
$allowedFileRoots = @($sharedStorageRoot, $legacyN8nFilesRoot) -join ";"
$defaultRuntimeVariables = @{
  "N8N_SHARED_STORAGE_ROOT" = $sharedStorageRoot
  "N8N_RESTRICT_FILE_ACCESS_TO" = $allowedFileRoots
  "MARKER_CONVERT_URL" = "$markerBaseUrl/convert"
  "MARKER_STATUS_URL" = "$markerBaseUrl/status"
  "MARKER_RESULT_URL" = "$markerBaseUrl/result"
  "N8N_CALLBACK_SIGNER_URL" = "http://127.0.0.1:8899/sign"
}

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing environment file: $envFile"
}

if (-not (Test-Path -LiteralPath $n8nCmd)) {
  throw "n8n launcher not found: $n8nCmd"
}

$loadedNames = New-Object System.Collections.Generic.List[string]

foreach ($rawLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
  $line = $rawLine.Trim()

  if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
    continue
  }

  $separatorIndex = $line.IndexOf("=")
  if ($separatorIndex -lt 1) {
    continue
  }

  $name = $line.Substring(0, $separatorIndex).Trim()
  $value = $line.Substring($separatorIndex + 1)

  if ([string]::IsNullOrWhiteSpace($name)) {
    continue
  }

  [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
  $loadedNames.Add($name) | Out-Null
}

if (-not (Test-Path -LiteralPath $sharedStorageRoot)) {
  throw "Shared storage root not found: $sharedStorageRoot"
}

foreach ($entry in $defaultRuntimeVariables.GetEnumerator()) {
  $currentValue = [System.Environment]::GetEnvironmentVariable($entry.Key, "Process")
  if ([string]::IsNullOrWhiteSpace($currentValue)) {
    [System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
}

$requiredVariables = @(
  "N8N_WEBHOOK_TOKEN",
  "PLATFORM_CALLBACK_TOKEN",
  "N8N_CALLBACK_SECRET",
  "N8N_SHARED_STORAGE_ROOT",
  "N8N_RESTRICT_FILE_ACCESS_TO",
  "MARKER_CONVERT_URL",
  "MARKER_STATUS_URL",
  "MARKER_RESULT_URL",
  "N8N_CALLBACK_SIGNER_URL",
  "GEMINI_API_KEY",
  "FCI_GENERATION_MODEL",
  "PLATFORM_PUBLIC_BASE_URL"
)

foreach ($name in $requiredVariables) {
  $value = [System.Environment]::GetEnvironmentVariable($name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $name"
  }
}

Write-Host "Loaded .env.local from $envFile"
Write-Host "Verified required variables: $($requiredVariables -join ', ')"
Write-Host "Using shared storage root: $sharedStorageRoot"
Write-Host "Using allowed file roots: $allowedFileRoots"
Write-Host "Using Marker base URL: $markerBaseUrl"
Write-Host "Starting n8n with process-level environment..."

& $n8nCmd start
