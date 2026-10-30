[CmdletBinding()]
param([string]$ToolchainRoot=(Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData/Local/GasketBuild'),[switch]$AcceptSdkLicense)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repoRoot=Split-Path $PSScriptRoot -Parent
$ToolchainRoot=[IO.Path]::GetFullPath($ToolchainRoot)
$downloads=Join-Path $ToolchainRoot 'downloads'
New-Item -ItemType Directory -Path $downloads -Force|Out-Null
function Get-PinnedArchive([string]$Name,[string]$Url,[string]$Hash,[string]$Algorithm='SHA256'){
    $target=Join-Path $downloads $Name
    if(-not(Test-Path -LiteralPath $target)){
        $existing=Join-Path $repoRoot ('tmp/'+$Name)
        if($Name -eq 'gradle-8.13-bin.zip'){$existing=Join-Path $repoRoot 'tmp/local-android/gradle-8.13-bin.zip'}
        if(Test-Path -LiteralPath $existing){Copy-Item -LiteralPath $existing -Destination $target}else{Write-Host "Downloading $Name";Invoke-WebRequest -Uri $Url -OutFile $target}
    }
    if((Get-FileHash -LiteralPath $target -Algorithm $Algorithm).Hash.ToLowerInvariant() -ne $Hash.ToLowerInvariant()){throw "Checksum mismatch: $Name"}
    return $target
}
$jdk=Join-Path $ToolchainRoot 'jdk'
if(-not(Test-Path -LiteralPath (Join-Path $jdk 'bin/java.exe'))){
    $archive=Get-PinnedArchive 'test-jdk.zip' 'https://aka.ms/download-jdk/microsoft-jdk-21.0.13-windows-x64.zip' 'c5706a9cf482ef1a0622a86eea5b13d557b07f04554572af061e2d02b58c0f99'
    $stage=Join-Path $downloads 'jdk-extracted';Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force
    $source=Get-ChildItem -LiteralPath $stage -Directory|Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe')}|Select-Object -First 1
    if(-not $source){throw 'Java archive did not contain a JDK'}
    New-Item -ItemType Directory -Path $jdk -Force|Out-Null
    Get-ChildItem -LiteralPath $source.FullName -Force|Copy-Item -Destination $jdk -Recurse -Force
}
$gradle=Join-Path $ToolchainRoot 'gradle-8.13/bin/gradle.bat'
if(-not(Test-Path -LiteralPath $gradle)){
    $archive=Get-PinnedArchive 'gradle-8.13-bin.zip' 'https://downloads.gradle.org/distributions/gradle-8.13-bin.zip' '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78'
    Expand-Archive -LiteralPath $archive -DestinationPath $ToolchainRoot -Force
}
$sdk=Join-Path $ToolchainRoot 'sdk'
$acceptance=Join-Path $ToolchainRoot 'sdk-license-acceptance.json'
if(-not(Test-Path -LiteralPath $acceptance)){
    if(-not $AcceptSdkLicense){throw 'Run again with -AcceptSdkLicense after reviewing https://developer.android.com/studio/terms'}
    $xml=[xml](Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/repository2-1.xml').Content
    $license=$xml.SelectNodes('//*[local-name()="license"]')|Where-Object {$_.id -eq 'android-sdk-license'}|Select-Object -First 1
    if(-not $license){throw 'Official SDK license not found'}
    $licenseDir=Join-Path $sdk 'licenses';New-Item -ItemType Directory -Path $licenseDir -Force|Out-Null
    $sha=[Security.Cryptography.SHA1]::Create()
    try{$hashes=@($license.InnerText,$license.InnerText.Trim(),($license.InnerText -replace "`r`n","`n").Trim())|ForEach-Object {([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($_)))).Replace('-','').ToLowerInvariant()}|Select-Object -Unique}finally{$sha.Dispose()}
    $hashes|Set-Content -LiteralPath (Join-Path $licenseDir 'android-sdk-license') -Encoding ascii
    $license.InnerText|Set-Content -LiteralPath (Join-Path $ToolchainRoot 'android-sdk-license.txt') -Encoding utf8
    @{url='https://developer.android.com/studio/terms';acceptedAt=[DateTime]::UtcNow.ToString('o');hashes=@($hashes)}|ConvertTo-Json|Set-Content -LiteralPath $acceptance -Encoding utf8
}
$packages=@(
 @{Name='platform-35_r02.zip';Hash='0bb560a90a7a2cbd0dd8348224d518b638fe7949';Destination='platforms/android-35';Marker='android.jar'},
 @{Name='build-tools_r35_windows.zip';Hash='af059bb67cf7786f45ee0db85e2d24985df1b4b6';Destination='build-tools/35.0.0';Marker='apksigner.bat'},
 @{Name='platform-tools_r37.0.1-win.zip';Hash='e03e78b1d80b396f1c3358e31251cb31740e1110';Destination='platform-tools';Marker='adb.exe'}
)
foreach($package in $packages){
    $destination=Join-Path $sdk $package.Destination
    if(Test-Path -LiteralPath (Join-Path $destination $package.Marker)){continue}
    $archive=Get-PinnedArchive $package.Name ('https://dl.google.com/android/repository/'+$package.Name) $package.Hash 'SHA1'
    $stage=Join-Path $downloads ($package.Name+'.extracted');Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force
    $source=Get-ChildItem -LiteralPath $stage -File -Filter $package.Marker -Recurse|Select-Object -First 1
    if(-not $source){throw "SDK archive marker missing: $($package.Name)"}
    New-Item -ItemType Directory -Path $destination -Force|Out-Null
    Get-ChildItem -LiteralPath $source.Directory.FullName -Force|Copy-Item -Destination $destination -Recurse -Force
}
@{schema=1;javaHome=$jdk;androidHome=$sdk;gradle=$gradle;gradleUserHome=(Join-Path $ToolchainRoot 'gradle-cache')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $ToolchainRoot 'toolchain.json') -Encoding utf8
Write-Host "Local Android toolchain ready: $ToolchainRoot"
