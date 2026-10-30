[CmdletBinding()]
param([string]$KeystoreFile,[string]$KeystoreBase64File,[string]$PasswordFile,[string]$PasswordDpapiFile,[string]$ReferenceApk,[string]$ToolchainRoot=(Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData/Local/GasketBuild'))
$ErrorActionPreference='Stop'
$configPath=Join-Path $ToolchainRoot 'toolchain.json'
if(-not(Test-Path -LiteralPath $configPath)){throw 'Run tools/setup-local-android.ps1 first'}
$config=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
$signingDir=Join-Path $ToolchainRoot 'signing';New-Item -ItemType Directory -Path $signingDir -Force|Out-Null
$candidate=Join-Path $signingDir ('candidate-'+[Guid]::NewGuid().ToString('N')+'.jks')
$oldJava=$env:JAVA_HOME
$oldPass=$env:GASKET_LOCAL_SIGN_PASS
$ptr=[IntPtr]::Zero
try{
    if($KeystoreFile){Copy-Item -LiteralPath $KeystoreFile -Destination $candidate}
    elseif($KeystoreBase64File){
        $encoded=(Get-Content -LiteralPath $KeystoreBase64File -Raw).Trim()
        $encoded=$encoded -replace '^GASKET_KEYSTORE_B64\s*=\s*',''
        $encoded=$encoded.Trim([char[]]@('"',"'"))
        [IO.File]::WriteAllBytes($candidate,[Convert]::FromBase64String(($encoded -replace '\s','')))
        $encoded=$null
    }else{throw 'Supply -KeystoreFile or -KeystoreBase64File for the existing release key'}
    if($PasswordDpapiFile){$secure=Get-Content -LiteralPath $PasswordDpapiFile|ConvertTo-SecureString}
    elseif($PasswordFile){$plain=(Get-Content -LiteralPath $PasswordFile -Raw).Trim();$plain=$plain -replace '^KS_PASS\s*=\s*','';$secure=ConvertTo-SecureString $plain -AsPlainText -Force;$plain=$null}
    elseif($env:KS_PASS){$secure=ConvertTo-SecureString $env:KS_PASS -AsPlainText -Force}
    else{$secure=Read-Host 'Existing release keystore password' -AsSecureString}
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:GASKET_LOCAL_SIGN_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $keytool=Join-Path $config.javaHome 'bin/keytool.exe'
    $certificate=& $keytool -list -v -alias gasket -keystore $candidate -storepass:env GASKET_LOCAL_SIGN_PASS 2>&1
    if($LASTEXITCODE -ne 0){throw 'The existing keystore/password could not be verified'}
    $digestMatch=[regex]::Match(($certificate -join "`n"),'SHA256:\s*([0-9A-Fa-f:]+)')
    if(-not $digestMatch.Success){throw 'Could not read the keystore certificate'}
    $digest=$digestMatch.Groups[1].Value.Replace(':','').ToLowerInvariant()
    if(-not $ReferenceApk){
        $ReferenceApk=Join-Path $ToolchainRoot 'signing-reference-321.apk'
        if(-not(Test-Path -LiteralPath $ReferenceApk)){
            $repoRoot=Split-Path $PSScriptRoot -Parent;$existing=Join-Path $repoRoot 'tmp/local-android/previous-signed-321.apk'
            if(Test-Path -LiteralPath $existing){Copy-Item -LiteralPath $existing -Destination $ReferenceApk}else{Invoke-WebRequest -Uri 'https://github.com/Emphasize5599/gasket/releases/download/v0.0.321/Gasket-0.0.321-arm64-v8a.apk' -OutFile $ReferenceApk}
        }
    }
    $env:JAVA_HOME=$config.javaHome
    $signer=Join-Path $config.androidHome 'build-tools/35.0.0/apksigner.bat'
    $published=& $signer verify --print-certs $ReferenceApk 2>&1
    if($LASTEXITCODE -ne 0){throw 'Published reference APK verification failed'}
    $publishedMatch=[regex]::Match(($published -join "`n"),'certificate SHA-256 digest:\s*([a-fA-F0-9]+)')
    if(-not $publishedMatch.Success -or $publishedMatch.Groups[1].Value.ToLowerInvariant() -ne $digest){throw 'The supplied key differs from the published app. No signing identity was registered.'}
    $destination=Join-Path $signingDir 'gasket-release.jks'
    if(Test-Path -LiteralPath $destination){if((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $candidate).Hash){throw 'A different local keystore file already exists; it was preserved'}}else{Copy-Item -LiteralPath $candidate -Destination $destination}
    $protectedPath=Join-Path $signingDir 'gasket-release.password.dpapi'
    $secure|ConvertFrom-SecureString|Set-Content -LiteralPath $protectedPath -Encoding ascii
    @{schema=1;keystore=$destination;passwordDpapi=$protectedPath;certificateSha256=$digest}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $ToolchainRoot 'signing.json') -Encoding utf8
    Write-Host 'Existing release identity verified against the published APK and registered locally.'
    Write-Host 'The password backup is encrypted for this Windows account; credentials were not printed.'
}finally{
    $env:JAVA_HOME=$oldJava
    $env:GASKET_LOCAL_SIGN_PASS=$oldPass
    if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
    $secure=$null;$encoded=$null;$plain=$null
    if(Test-Path -LiteralPath $candidate){Remove-Item -LiteralPath $candidate}
}
