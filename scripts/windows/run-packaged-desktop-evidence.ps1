param(
  [Parameter(Mandatory = $true)] [string] $EngineDirectory,
  [Parameter(Mandatory = $true)] [string] $TauriDriver,
  [Parameter(Mandatory = $true)] [string] $VisualCppRuntime,
  [Parameter(Mandatory = $true)] [string] $EdgeDriver,
  [Parameter(Mandatory = $true)] [string] $FixedWebViewDirectory,
  [Parameter(Mandatory = $true)] [string] $OutputDirectory,
  [string] $Application = "src\desktop-shell\src-tauri\target\release\scadmill.exe",
  [string] $Node = "node.exe",
  [int] $TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Resolve-File([string] $Path, [string] $Label) {
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "$Label is not a file: $resolved" }
  return $resolved
}

function Resolve-Directory([string] $Path, [string] $Label) {
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) { throw "$Label is not a directory: $resolved" }
  return $resolved
}

function Escape-Xml([string] $Value) {
  return [Security.SecurityElement]::Escape($Value)
}

if ($TimeoutSeconds -lt 60) { throw "TimeoutSeconds must be at least 60." }
$applicationInput = if ([IO.Path]::IsPathRooted($Application)) { $Application } else { Join-Path $repo $Application }
$applicationPath = Resolve-File $applicationInput "ScadMill application"
$enginePath = Resolve-Directory $EngineDirectory "OpenSCAD directory"
$tauriDriverPath = Resolve-File $TauriDriver "tauri-driver"
$visualCppRuntimePath = Resolve-File $VisualCppRuntime "Visual C++ runtime"
$edgeDriverPath = Resolve-File $EdgeDriver "Microsoft EdgeDriver"
$webViewPath = Resolve-Directory $FixedWebViewDirectory "fixed WebView2 runtime"
$nodeCommand = Get-Command $Node -CommandType Application -ErrorAction Stop
$nodePath = Resolve-File $nodeCommand.Source "Node.js"
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
foreach ($marker in @("evidence.json", "GUEST_PASS", "PASS", "sandbox-exit-code.txt")) {
  if (Test-Path -LiteralPath (Join-Path $outputPath $marker)) {
    throw "OutputDirectory already contains $marker; use a fresh evidence directory."
  }
}

$runId = [Guid]::NewGuid().ToString("N")
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) "scadmill-packaged-evidence"
$stage = Join-Path $stageRoot $runId
$configPath = Join-Path $stage "scadmill-packaged-evidence.wsb"
$session = $null
$guestValidated = $false

try {
  foreach ($directory in @("app", "tools", "scripts", "scripts\lib", "scripts\windows")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $directory) | Out-Null
  }
  Copy-Item -LiteralPath $applicationPath -Destination (Join-Path $stage "app\scadmill.exe")
  Copy-Item -LiteralPath $tauriDriverPath -Destination (Join-Path $stage "tools\tauri-driver.exe")
  Copy-Item -LiteralPath $edgeDriverPath -Destination (Join-Path $stage "tools\msedgedriver.exe")
  Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stage "tools\node.exe")
  Copy-Item -LiteralPath $visualCppRuntimePath -Destination (Join-Path $stage "tools\vcruntime140.dll")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\run-packaged-desktop-evidence.mjs") -Destination (Join-Path $stage "scripts")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\packaged-desktop-evidence.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\windows\credential-probe.ps1") -Destination (Join-Path $stage "scripts")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\windows\run-packaged-desktop-sandbox.ps1") -Destination (Join-Path $stage "scripts")
  $baseCommit = (& git -C $repo rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $baseCommit -notmatch '^[A-Fa-f0-9]{40}$') { throw "Could not resolve the source commit." }
  $branch = (& git -C $repo branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) { throw "Could not resolve the source branch." }
  $applicationSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $applicationPath).Hash
  $sourceMetadata = @{ baseCommit = $baseCommit; branch = $branch; applicationSha256 = $applicationSha256 } | ConvertTo-Json
  [IO.File]::WriteAllText(
    (Join-Path $stage "scripts\source-metadata.json"),
    $sourceMetadata,
    [Text.UTF8Encoding]::new($false)
  )

  $configuration = @"
<Configuration>
  <VGpu>Enable</VGpu>
  <Networking>Disable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$(Escape-Xml $stage)</HostFolder><SandboxFolder>C:\ScadMillEvidence</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(Escape-Xml $enginePath)</HostFolder><SandboxFolder>C:\ScadMillEngine</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(Escape-Xml $webViewPath)</HostFolder><SandboxFolder>C:\ScadMillWebView</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(Escape-Xml $outputPath)</HostFolder><SandboxFolder>C:\ScadMillEvidenceOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ScadMillEvidence\scripts\run-packaged-desktop-sandbox.ps1</Command></LogonCommand>
