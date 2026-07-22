param(
  [Parameter(Mandatory = $true)]
  [string]$PreviousInstaller,

  [Parameter(Mandatory = $true)]
  [string]$PreviousInstallerSha256,

  [Parameter(Mandatory = $true)]
  [string]$CandidateInstaller,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedCandidateApplication
)

$ErrorActionPreference = "Stop"

function New-LoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Invoke-DevToolsExpression([string]$WebSocketUrl, [string]$Expression) {
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  $timeout = [Threading.CancellationTokenSource]::new()
  $timeout.CancelAfter(10000)
  try {
    [void]$socket.ConnectAsync([Uri]$WebSocketUrl, $timeout.Token).GetAwaiter().GetResult()
    $request = @{
      id = 1
      method = "Runtime.evaluate"
      params = @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
    } | ConvertTo-Json -Depth 5 -Compress
    $requestBytes = [Text.Encoding]::UTF8.GetBytes($request)
    [void]$socket.SendAsync(
      [ArraySegment[byte]]::new($requestBytes),
      [Net.WebSockets.WebSocketMessageType]::Text,
      $true,
      $timeout.Token
    ).GetAwaiter().GetResult()
    $buffer = New-Object byte[] 65536
    while ($true) {
      $message = [IO.MemoryStream]::new()
      try {
        do {
          $received = $socket.ReceiveAsync(
            [ArraySegment[byte]]::new($buffer),
            $timeout.Token
          ).GetAwaiter().GetResult()
          if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
            throw "The WebView DevTools connection closed before returning update state."
          }
          $message.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
        $response = [Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
      } finally {
        $message.Dispose()
      }
      if ($response.id -ne 1) { continue }
      if ($response.exceptionDetails) {
        throw "The WebView update-state expression failed: $($response.exceptionDetails.text)"
      }
      return $response.result.result.value
    }
  } finally {
    if ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) {
      [void]$socket.CloseAsync(
        [Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
        "done",
        [Threading.CancellationToken]::None
      ).GetAwaiter().GetResult()
    }
    $socket.Dispose()
    $timeout.Dispose()
  }
}

function Invoke-InstalledExpression([string]$Application, [string]$Expression) {
  $port = New-LoopbackPort
  $argument = "--edge-webview-switches=--remote-debugging-port=$port"
  $process = Start-Process -FilePath $Application -ArgumentList $argument -PassThru
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(40)
    $lastFailure = $null
    while ([DateTime]::UtcNow -lt $deadline) {
      if ($process.HasExited) { throw "ScadMill exited before exposing update state." }
      try {
        $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 2)
        foreach ($target in $targets) {
          if ($target.type -ne "page" -or [string]::IsNullOrWhiteSpace($target.webSocketDebuggerUrl)) {
            continue
          }
          $ready = Invoke-DevToolsExpression $target.webSocketDebuggerUrl `
            "document.readyState === 'complete' && document.querySelector('.workspace-frame') !== null"
          if ($ready -eq $true) {
            return Invoke-DevToolsExpression $target.webSocketDebuggerUrl $Expression
          }
        }
      } catch {
        $lastFailure = $_.Exception
      }
      Start-Sleep -Milliseconds 250
    }
    $detail = if ($lastFailure) { " Last DevTools error: $($lastFailure.Message)" } else { "" }
    throw "ScadMill did not expose update state within 40 seconds.$detail"
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(10000) | Out-Null
    }
  }
}

function Invoke-Setup([string]$Path, [string]$Label) {
  $process = Start-Process -FilePath $Path -ArgumentList "/S" -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "$Label failed with exit code $($process.ExitCode)." }
}

function Get-InstalledApplication {
  $applications = @($script:installRoots | ForEach-Object {
    if (Test-Path -LiteralPath $_) {
      Get-ChildItem -LiteralPath $_ -Filter "scadmill.exe" -Recurse -File
    }
  })
  if ($applications.Count -ne 1) {
    throw "Expected exactly one installed ScadMill executable; found $($applications.Count)."
  }
  return $applications[0].FullName
}

function Get-InstalledUninstaller {
  $uninstallers = @($script:installRoots | ForEach-Object {
    if (Test-Path -LiteralPath $_) {
      Get-ChildItem -LiteralPath $_ -Filter "uninstall*.exe" -Recurse -File
    }
  })
  if ($uninstallers.Count -ne 1) {
    throw "Expected exactly one installed ScadMill uninstaller; found $($uninstallers.Count)."
  }
  return $uninstallers[0].FullName
}

function Assert-ProjectHash([string]$Stage) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $projectFile).Hash
  if ($actual -cne $projectHash) { throw "$Stage changed the user-owned project." }
}

function Assert-CandidateApplication([string]$Stage) {
  $application = Get-InstalledApplication
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $application).Hash
  if ($actual -cne $candidateApplicationHash) {
    throw "$Stage did not install the exact candidate application."
  }
  return $application
}

function Assert-ApplicationState([string]$Application, [string]$Stage) {
  $expression = @"
JSON.stringify({
  autosave: JSON.parse(localStorage.getItem('scadmill.scratch-autosave.v2')),
  proof: localStorage.getItem('scadmill.upgrade-proof.v1'),
  editor: document.querySelector('.cm-content')?.innerText ?? ''
})
"@
  $state = (Invoke-InstalledExpression $Application $expression) | ConvertFrom-Json
  if ($state.autosave.version -ne 2 -or $state.autosave.path -cne "UpgradeProof.scad") {
    throw "$Stage did not preserve the scratch-autosave identity."
  }
  if ($state.autosave.source -cne $projectSource -or $state.proof -cne $proofValue) {
    throw "$Stage did not preserve the exact application-managed state."
  }
  if ([string]$state.editor -notmatch [Regex]::Escape("cube(42);")) {
    throw "$Stage did not restore the saved scratch source into the editor."
  }
  Assert-ProjectHash $Stage
}

$PreviousInstaller = (Resolve-Path -LiteralPath $PreviousInstaller).Path
$CandidateInstaller = (Resolve-Path -LiteralPath $CandidateInstaller).Path
$ExpectedCandidateApplication = (Resolve-Path -LiteralPath $ExpectedCandidateApplication).Path
$previousHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PreviousInstaller).Hash
if ($previousHash -cne $PreviousInstallerSha256.ToUpperInvariant()) {
  throw "The previous public installer hash does not match the release record."
}
if ((Get-AuthenticodeSignature -LiteralPath $PreviousInstaller).Status -ne "Valid") {
  throw "The previous public installer signature is not valid."
}
Write-Host "Previous public installer SHA256 verified: $previousHash"

$candidateInstallerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $CandidateInstaller).Hash
$candidateApplicationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ExpectedCandidateApplication).Hash
$installRoots = @(
  (Join-Path $env:LOCALAPPDATA "ScadMill"),
  (Join-Path $env:LOCALAPPDATA "Programs\ScadMill")
)
$projectRoot = Join-Path $env:RUNNER_TEMP "scadmill-update-repair-user-project"
$projectFile = Join-Path $projectRoot "main.scad"
$projectSource = "// User-owned update/repair sentinel.`ncube(42);`n"
$proofValue = "beta2-state-preserved-into-beta3"
$stateRoot = Join-Path $env:LOCALAPPDATA "dev.scadmill.desktop\EBWebView\Default\Local Storage"
$stateRoots = @(
  (Join-Path $env:LOCALAPPDATA "dev.scadmill.desktop"),
  (Join-Path $env:APPDATA "dev.scadmill.desktop")
)
$evidenceRoot = Join-Path $env:RUNNER_TEMP "scadmill-windows-lifecycle"
$evidencePath = Join-Path $evidenceRoot "update-repair-evidence.json"
$projectHash = $null

if (@(Get-Process -Name scadmill -ErrorAction SilentlyContinue).Count -ne 0) {
  throw "The update host was not clean: ScadMill is already running."
}
if (@($installRoots | ForEach-Object {
  if (Test-Path -LiteralPath $_) { Get-ChildItem -LiteralPath $_ -Filter scadmill.exe -Recurse -File }
}).Count -ne 0) {
  throw "The update host was not clean: ScadMill is already installed."
}

foreach ($statePath in $stateRoots) {
  $resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $statePath))
  $allowedParent = if ($statePath.StartsWith($env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase)) {
    [IO.Path]::GetFullPath($env:LOCALAPPDATA)
  } else {
    [IO.Path]::GetFullPath($env:APPDATA)
  }
  if (-not [string]::Equals($resolvedParent, $allowedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear an unexpected update-proof state path: $statePath"
  }
  if (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Recurse -Force
  }
}

New-Item -ItemType Directory -Path $projectRoot -Force | Out-Null
Set-Content -LiteralPath $projectFile -Value $projectSource -NoNewline -Encoding utf8
$projectHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $projectFile).Hash

try {
  Invoke-Setup $PreviousInstaller "Previous public beta install"
  $previousApplication = Get-InstalledApplication
  $seedExpression = @"
(() => {
  localStorage.setItem('scadmill.scratch-autosave.v2', JSON.stringify({
    version: 2,
    path: 'UpgradeProof.scad',
    source: '// User-owned update/repair sentinel.\ncube(42);\n'
  }));
  localStorage.setItem('scadmill.upgrade-proof.v1', '$proofValue');
  return localStorage.getItem('scadmill.upgrade-proof.v1');
})()
"@
  $seeded = Invoke-InstalledExpression $previousApplication $seedExpression
  if ($seeded -cne $proofValue) { throw "The previous public beta did not retain seeded state." }

  Invoke-Setup $CandidateInstaller "Candidate install-over"
  $candidateApplication = Assert-CandidateApplication "Public-beta upgrade"
  Assert-ApplicationState $candidateApplication "Public-beta upgrade"
  Write-Host "Candidate installed application SHA256 verified after upgrade: $candidateApplicationHash"

  Invoke-Setup $CandidateInstaller "Same-version repair"
  $candidateApplication = Assert-CandidateApplication "Same-version repair"
  Assert-ApplicationState $candidateApplication "Same-version repair"
  Write-Host "Same-version repair preserved application and user state."

  Invoke-Setup (Get-InstalledUninstaller) "Candidate uninstall"
  Assert-ProjectHash "Uninstall"
  if (-not (Test-Path -LiteralPath $stateRoot)) {
    throw "Uninstall removed the application-managed WebView state."
  }
  if (@($installRoots | ForEach-Object {
    if (Test-Path -LiteralPath $_) { Get-ChildItem -LiteralPath $_ -Filter scadmill.exe -Recurse -File }
  }).Count -ne 0) {
    throw "Uninstall left an installed ScadMill executable."
  }
  Write-Host "Uninstall preserved user-owned project and application-managed state."

  Invoke-Setup $CandidateInstaller "Candidate reinstall"
  $candidateApplication = Assert-CandidateApplication "Reinstall"
  Assert-ApplicationState $candidateApplication "Reinstall"
  Write-Host "Reinstall restored the exact candidate and retained state."

  New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
  @{
    status = "passed"
    previousInstallerSha256 = $previousHash
    candidateInstallerSha256 = $candidateInstallerHash
    candidateApplicationSha256 = $candidateApplicationHash
    projectSha256 = $projectHash
    update = "passed"
    sameVersionRepair = "passed"
    uninstallStatePreservation = "passed"
    reinstall = "passed"
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Write-Host "Windows update/repair evidence: $evidencePath"
} finally {
  Get-Process -Name scadmill -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  $cleanupUninstallers = @($installRoots | ForEach-Object {
    if (Test-Path -LiteralPath $_) {
      Get-ChildItem -LiteralPath $_ -Filter "uninstall*.exe" -Recurse -File -ErrorAction SilentlyContinue
    }
  })
  foreach ($uninstaller in $cleanupUninstallers) {
    Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait | Out-Null
  }
}
