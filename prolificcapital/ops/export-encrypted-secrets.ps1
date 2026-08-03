<#
.SYNOPSIS
  Export Pipeline secrets with encryption
.PARAMETER Method
  DPAPI (same-machine only) or Password (portable)
.PARAMETER OutputDir
  Output directory for encrypted bundle
#>
param(
  [ValidateSet('DPAPI','Password')]
  [string]$Method = 'DPAPI',
  [string]$OutputDir = (Join-Path $PSScriptRoot '..' 'backups')
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bundleDir = Join-Path $OutputDir "secrets-bundle-$timestamp"
New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

$secrets = @{}
$envPath = Join-Path $PSScriptRoot '..' 'secrets' '.env'
if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$') {
      $secrets[$matches[1]] = $matches[2].Trim()
    }
  }
}

$manifest = @{
  exportedAt = (Get-Date -Format 'o')
  hostname = $env:COMPUTERNAME
  method = $Method
  keys = @($secrets.Keys | Sort-Object)
}

$json = $secrets | ConvertTo-Json

if ($Method -eq 'DPAPI') {
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    [System.Text.Encoding]::UTF8.GetBytes($json),
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $outPath = Join-Path $bundleDir 'secrets.encrypted'
  [System.IO.File]::WriteAllBytes($outPath, $encrypted)
  $manifest.encryption = 'DPAPI-CurrentUser'
} else {
  $secure = Read-Host -AsSecureString 'Enter encryption password'
  $password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
  $salt = [byte[]]::new(16)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($salt)
  $key = [System.Security.Cryptography.DeriveBytes]::new(
    [System.Security.Cryptography.Rfc2898DeriveBytes],
    $password, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256
  ).GetBytes(32)
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Key = $key
  $aes.GenerateIV()
  $encryptor = $aes.CreateEncryptor()
  $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $encrypted = $encryptor.TransformFinalBlock($plainBytes, 0, $plainBytes.Length)
  $bundle = $salt + $aes.IV + $encrypted
  $outPath = Join-Path $bundleDir 'secrets.encrypted'
  [System.IO.File]::WriteAllBytes($outPath, $bundle)
  $manifest.encryption = 'AES256-PBKDF2'
}

$manifestPath = Join-Path $bundleDir 'manifest.json'
$manifest | ConvertTo-Json | Out-File $manifestPath -Encoding UTF8
$manifestHash = (Get-FileHash $manifestPath -Algorithm SHA256).Hash

Write-Host "Secrets exported: $bundleDir" -ForegroundColor Green
Write-Host "Method: $Method | Keys: $($manifest.keys.Count) | Manifest: $manifestHash"
