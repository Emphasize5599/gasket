[CmdletBinding()]
param([string]$ToolchainRoot=(Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData/Local/GasketBuild'),[string]$OutputDir=[Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$configPath=Join-Path $ToolchainRoot 'toolchain.json';$signingPath=Join-Path $ToolchainRoot 'signing.json'
if(-not(Test-Path -LiteralPath $configPath)){throw 'Run tools/setup-local-android.ps1 first'}
if(-not(Test-Path -LiteralPath $signingPath)){throw 'Run tools/register-local-signing.ps1 first'}
$config=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
$identity=Get-Content -LiteralPath $signingPath -Raw|ConvertFrom-Json
$manifest=Get-Content -LiteralPath (Join-Path $repoRoot 'AndroidManifest.xml') -Raw
$version=([regex]::Match($manifest,'android:versionName="([^"]+)"')).Groups[1].Value
$code=([regex]::Match($manifest,'android:versionCode="([^"]+)"')).Groups[1].Value
$oldJavaOptions=$env:JAVA_TOOL_OPTIONS;$oldJava=$env:JAVA_HOME;$oldSdk=$env:ANDROID_HOME;$oldSdkRoot=$env:ANDROID_SDK_ROOT;$oldGradle=$env:GRADLE_USER_HOME;$oldPass=$env:GASKET_LOCAL_SIGN_PASS
$ptr=[IntPtr]::Zero
Push-Location $repoRoot
try{
    $env:JAVA_TOOL_OPTIONS=($oldJavaOptions+' -Djava.net.preferIPv4Stack=true').Trim();$env:JAVA_HOME=$config.javaHome;$env:ANDROID_HOME=$config.androidHome;$env:ANDROID_SDK_ROOT=$config.androidHome;$env:GRADLE_USER_HOME=$config.gradleUserHome
    & $config.gradle --console=plain --no-daemon assembleRelease
    if($LASTEXITCODE -ne 0){throw 'Android build failed'}
    $secure=Get-Content -LiteralPath $identity.passwordDpapi|ConvertTo-SecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:GASKET_LOCAL_SIGN_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $signer=Join-Path $config.androidHome 'build-tools/35.0.0/apksigner.bat'
    $aapt=Join-Path $config.androidHome 'build-tools/35.0.0/aapt.exe'
    $signedDir=Join-Path $repoRoot 'build/local-signed';New-Item -ItemType Directory -Path $signedDir -Force|Out-Null
    $outputs=@()
    foreach($abi in @('arm64-v8a','universal')){
        $unsigned=Join-Path $repoRoot "build/outputs/apk/release/Gasket-$abi-release-unsigned.apk"
        $signed=Join-Path $signedDir "Gasket-$version-$abi-local.apk"
        & $signer sign --ks $identity.keystore --ks-pass env:GASKET_LOCAL_SIGN_PASS --key-pass env:GASKET_LOCAL_SIGN_PASS --min-sdk-version 31 --out $signed $unsigned
        if($LASTEXITCODE -ne 0){throw "Signing failed: $abi"}
        $verification=& $signer verify --print-certs $signed 2>&1
        if($LASTEXITCODE -ne 0){throw "Signature verification failed: $abi"}
        $match=[regex]::Match(($verification -join "`n"),'certificate SHA-256 digest:\s*([a-fA-F0-9]+)')
        if(-not $match.Success -or $match.Groups[1].Value.ToLowerInvariant() -ne $identity.certificateSha256){throw 'The APK signing certificate changed; output copy was stopped'}
        $badging=& $aapt dump badging $signed 2>&1
        if($LASTEXITCODE -ne 0 -or -not(($badging -join "`n") -match "package: name='com.bensanzone.fuelmap' versionCode='$code' versionName='$([regex]::Escape($version))'")){throw "APK package/version verification failed: $abi"}
        $outputs+=@{source=$signed;name=[IO.Path]::GetFileName($signed)}
    }
    New-Item -ItemType Directory -Path $OutputDir -Force|Out-Null
    foreach($output in $outputs){
        $destination=Join-Path $OutputDir $output.name
        if(Test-Path -LiteralPath $destination){$destination=Join-Path $OutputDir ([IO.Path]::GetFileNameWithoutExtension($output.name)+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.apk')}
        Copy-Item -LiteralPath $output.source -Destination $destination
        Get-Item -LiteralPath $destination|Select-Object FullName,Length
    }
}finally{
    Pop-Location
    $env:JAVA_TOOL_OPTIONS=$oldJavaOptions;$env:JAVA_HOME=$oldJava;$env:ANDROID_HOME=$oldSdk;$env:ANDROID_SDK_ROOT=$oldSdkRoot;$env:GRADLE_USER_HOME=$oldGradle;$env:GASKET_LOCAL_SIGN_PASS=$oldPass
    if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
    $secure=$null
}
