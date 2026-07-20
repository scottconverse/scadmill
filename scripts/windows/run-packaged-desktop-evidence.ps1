param(
  [Parameter(Mandatory = $true)] [string] $EngineDirectory,
  [Parameter(Mandatory = $true)] [string] $TauriDriver,
  [Parameter(Mandatory = $true)] [string] $VisualCppRuntime,
  [Parameter(Mandatory = $true)] [string] $VisualCppRuntimeCompanion,
  [Parameter(Mandatory = $true)] [string] $EdgeDriver,
  [Parameter(Mandatory = $true)] [string] $FixedWebViewDirectory,
  [Parameter(Mandatory = $true)] [string] $OutputDirectory,
  [string] $Node = "node.exe",
  [int] $TimeoutSeconds = 600,
  [ValidateSet("disabled", "literal", "accelerated")]
  [string] $N2SoakMode = "disabled",
  [int] $N2AcceleratedDurationSeconds = 120,
  [int] $N2AcceleratedCadenceMilliseconds = 1000
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if (-not ("ScadMill.NativeCommandLine" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace ScadMill {
  public static class NativeCommandLine {
    [DllImport("shell32.dll", SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(
      [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
      out int argumentCount
    );

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static string[] Split(string commandLine) {
      int argumentCount;
      IntPtr arguments = CommandLineToArgvW(commandLine, out argumentCount);
      if (arguments == IntPtr.Zero) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      try {
        var result = new string[argumentCount];
        for (int index = 0; index < argumentCount; index++) {
          IntPtr argument = Marshal.ReadIntPtr(arguments, index * IntPtr.Size);
          string value = Marshal.PtrToStringUni(argument);
          if (value == null) {
            throw new InvalidOperationException("Command-line argument was null.");
          }
          result[index] = value;
        }
        return result;
      } finally {
        LocalFree(arguments);
      }
    }
  }
}
"@
}

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

function Assert-CleanWorktree([string] $Phase) {
  [string[]] $status = @(git -C $repo status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the source worktree $Phase." }
  if ($status.Count -ne 0) {
    throw "Source worktree must be clean $Phase. Refusing evidence build:`n$($status -join "`n")"
  }
}

function Get-GitValue([string[]] $Arguments, [string] $Label) {
  $value = (& git -C $repo @Arguments).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
    throw "Could not resolve $Label."
  }
  return $value
}

function Get-ToolVersion([string] $Executable, [string] $Label) {
  $priorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    [string[]] $output = @(& $Executable "--version" 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  $version = ($output -join "`n").Trim()
  if ($exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
    throw "Could not resolve $Label version."
  }
  return $version
}

function Format-IsoInstant([DateTime] $Value) {
  return $Value.ToUniversalTime().ToString(
    "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)] [string] $Executable,
    [Parameter(Mandatory = $true)] [string[]] $Arguments,
    [Parameter(Mandatory = $true)] [string] $WorkingDirectory,
    [Parameter(Mandatory = $true)] [string] $LogPath
  )
  $display = "$([IO.Path]::GetFileName($Executable)) $($Arguments -join ' ')"
  [IO.File]::WriteAllText($LogPath, "> $display`n", [Text.UTF8Encoding]::new($false))
  Push-Location -LiteralPath $WorkingDirectory
  $priorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $Executable @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
    Pop-Location
  }
  if ($exitCode -ne 0) { throw "Command failed with exit code ${exitCode}: $display. See $LogPath." }
}

function Get-ExactSandboxSessions([string] $ConfigPath) {
  [object[]] $candidates = @(
    Get-CimInstance Win32_Process -ErrorAction Stop -Filter "Name = 'WindowsSandboxRemoteSession.exe'"
  )
  [object[]] $ambiguous = @(
    $candidates | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.CommandLine) }
  )
  if ($ambiguous.Count -ne 0) {
    throw "Cannot prove Windows Sandbox session identity because a CommandLine is missing."
  }
  return @($candidates | Where-Object {
    [string[]] $arguments = [ScadMill.NativeCommandLine]::Split([string]$_.CommandLine)
    @($arguments | Where-Object {
      [string]::Equals($_, $ConfigPath, [StringComparison]::OrdinalIgnoreCase)
    }).Count -eq 1
  })
}

function Test-SandboxSessionIdentityProperties([object] $Process) {
  return (
    [int]$Process.ProcessId -le 0 -or
    [string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath) -or
    $null -eq $Process.CreationDate
  ) -eq $false
}

function ConvertTo-SandboxSessionIdentity([object] $Process) {
  if (-not (Test-SandboxSessionIdentityProperties -Process $Process)) {
    throw "Cannot capture Windows Sandbox session identity because a stable property is missing."
  }
  return [pscustomobject]@{
    ProcessId = [int]$Process.ProcessId
    ExecutablePath = [string]$Process.ExecutablePath
    CreationTicks = ([DateTime]$Process.CreationDate).ToUniversalTime().Ticks
  }
}

function Wait-ExactSandboxSession([string] $ConfigPath, [int] $TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    [object[]] $matches = @(Get-ExactSandboxSessions -ConfigPath $ConfigPath)
    if ($matches.Count -gt 1) {
      throw "More than one Windows Sandbox session used the exact retained config path."
    }
    if ($matches.Count -eq 1 -and (Test-SandboxSessionIdentityProperties -Process $matches[0])) {
      return ConvertTo-SandboxSessionIdentity -Process $matches[0]
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  throw "Timed out capturing the exact Windows Sandbox session with stable identity properties."
}

function Get-CapturedSandboxSession([object] $Identity) {
  [object[]] $matches = @(
    Get-CimInstance Win32_Process -ErrorAction Stop -Filter "ProcessId = $([int]$Identity.ProcessId)"
  )
  if ($matches.Count -eq 0) { return @() }
  if ($matches.Count -ne 1) { throw "Captured Windows Sandbox process id is ambiguous." }
  $candidate = $matches[0]
  if (
    $candidate.Name -ne "WindowsSandboxRemoteSession.exe" -or
    [string]::IsNullOrWhiteSpace([string]$candidate.ExecutablePath) -or
    $null -eq $candidate.CreationDate -or
    -not [string]::Equals(
      [string]$candidate.ExecutablePath,
      [string]$Identity.ExecutablePath,
      [StringComparison]::OrdinalIgnoreCase
    ) -or
    ([DateTime]$candidate.CreationDate).ToUniversalTime().Ticks -ne [long]$Identity.CreationTicks
  ) {
    return @()
  }
  return @($candidate)
}

if ($TimeoutSeconds -lt 60) { throw "TimeoutSeconds must be at least 60." }
$n2SoakConfiguration = switch ($N2SoakMode) {
  "disabled" {
    [ordered]@{
      schemaVersion = 1
      mode = "disabled"
      releaseEvidenceEligible = $false
      evidenceLabel = "DISABLED"
    }
  }
  "literal" {
    if ($TimeoutSeconds -lt 4800) {
      throw "Literal N-2 evidence requires TimeoutSeconds of at least 4800."
    }
    [ordered]@{
      schemaVersion = 1
      mode = "literal"
      releaseEvidenceEligible = $true
      evidenceLabel = "N-2-LITERAL-1-HOUR"
      durationSeconds = 3600
      cadenceMilliseconds = 30000
      warmupSeconds = 300
      baselineStartSeconds = 300
      baselineEndSeconds = 900
      crashAtSeconds = 1800
      minimumSuccessfulCycles = 113
      memorySampleIntervalSeconds = 60
      rollingWindowSamples = 5
      finalWindowSamples = 10
      thresholdRatio = 1.5
    }
  }
  "accelerated" {
    if (
      $N2AcceleratedDurationSeconds -lt 8 -or
      $N2AcceleratedDurationSeconds -gt 3600 -or
      $N2AcceleratedCadenceMilliseconds -lt 10 -or
      $N2AcceleratedCadenceMilliseconds -gt [Math]::Floor($N2AcceleratedDurationSeconds * 1000 / 8) -or
      $N2AcceleratedCadenceMilliseconds -lt [Math]::Ceiling($N2AcceleratedDurationSeconds * 1000 / 900)
    ) {
      throw "Accelerated N-2 controls require 8-3600 seconds and a cadence that permits at least eight cycles."
    }
    if ($TimeoutSeconds -lt $N2AcceleratedDurationSeconds + 600) {
      throw "Accelerated N-2 evidence requires TimeoutSeconds at least 600 seconds beyond its short duration."
    }
    $warmup = [Math]::Max(1, [Math]::Floor($N2AcceleratedDurationSeconds / 8))
    $baselineEnd = [Math]::Max($warmup + 1, [Math]::Floor($N2AcceleratedDurationSeconds / 3))
    $crashAt = [Math]::Max($baselineEnd + 1, [Math]::Floor($N2AcceleratedDurationSeconds / 2))
    [ordered]@{
      schemaVersion = 1
      mode = "accelerated"
      releaseEvidenceEligible = $false
      evidenceLabel = "ACCELERATED-NON-RELEASE"
      durationSeconds = $N2AcceleratedDurationSeconds
      cadenceMilliseconds = $N2AcceleratedCadenceMilliseconds
      warmupSeconds = $warmup
      baselineStartSeconds = $warmup
      baselineEndSeconds = $baselineEnd
      crashAtSeconds = $crashAt
      minimumSuccessfulCycles = 8
      memorySampleIntervalSeconds = $warmup
      rollingWindowSamples = 2
      finalWindowSamples = 2
      thresholdRatio = 1.5
    }
  }
}
$canonicalApplication = "src/desktop-shell/src-tauri/target/release/scadmill.exe"
$desktopManifest = "src/desktop-shell/src-tauri/Cargo.toml"
$desktopTarget = "src/desktop-shell/src-tauri/target"
$desktopShellDirectory = Join-Path $repo "src\desktop-shell"
$applicationPath = Join-Path $repo ($canonicalApplication.Replace('/', '\'))
$enginePath = Resolve-Directory $EngineDirectory "OpenSCAD directory"
$tauriDriverPath = Resolve-File $TauriDriver "tauri-driver"
$visualCppRuntimePath = Resolve-File $VisualCppRuntime "Visual C++ runtime"
$visualCppRuntimeCompanionPath = Resolve-File $VisualCppRuntimeCompanion "Visual C++ runtime companion"
$edgeDriverPath = Resolve-File $EdgeDriver "Microsoft EdgeDriver"
$webViewPath = Resolve-Directory $FixedWebViewDirectory "fixed WebView2 runtime"
$nodeCommand = Get-Command $Node -CommandType Application -ErrorAction Stop
$nodePath = Resolve-File $nodeCommand.Source "Node.js"
$pnpmCommand = Get-Command "pnpm.cmd" -CommandType Application -All -ErrorAction Stop |
  Select-Object -First 1
$pnpmPath = Resolve-File $pnpmCommand.Source "pnpm"
$cargoCommand = Get-Command "cargo.exe" -CommandType Application -ErrorAction Stop
$cargoPath = Resolve-File $cargoCommand.Source "Cargo"
$rustcCommand = Get-Command "rustc.exe" -CommandType Application -ErrorAction Stop
$rustcPath = Resolve-File $rustcCommand.Source "rustc"
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$repoPrefix = $repo.TrimEnd('\') + '\'
if ($outputPath -eq $repo -or $outputPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDirectory must be outside the source worktree."
}

Assert-CleanWorktree "before build"
$sourceCommit = Get-GitValue @("rev-parse", "HEAD") "source commit"
$sourceTree = Get-GitValue @("write-tree") "source tree"
$headTree = Get-GitValue @("rev-parse", "HEAD^{tree}") "HEAD source tree"
if ($sourceCommit -notmatch '^[A-Fa-f0-9]{40}$' -or $sourceTree -notmatch '^[A-Fa-f0-9]{40}$') {
  throw "Source commit or tree is not a full Git object ID."
}
if ($sourceTree -ne $headTree) { throw "Clean source tree does not match HEAD." }
$branch = Get-GitValue @("branch", "--show-current") "source branch"

if (Test-Path -LiteralPath $outputPath) {
  if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
    throw "OutputDirectory is not a directory: $outputPath"
  }
  [object[]] $existingOutput = @(Get-ChildItem -LiteralPath $outputPath -Force -ErrorAction Stop)
  if ($existingOutput.Count -ne 0) { throw "OutputDirectory must be empty: $outputPath" }
} else {
  New-Item -ItemType Directory -Path $outputPath | Out-Null
}

$dependencyInstallLog = Join-Path $outputPath "dependency-install.log"
$desktopCleanLog = Join-Path $outputPath "desktop-release-clean.log"
$desktopBuildLog = Join-Path $outputPath "desktop-release-build.log"
$nodeVersion = Get-ToolVersion $nodePath "Node.js"
$pnpmVersion = Get-ToolVersion $pnpmPath "pnpm"
$cargoVersion = Get-ToolVersion $cargoPath "Cargo"
$rustcVersion = Get-ToolVersion $rustcPath "rustc"
$buildStartedAt = Format-IsoInstant (Get-Date)
Invoke-LoggedCommand -Executable $pnpmPath -Arguments @("install", "--frozen-lockfile") -WorkingDirectory $repo -LogPath $dependencyInstallLog
Invoke-LoggedCommand -Executable $cargoPath -Arguments @("clean", "--manifest-path", $desktopManifest, "--target-dir", $desktopTarget) -WorkingDirectory $repo -LogPath $desktopCleanLog
if (Test-Path -LiteralPath $applicationPath) {
  throw "Canonical release executable survived cargo clean; refusing a potentially stale build."
}
Invoke-LoggedCommand -Executable $pnpmPath -Arguments @("exec", "tauri", "build", "--no-bundle", "--ci", "--", "--locked") -WorkingDirectory $desktopShellDirectory -LogPath $desktopBuildLog
$buildCompletedAt = Format-IsoInstant (Get-Date)
Assert-CleanWorktree "after build"
$builtCommit = Get-GitValue @("rev-parse", "HEAD") "post-build source commit"
$builtTree = Get-GitValue @("write-tree") "post-build source tree"
$builtBranch = Get-GitValue @("branch", "--show-current") "post-build source branch"
if ($builtCommit -ne $sourceCommit -or $builtTree -ne $sourceTree -or $builtBranch -ne $branch) {
  throw "Source identity changed during the evidence build."
}
$applicationPath = Resolve-File $applicationPath "just-built canonical ScadMill application"
$applicationSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $applicationPath).Hash

$runId = [Guid]::NewGuid().ToString("N")
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) "scadmill-packaged-evidence"
$stage = Join-Path $stageRoot $runId
$configPath = Join-Path $stage "scadmill-packaged-evidence.wsb"
$session = $null
$sessionIdentity = $null
$sandboxLaunched = $false
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
  Copy-Item -LiteralPath $visualCppRuntimeCompanionPath -Destination (Join-Path $stage "tools\vcruntime140_1.dll")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\run-packaged-desktop-evidence.mjs") -Destination (Join-Path $stage "scripts")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\packaged-desktop-evidence.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\m4-packaged-walkthrough.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\m4-packaged-verifier.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\n2-soak-evidence.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\n2-soak-runner.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\lib\n2-soak-verifier.mjs") -Destination (Join-Path $stage "scripts\lib")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\windows\credential-probe.ps1") -Destination (Join-Path $stage "scripts")
  Copy-Item -LiteralPath (Join-Path $repo "scripts\windows\run-packaged-desktop-sandbox.ps1") -Destination (Join-Path $stage "scripts")
  $sourceMetadata = [ordered]@{
    schemaVersion = 1
    sourceCommit = $sourceCommit
    sourceTree = $sourceTree
    branch = $branch
    canonicalApplication = $canonicalApplication
    applicationSha256 = $applicationSha256
    worktree = [ordered]@{
      cleanBeforeBuild = $true
      cleanAfterBuild = $true
    }
    lockfiles = [ordered]@{
      pnpm = [ordered]@{
        path = "pnpm-lock.yaml"
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo "pnpm-lock.yaml")).Hash
      }
      nativeCargo = [ordered]@{
        path = "src/native-engine/Cargo.lock"
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo "src\native-engine\Cargo.lock")).Hash
      }
      desktopCargo = [ordered]@{
        path = "src/desktop-shell/src-tauri/Cargo.lock"
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo "src\desktop-shell\src-tauri\Cargo.lock")).Hash
      }
    }
    build = [ordered]@{
      startedAt = $buildStartedAt
      completedAt = $buildCompletedAt
      commands = @(
        "pnpm.cmd install --frozen-lockfile",
        "cargo.exe clean --manifest-path src/desktop-shell/src-tauri/Cargo.toml --target-dir src/desktop-shell/src-tauri/target",
        "pnpm.cmd exec tauri build --no-bundle --ci -- --locked"
      )
      toolVersions = [ordered]@{
        node = $nodeVersion
        pnpm = $pnpmVersion
        cargo = $cargoVersion
        rustc = $rustcVersion
      }
    }
  } | ConvertTo-Json -Depth 8
  $sourceMetadataPath = Join-Path $stage "scripts\source-metadata.json"
  [IO.File]::WriteAllText(
    $sourceMetadataPath,
    $sourceMetadata,
    [Text.UTF8Encoding]::new($false)
  )
  $sourceMetadataSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceMetadataPath).Hash
  Copy-Item -LiteralPath $sourceMetadataPath -Destination (Join-Path $outputPath "source-metadata.json")
  $n2SoakConfigurationPath = Join-Path $stage "scripts\n2-soak-config.json"
  [IO.File]::WriteAllText(
    $n2SoakConfigurationPath,
    ($n2SoakConfiguration | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
  )
  Copy-Item -LiteralPath $n2SoakConfigurationPath -Destination (Join-Path $outputPath "n2-soak-config.json")

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
      m4PackagedWalkthrough = [ordered]@{ path = "scripts/lib/m4-packaged-walkthrough.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\lib\m4-packaged-walkthrough.mjs")).Hash }
      m4PackagedVerifier = [ordered]@{ path = "scripts/lib/m4-packaged-verifier.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\lib\m4-packaged-verifier.mjs")).Hash }
      n2SoakConfiguration = [ordered]@{ path = "scripts/n2-soak-config.json"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $n2SoakConfigurationPath).Hash }
      n2SoakEvidence = [ordered]@{ path = "scripts/lib/n2-soak-evidence.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\lib\n2-soak-evidence.mjs")).Hash }
      n2SoakRunner = [ordered]@{ path = "scripts/lib/n2-soak-runner.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\lib\n2-soak-runner.mjs")).Hash }
      n2SoakVerifier = [ordered]@{ path = "scripts/lib/n2-soak-verifier.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\lib\n2-soak-verifier.mjs")).Hash }
      runner = [ordered]@{ path = "scripts/run-packaged-desktop-evidence.mjs"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\run-packaged-desktop-evidence.mjs")).Hash }
      sandboxBootstrap = [ordered]@{ path = "scripts/run-packaged-desktop-sandbox.ps1"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stage "scripts\run-packaged-desktop-sandbox.ps1")).Hash }
      sourceMetadata = [ordered]@{ path = "scripts/source-metadata.json"; sha256 = $sourceMetadataSha256 }
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
  $retainedN2VerifierDirectory = Join-Path $outputPath "retained-harness\scripts\lib"
  New-Item -ItemType Directory -Force -Path $retainedN2VerifierDirectory | Out-Null
  Copy-Item -LiteralPath (Join-Path $stage "scripts\lib\n2-soak-evidence.mjs") -Destination $retainedN2VerifierDirectory
  Copy-Item -LiteralPath (Join-Path $stage "scripts\lib\n2-soak-verifier.mjs") -Destination $retainedN2VerifierDirectory
  Copy-Item -LiteralPath (Join-Path $stage "scripts\lib\m4-packaged-walkthrough.mjs") -Destination $retainedN2VerifierDirectory
  Copy-Item -LiteralPath (Join-Path $stage "scripts\lib\m4-packaged-verifier.mjs") -Destination $retainedN2VerifierDirectory
  Copy-Item -LiteralPath $configPath -Destination (Join-Path $outputPath "sandbox-config.wsb")
  Assert-CleanWorktree "before Sandbox launch"
  $launchCommit = Get-GitValue @("rev-parse", "HEAD") "launch source commit"
  $launchTree = Get-GitValue @("write-tree") "launch source tree"
  $launchBranch = Get-GitValue @("branch", "--show-current") "launch source branch"
  if ($launchCommit -ne $sourceCommit -or $launchTree -ne $sourceTree -or $launchBranch -ne $branch) {
    throw "Source identity changed before Sandbox launch."
  }
  Start-Process -FilePath "WindowsSandbox.exe" -ArgumentList @("`"$configPath`"") -WindowStyle Hidden | Out-Null
  $sandboxLaunched = $true
  $sessionIdentity = Wait-ExactSandboxSession -ConfigPath $configPath

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
  if (
    $artifactEvent.source.sourceCommit -ne $sourceCommit -or
    $artifactEvent.source.sourceTree -ne $sourceTree -or
    $artifactEvent.source.applicationSha256 -ne $applicationSha256
  ) {
    throw "Evidence source metadata does not match the just-built canonical application."
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputPath "harness-manifest.json")).Hash -ne $harnessManifestSha256) {
    throw "Retained harness manifest changed after launch."
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputPath "source-metadata.json")).Hash -ne $sourceMetadataSha256) {
    throw "Retained source metadata changed after launch."
  }
  $guestValidated = $true
} finally {
  if ($sandboxLaunched -and $null -eq $sessionIdentity) {
    $sessionIdentity = Wait-ExactSandboxSession -ConfigPath $configPath
  }
  $session = if ($null -eq $sessionIdentity) {
    @()
  } else {
    Get-CapturedSandboxSession -Identity $sessionIdentity
  }
  foreach ($process in $session) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
  $sessionDeadline = (Get-Date).AddSeconds(15)
  do {
    $session = if ($null -eq $sessionIdentity) {
      @()
    } else {
      Get-CapturedSandboxSession -Identity $sessionIdentity
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
  $retainedM4Walkthrough = Join-Path $outputPath "retained-harness\scripts\lib\m4-packaged-walkthrough.mjs"
  $retainedM4Verifier = Join-Path $outputPath "retained-harness\scripts\lib\m4-packaged-verifier.mjs"
  $retainedN2Evidence = Join-Path $outputPath "retained-harness\scripts\lib\n2-soak-evidence.mjs"
  $retainedN2Verifier = Join-Path $outputPath "retained-harness\scripts\lib\n2-soak-verifier.mjs"
  if (
    (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputPath "harness-manifest.json")).Hash -ne $harnessManifestSha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $retainedM4Walkthrough).Hash -ne $harnessManifest.files.m4PackagedWalkthrough.sha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $retainedM4Verifier).Hash -ne $harnessManifest.files.m4PackagedVerifier.sha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $retainedN2Evidence).Hash -ne $harnessManifest.files.n2SoakEvidence.sha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $retainedN2Verifier).Hash -ne $harnessManifest.files.n2SoakVerifier.sha256
  ) {
    throw "Retained M4/N-2 host verifier differs from the manifest-bound harness."
  }
  [string[]] $hostM4Arguments = @(
    "--walkthrough", (Join-Path $outputPath "m4-packaged-walkthrough.json"),
    "--screenshots", $outputPath,
    "--evidence", $evidencePath,
    "--manifest", (Join-Path $outputPath "harness-manifest.json")
  )
  [string[]] $hostM4Output = @(& $nodePath $retainedM4Verifier @hostM4Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Host M4 verification failed: $($hostM4Output -join "`n")" }
  $hostM4Verification = ($hostM4Output -join "`n") | ConvertFrom-Json
  if ($hostM4Verification.status -ne "passed") { throw "Host M4 verification did not pass." }
  [IO.File]::WriteAllText(
    (Join-Path $outputPath "host-m4-verification.json"),
    ($hostM4Verification | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
  )
  [string[]] $hostN2Arguments = @(
    "--configuration", (Join-Path $outputPath "n2-soak-config.json"),
    "--summary", (Join-Path $outputPath "n2-soak-summary.json"),
    "--samples", (Join-Path $outputPath "n2-soak-samples.jsonl"),
    "--evidence", $evidencePath,
    "--manifest", (Join-Path $outputPath "harness-manifest.json")
  )
  [string[]] $hostN2Output = @(& $nodePath $retainedN2Verifier @hostN2Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Host N-2 verification failed: $($hostN2Output -join "`n")" }
  $hostN2Verification = ($hostN2Output -join "`n") | ConvertFrom-Json
  if ($hostN2Verification.status -ne "passed") { throw "Host N-2 verification did not pass." }
  [IO.File]::WriteAllText(
    (Join-Path $outputPath "host-n2-verification.json"),
    ($hostN2Verification | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
  )
  [IO.File]::WriteAllText(
    (Join-Path $outputPath "PASS"),
    "packaged desktop evidence and host cleanup passed`n",
    [Text.UTF8Encoding]::new($false)
  )
  Write-Output $evidencePath
}
