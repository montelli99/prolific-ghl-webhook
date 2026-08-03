<#
.SYNOPSIS
  Import Pipeline secrets from encrypted bundle
.PARAMETER Source
  Path to secrets bundle directory
.PARAMETER Method
  DPAPI or Password
.PARAMETER DryRun
  Report what would be imported without writing
#>
param(
  [Parameter(Mandatory=$true)]
  [string]$Source,
  [ValidateSet('DPAPI','Password')]
  [string]$Method = 'DPAPI',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $Source 'manifest.json'
if (-not (Test-Path $manifestPath)) { throw "Manifest not found at $manifestPath" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

$encPath = Join-Path $Source 'secrets.encrypted'
if (-not (Test-Path $encPath)) { throw "Encrypted bundle not found at $encPath" }

$encBytes = [System.IO.File]::ReadAllBytes($encPath)

if ($Method -eq 'DPAPI') {
  $json = [System.Text.Encoding]::UTF8.GetString(
    [System.Security.Cryptography.ProtectedData]::Unprotect($encBytes, $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  )
} else {
  $secure = Read-Host -AsSecureString 'Enter decryption password'
  $password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
  $salt = $encBytes[0..15]
  $iv = $encBytes[16..31]
  $cipher = $encBytes[32..($encBytes.Length - 1)]
  $key = [System.Security.Cryptography.DeriveBytes]::new(
    [System.Security.Cryptography.Rfc2898DeriveBytes],
    $password, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256
  ).GetBytes(32)
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Key = $key
  $aes.IV = $iv
  $decryptor = $aes.CreateDecryptor()
  $json = [System.Text.Encoding]::UTF8.GetString(
    $decryptor.TransformFinalBlock($cipher, 0, $cipher.Length)
  )
}

$secrets = $json | ConvertFrom-Json
$missing = @()
$present = @()

foreach ($key in $manifest.keys) {
  if ($secrets.PSObject.Properties[$key]) {
    $present += $key
  } else {
    $missing += $key
  }
}

if ($DryRun) {
  Write-Host "DRY RUN — would import $($present.Count) keys, missing $($missing.Count)"
  Write-Host "Present: $($present -join ', ')"
  if ($missing.Count -gt 0) { Write-Host "Missing: $($missing -join ', ')" -ForegroundColor Yellow }
} else {
  $envDir = Join-Path $PSScriptRoot '..' 'secrets'
  New-Item -ItemType Directory -Force -Path $envDir | Out-Null
  $envPath = Join-Path $envDir '.env'
  $existing = @{}
  if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
      if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$') { $existing[$matches[1]] = $matches[2] }
    }
  }
  foreach ($key in $present) {
    $existing[$key] = $secrets.PSObject.Properties[$key].Value
  }
  $lines = $existing.Keys | Sort-Object | ForEach-Object { "$_=$($existing[$_])" }
  $lines | Out-File $envPath -Encoding UTF8
  Write-Host "Imported $($present.Count) keys to $envPath" -ForegroundColor Green
  if ($missing.Count -gt 0) {
    Write-Host "Missing: $($missing -join ', ')" -ForegroundColor Yellow
    $report = @{ imported = $present; missing = $missing; timestamp = (Get-Date -Format 'o') }
    $report | ConvertTo-Json | Out-File (Join-Path $Source 'missing-secrets-report.json') -Encoding UTF8
  }
}
