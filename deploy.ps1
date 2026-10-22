<#
.SYNOPSIS
  Build and deploy the KanbanBoard PCF control to Dataverse.

.DESCRIPTION
  1. Bumps the control version in ControlManifest.Input.xml (last segment +1)
  2. npm run build
  3. Bumps the solution version in Solution.xml (last segment +1)
  4. dotnet build -c Release, producing both packages:
       bin\Release\KanbanBoard.zip          (unmanaged)
       bin\Release\KanbanBoard_managed.zip  (managed)
  5. Verifies the selected zip (package type and version inside solution.xml)
  6. pac solution import + publish all customizations

  If a build fails, the versions in both files are rolled back.

.EXAMPLE
  .\deploy.ps1                     # full cycle, imports the unmanaged package
  .\deploy.ps1 -Package managed    # imports the managed package
  .\deploy.ps1 -SkipImport         # only bump versions and build the zips
  .\deploy.ps1 -WhatIf             # show what would happen without changing anything
  .\deploy.ps1 -AuthProfile svc    # switch to the 'svc' pac auth profile before importing
  .\deploy.ps1 -Environment https://org.crm4.dynamics.com   # set the active environment of the profile
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('unmanaged', 'managed')]
    [string]$Package = 'unmanaged',
    [switch]$SkipImport,
    [string]$AuthProfile,
    [string]$Environment
)

$ErrorActionPreference = 'Stop'
$root         = $PSScriptRoot
$manifestPath = Join-Path $root 'KanbanBoard_Source\ControlManifest.Input.xml'
$solutionPath = Join-Path $root 'KanbanBoard\src\Other\Solution.xml'
$solutionDir  = Join-Path $root 'KanbanBoard'
$releaseDir   = Join-Path $solutionDir 'bin\Release'
$zipName      = if ($Package -eq 'managed') { 'KanbanBoard_managed.zip' } else { 'KanbanBoard.zip' }
$zipPath      = Join-Path $releaseDir $zipName
$utf8NoBom    = New-Object System.Text.UTF8Encoding($false)
$startTime    = Get-Date

function Read-Text($path)        { [IO.File]::ReadAllText($path) }
function Write-Text($path, $txt) { [IO.File]::WriteAllText($path, $txt, $utf8NoBom) }

function Invoke-Step($name, [scriptblock]$cmd) {
    Write-Host "`n==> $name" -ForegroundColor Cyan
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "Step '$name' failed with exit code $LASTEXITCODE" }
}

# Reads solution.xml from the built zip and returns its <Managed> and <Version> values
function Get-ZipSolutionInfo($path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $entry = $zip.Entries | Where-Object FullName -eq 'solution.xml'
        if (-not $entry) { throw "solution.xml not found in $path" }
        $reader = New-Object IO.StreamReader($entry.Open())
        try { $xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $zip.Dispose() }
    [pscustomobject]@{
        Managed = [regex]::Match($xml, '<Managed>(\d)</Managed>').Groups[1].Value
        Version = [regex]::Match($xml, '<Version>([^<]+)</Version>').Groups[1].Value
    }
}

# --- Required tools must be available before any file is touched
$tools = @('npm', 'dotnet')
if (-not $SkipImport) { $tools += 'pac' }
$missing = $tools | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
if ($missing) {
    Write-Host "Not found in PATH: $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

# --- The pac connection must work before versions are bumped
if (-not $SkipImport) {
    if ($AuthProfile) {
        pac auth select --name $AuthProfile
        if ($LASTEXITCODE -ne 0) { Write-Host "pac auth profile '$AuthProfile' not found (see: pac auth list)" -ForegroundColor Red; exit 1 }
    }
    if ($Environment) {
        pac org select --environment $Environment
        if ($LASTEXITCODE -ne 0) { Write-Host "Cannot select environment '$Environment'" -ForegroundColor Red; exit 1 }
    }
    Write-Host "`nTarget environment:" -ForegroundColor Cyan
    pac org who
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'No active environment for the current pac auth profile. Use -Environment <url> or create a profile with --environment.' -ForegroundColor Red
        exit 1
    }
}

# Original content, used for rollback on failure
$manifestOriginal = Read-Text $manifestPath
$solutionOriginal = Read-Text $solutionPath

