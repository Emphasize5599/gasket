<#
  Creates Gasket's release signing key on this PC. Run it once:

      powershell -ExecutionPolicy Bypass -File .\new-signing-key.ps1

  - The keystore is written to D:\Personal\Working\Gasket\gasket-release.jks (change it with -Dir).
  - The password is random. It's never shown on screen; a copy encrypted for your Windows account
    (DPAPI) is saved next to the keystore, and show-signing-password.ps1 can copy it back to the clipboard.
  - It then puts, one at a time, the two values Claude's cloud sessions need on the clipboard:
    KS_PASS (the password) and GASKET_KEYSTORE_B64 (the keystore). Paste each into the cloud environment's
    settings, never into a chat. The clipboard is cleared at the end.
  - It uses keytool from Java if you have it. If not, it downloads a portable Java (Eclipse Temurin JRE 21)
    to a temporary folder and deletes it afterwards. Nothing is installed.
  - It never overwrites an existing keystore.
#>
param(
    [string]$Dir = 'D:\Personal\Working\Gasket'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$Ks = Join-Path $Dir 'gasket-release.jks'
$PassFile = Join-Path $Dir 'gasket-release.password.dpapi'
$Alias = 'gasket'

if (Test-Path -LiteralPath $Ks) {
    if (-not (Test-Path -LiteralPath $PassFile)) {
        throw "There's a keystore at $Ks but no password backup next to it, so it's most likely left over from a run that failed and can't be used. If you never pasted its values anywhere, delete it and run this again."
    }
    throw "There's already a keystore at $Ks. This script never overwrites one; move it away first if you really mean to make a new key."
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# Built under temporary names and moved into place only once everything worked, so a failure leaves nothing behind.
$stamp = [guid]::NewGuid().ToString('N')
$KsTmp = Join-Path $Dir ".gasket-release.$stamp.jks"
$PassTmp = Join-Path $Dir ".gasket-release.$stamp.dpapi"
$tempJava = $null
$done = $false
function Find-Keytool {
    $cmd = Get-Command keytool -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if ($env:JAVA_HOME) {
        foreach ($name in @('keytool.exe', 'keytool')) {
            $p = Join-Path (Join-Path $env:JAVA_HOME 'bin') $name
            if (Test-Path -LiteralPath $p) { return $p }
        }
    }
    return $null
}

# keytool writes its progress to stderr. Windows PowerShell 5.1 turns those lines into errors, and
# $ErrorActionPreference = 'Stop' would then abort, so run it with 'Continue' and judge it by its exit code.
function Invoke-Keytool([string[]]$KtArgs) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $keytool @KtArgs 2>&1 | ForEach-Object { "$_" }
        return @{ Code = $LASTEXITCODE; Out = @($out) }
    }
    finally { $ErrorActionPreference = $old }
}

function Wait-Enter([string]$what) {
    [void](Read-Host "$what Press Enter when you've done that")
}

try {
    $keytool = Find-Keytool
    if (-not $keytool) {
        Write-Host 'No Java found. Downloading a portable Java (Eclipse Temurin JRE 21) to a temporary folder...'
        $tempJava = Join-Path ([IO.Path]::GetTempPath()) ('gasket-java-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tempJava | Out-Null
        $zip = Join-Path $tempJava 'jre.zip'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse' -OutFile $zip
        Expand-Archive -LiteralPath $zip -DestinationPath $tempJava
        $found = Get-ChildItem -LiteralPath $tempJava -Recurse -Filter 'keytool.exe' | Select-Object -First 1
        if (-not $found) { throw 'The downloaded Java has no keytool.exe.' }
        $keytool = $found.FullName
    }

    # 32 random bytes -> about 43 letters and digits. keytool reads it from an environment variable of this
    # process only, so it never appears on a command line or on screen.
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $pass = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
    $env:GASKET_NEW_KS_PASS = $pass

    Write-Host "Creating the key (RSA 4096). This takes a few seconds..."
    $r = Invoke-Keytool @('-genkeypair', '-keystore', $KsTmp, '-storetype', 'PKCS12', '-alias', $Alias, '-keyalg', 'RSA',
        '-keysize', '4096', '-validity', '10000', '-dname', 'CN=Gasket',
        '-storepass:env', 'GASKET_NEW_KS_PASS', '-keypass:env', 'GASKET_NEW_KS_PASS')
    if ($r.Code -ne 0 -or -not (Test-Path -LiteralPath $KsTmp)) { throw ('keytool could not create the keystore: ' + ($r.Out -join ' ')) }

    $r = Invoke-Keytool @('-list', '-v', '-keystore', $KsTmp, '-storepass:env', 'GASKET_NEW_KS_PASS', '-alias', $Alias)
    if ($r.Code -ne 0) { throw ('The new keystore could not be read back: ' + ($r.Out -join ' ')) }
    $sha1 = ($r.Out | Select-String -Pattern 'SHA1:\s*(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value
    $sha256 = ($r.Out | Select-String -Pattern 'SHA256:\s*(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value

    # backup of the password that only this Windows account can decrypt
    ConvertTo-SecureString -String $pass -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $PassTmp
    Move-Item -LiteralPath $PassTmp -Destination $PassFile -Force
    Move-Item -LiteralPath $KsTmp -Destination $Ks
    $done = $true

    Write-Host ''
    Write-Host 'Key created. Now give the cloud sessions the two values, one at a time.'
    Write-Host 'Open the cloud environment settings (environment menu in the session title bar -> Edit).'
    Write-Host ''
    Set-Clipboard -Value $pass
    Wait-Enter 'Step 1 of 2: the PASSWORD is on your clipboard. Add an environment variable named KS_PASS and paste it as the value. Also save it in your password manager.'
    Set-Clipboard -Value ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Ks)))
    Wait-Enter 'Step 2 of 2: the KEYSTORE is on your clipboard. Add an environment variable named GASKET_KEYSTORE_B64 and paste it as the value. Then save the settings.'
    Set-Clipboard -Value ' '

    Write-Host ''
    Write-Host 'Done. The clipboard has been cleared.'
    Write-Host "  Keystore:           $Ks"
    Write-Host "  Password backup:    $PassFile (only your Windows account can read it)"
    Write-Host "  Certificate SHA-1:  $sha1"
    Write-Host "  Certificate SHA-256: $sha256"
    Write-Host ''
    Write-Host 'Back up the keystore and the password together (the password manager is a good place for both).'
    Write-Host 'Without them you can never ship an update to installs signed with this key.'
    Write-Host 'Add com.bensanzone.fuelmap with the SHA-1 above to your Google API key restriction in Google Cloud Console.'
}
finally {
    Remove-Item Env:GASKET_NEW_KS_PASS -ErrorAction SilentlyContinue
    $pass = $null
    if (-not $done) {
        foreach ($f in @($KsTmp, $PassTmp)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } }
    }
    if ($tempJava -and (Test-Path -LiteralPath $tempJava)) { Remove-Item -LiteralPath $tempJava -Recurse -Force -ErrorAction SilentlyContinue }
}
