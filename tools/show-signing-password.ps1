<#
  Copies Gasket's keystore password back to the clipboard from the encrypted backup new-signing-key.ps1 saved.
  It only works for the Windows account that ran new-signing-key.ps1. The password is never shown on screen.

      powershell -ExecutionPolicy Bypass -File .\show-signing-password.ps1
#>
param(
    [string]$Dir = 'D:\Personal\Working\Gasket'
)
$ErrorActionPreference = 'Stop'
$PassFile = Join-Path $Dir 'gasket-release.password.dpapi'
if (-not (Test-Path -LiteralPath $PassFile)) { throw "No password backup at $PassFile." }
$secure = Get-Content -LiteralPath $PassFile | ConvertTo-SecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
Set-Clipboard -Value $pass
$pass = $null
[void](Read-Host 'The keystore password is on your clipboard. Paste it where you need it, then press Enter to clear the clipboard')
Set-Clipboard -Value ' '