try {
    # --- 1. Control version: <control ... version="0.7.14"> -> 0.7.15
    $ctrlRegex = '(<control\b[^>]*?\bversion=")(\d+)\.(\d+)\.(\d+)(")'
    $m = [regex]::Match($manifestOriginal, $ctrlRegex)
    if (-not $m.Success) { throw "version attribute on <control> not found in $manifestPath" }
    $oldCtrl = "$($m.Groups[2]).$($m.Groups[3]).$($m.Groups[4])"
    $newCtrl = "$($m.Groups[2]).$($m.Groups[3]).$([int]$m.Groups[4].Value + 1)"
    $newManifest = [regex]::Replace($manifestOriginal, $ctrlRegex,
        { param($x) "$($x.Groups[1])$newCtrl$($x.Groups[5])" }, 'None', [TimeSpan]::FromSeconds(1))
    Write-Host "Control version:  $oldCtrl -> $newCtrl" -ForegroundColor Yellow

    # --- 3. Solution version: <Version>1.0.0.8</Version> -> 1.0.0.9
    $solRegex = '(<Version>)(\d+)\.(\d+)\.(\d+)\.(\d+)(</Version>)'
    $s = [regex]::Match($solutionOriginal, $solRegex)
    if (-not $s.Success) { throw "<Version> not found in $solutionPath" }
    $oldSol = "$($s.Groups[2]).$($s.Groups[3]).$($s.Groups[4]).$($s.Groups[5])"
    $newSol = "$($s.Groups[2]).$($s.Groups[3]).$($s.Groups[4]).$([int]$s.Groups[5].Value + 1)"
    $newSolution = [regex]::Replace($solutionOriginal, $solRegex,
        { param($x) "$($x.Groups[1])$newSol$($x.Groups[6])" }, 'None', [TimeSpan]::FromSeconds(1))
    Write-Host "Solution version: $oldSol -> $newSol" -ForegroundColor Yellow

    if (-not $PSCmdlet.ShouldProcess("KanbanBoard", "Bump versions, build and deploy")) { return }

    Write-Text $manifestPath $newManifest
    Invoke-Step 'npm run build' { Push-Location $root; try { npm run build } finally { Pop-Location } }

    Write-Text $solutionPath $newSolution
    # SolutionPackageType is not set in the .cdsproj, so set it explicitly: Both = unmanaged + managed zips
    Invoke-Step 'dotnet build -c Release' {
        Push-Location $solutionDir
        try { dotnet build -c Release /p:SolutionPackageType=Both } finally { Pop-Location }
    }
}
catch {
    Write-Host "`nError: $_" -ForegroundColor Red
    Write-Host 'Rolling back versions in files...' -ForegroundColor Red
    Write-Text $manifestPath $manifestOriginal
    Write-Text $solutionPath $solutionOriginal
    exit 1
}

# --- Verify the built zip
if (-not (Test-Path $zipPath)) { Write-Host "Package not found: $zipPath" -ForegroundColor Red; exit 1 }
if ((Get-Item $zipPath).LastWriteTime -lt $startTime) {
    Write-Host "Stale zip (not rebuilt by this run): $zipPath" -ForegroundColor Red; exit 1
}
$info = Get-ZipSolutionInfo $zipPath
$expectedManaged = if ($Package -eq 'managed') { '1' } else { '0' }
if ($info.Managed -ne $expectedManaged -or $info.Version -ne $newSol) {
    Write-Host "Unexpected package content: Managed=$($info.Managed), Version=$($info.Version) (expected Managed=$expectedManaged, Version=$newSol)" -ForegroundColor Red
    exit 1
}
Write-Host "`nPackage: $zipPath ($Package, $newSol)" -ForegroundColor Green

if ($SkipImport) {
    Write-Host 'Import skipped (-SkipImport).' -ForegroundColor Green
    exit 0
}

# --- 6. Import and publish
Write-Host "`nTarget environment (make sure it is the right one!):" -ForegroundColor Cyan
pac org who
if ($LASTEXITCODE -ne 0) { Write-Host "Lost pac connection. Package built at $zipPath." -ForegroundColor Red; exit 1 }
$answer = Read-Host "Import $zipName into this environment? (y/n)"
if ($answer -ne 'y') { Write-Host 'Cancelled. Versions bumped, zip built.'; exit 0 }

try {
    Invoke-Step 'pac solution import' { pac solution import --path $zipPath --publish-changes }
}
catch {
    Write-Host "`nError: $_" -ForegroundColor Red
    Write-Host "Versions bumped to $newCtrl / $newSol, package built at $zipPath. You can import it manually." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nDone: control $newCtrl, solution $newSol" -ForegroundColor Green