</Configuration>
"@
  [IO.File]::WriteAllText($configPath, $configuration, [Text.UTF8Encoding]::new($false))
  $harnessManifest = [ordered]@{
    schemaVersion = 1
    files = [ordered]@{
      config = [ordered]@{ path = "scadmill-packaged-evidence.wsb"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $configPath).Hash }
      credentialProbe = [ordered]@{ path = "scripts/credential-probe.ps1"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\credential-probe.ps1")).Hash }
      helper = [ordered]@{ path = "scripts/lib/packaged-desktop-evidence.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\lib\packaged-desktop-evidence.mjs")).Hash }
      runner = [ordered]@{ path = "scripts/run-packaged-desktop-evidence.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\run-packaged-desktop-evidence.mjs")).Hash }
      sandboxBootstrap = [ordered]@{ path = "scripts/run-packaged-desktop-sandbox.ps1"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\run-packaged-desktop-sandbox.ps1")).Hash }
      sourceMetadata = [ordered]@{ path = "scripts/source-metadata.json"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\source-metadata.json")).Hash }
    }
    policy = [ordered]@{
      networking = "Disable"
      clipboardRedirection = "Disable"
      audioInput = "Disable"
      videoInput = "Disable"
      printerRedirection = "Disable"
      inputMappingsReadOnly = $true
      outputMappingReadOnly = $false
    }
  }
  $harnessManifestPath = Join-Path $stage "harness-manifest.json"
  [IO.File]::WriteAllText(
    $harnessManifestPath,
    ($harnessManifest | ConvertTo-Json -Depth 8),
    [Text.UTF8Encoding]::new($false)
  )
  $harnessManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $harnessManifestPath).Hash
  Copy-Item -LiteralPath $harnessManifestPath -Destination (Join-Path $outputPath "harness-manifest.json")
  Copy-Item -LiteralPath $configPath -Destination (Join-Path $outputPath "sandbox-config.wsb")
  Start-Process -FilePath "WindowsSandbox.exe" -ArgumentList @("`"$configPath`"") -WindowStyle Hidden | Out-Null

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $exitFile = Join-Path $outputPath "sandbox-exit-code.txt"
  while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $exitFile -PathType Leaf)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $exitFile -PathType Leaf)) {
    throw "Timed out waiting for packaged desktop evidence after $TimeoutSeconds seconds."
  }
  $exitCode = [int](Get-Content -Raw -LiteralPath $exitFile)
  $evidencePath = Join-Path $outputPath "evidence.json"
  $guestPassPath = Join-Path $outputPath "GUEST_PASS"
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $guestPassPath) -or -not (Test-Path -LiteralPath $evidencePath)) {
    throw "Packaged desktop evidence failed; inspect $outputPath."
  }
  $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
  if ($evidence.status -ne "passed") { throw "Evidence did not report passed status; inspect $evidencePath." }
  $artifactEvent = $evidence.events | Where-Object { $_.name -eq "artifacts-verified" } | Select-Object -First 1
  if ($artifactEvent.harness.manifestSha256 -ne $harnessManifestSha256) {
    throw "Evidence harness manifest does not match the pre-launch manifest."
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputPath "harness-manifest.json")).Hash -ne $harnessManifestSha256) {
    throw "Retained harness manifest changed after launch."
  }
  $guestValidated = $true
} finally {
  $session = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "WindowsSandboxRemoteSession.exe" -and $_.CommandLine -like "*$configPath*"
  }
  foreach ($process in $session) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
  $sessionDeadline = (Get-Date).AddSeconds(15)
  do {
    $session = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -eq "WindowsSandboxRemoteSession.exe" -and $_.CommandLine -like "*$configPath*"
    }
    if ($session) { Start-Sleep -Milliseconds 250 }
  } while ($session -and (Get-Date) -lt $sessionDeadline)
  $sessionSurvived = [bool]$session
  $resolvedStage = [IO.Path]::GetFullPath($stage)
  $resolvedRoot = [IO.Path]::GetFullPath($stageRoot).TrimEnd('\') + '\'
  if ($resolvedStage.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStage)) {
    $cleanupDeadline = (Get-Date).AddSeconds(30)
    do {
      try { Remove-Item -LiteralPath $resolvedStage -Force -Recurse -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500 }
    } while ((Test-Path -LiteralPath $resolvedStage) -and (Get-Date) -lt $cleanupDeadline)
  }
  $stageRemoved = -not (Test-Path -LiteralPath $resolvedStage)
  [object[]] $remainingSessions = @($session | ForEach-Object { [int]$_.ProcessId })
  $cleanup = [ordered]@{
    observedAt = (Get-Date).ToUniversalTime().ToString("o")
    exactSandboxSessionsRemaining = $remainingSessions
    stagingDirectoryRemoved = $stageRemoved
  }
  $cleanupPath = Join-Path $outputPath "host-cleanup.json"
  [IO.File]::WriteAllText(
    $cleanupPath,
    ($cleanup | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
  )
  $retainedCleanup = Get-Content -Raw -LiteralPath $cleanupPath | ConvertFrom-Json
  if (@($retainedCleanup.exactSandboxSessionsRemaining).Count -ne 0 -or $retainedCleanup.stagingDirectoryRemoved -ne $true) {
    throw "Retained host cleanup evidence is not clean: $cleanupPath."
  }
  if ($sessionSurvived) { throw "Exact Windows Sandbox session survived cleanup for $configPath." }
  if (-not $stageRemoved) { throw "Staging directory survived cleanup: $resolvedStage." }
}
if ($guestValidated) {
  [IO.File]::WriteAllText(
    (Join-Path $outputPath "PASS"),
    "packaged desktop evidence and host cleanup passed`n",
    [Text.UTF8Encoding]::new($false)
  )
  Write-Output $evidencePath
}
