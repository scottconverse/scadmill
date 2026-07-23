param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedApplication,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedNotices
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ScadMillWindowProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

. (Join-Path $PSScriptRoot "lib\installed-lifecycle-window.ps1")

function Wait-MainWindow([Diagnostics.Process]$Process) {
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($Process.HasExited) { throw "ScadMill exited before exposing its main window." }
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) { return $Process.MainWindowHandle }
    Start-Sleep -Milliseconds 250
  }
  throw "ScadMill did not expose a main window within 20 seconds."
}

function Read-WindowRect([IntPtr]$Handle) {
  $rect = New-Object ScadMillWindowProbe+RECT
  if (-not [ScadMillWindowProbe]::GetWindowRect($Handle, [ref]$rect)) {
    throw "Could not read the ScadMill window rectangle."
  }
  return $rect
}

function Format-WindowRect($Rect) {
  if ($null -eq $Rect) { return "unavailable" }
  $width = $Rect.Right - $Rect.Left
  $height = $Rect.Bottom - $Rect.Top
  return "left=$($Rect.Left), top=$($Rect.Top), width=$width, height=$height"
}

function Format-WindowSize($Rect) {
  if ($null -eq $Rect) { return "unavailable" }
  return "width=$($Rect.Right - $Rect.Left), height=$($Rect.Bottom - $Rect.Top)"
}

function Measure-WindowRectDelta($Actual, $Expected) {
  return [PSCustomObject]@{
    Left = [Math]::Abs($Actual.Left - $Expected.Left)
    Top = [Math]::Abs($Actual.Top - $Expected.Top)
    Width = [Math]::Abs(($Actual.Right - $Actual.Left) - ($Expected.Right - $Expected.Left))
    Height = [Math]::Abs(($Actual.Bottom - $Actual.Top) - ($Expected.Bottom - $Expected.Top))
  }
}

function Format-WindowRectDelta($Delta) {
  if ($null -eq $Delta) { return "unavailable" }
  return "left=$($Delta.Left), top=$($Delta.Top), width=$($Delta.Width), height=$($Delta.Height)"
}

function Format-WindowSizeDelta($Delta) {
  if ($null -eq $Delta) { return "unavailable" }
  return "width=$($Delta.Width), height=$($Delta.Height)"
}

function Wait-WindowRect(
  [Diagnostics.Process]$Process,
  [IntPtr]$Handle,
  $Expected,
  [int]$Tolerance,
  [int]$TimeoutSeconds = 15
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $minimumObservation = [DateTime]::UtcNow.AddMilliseconds(600)
  $requiredStableProbes = 3
  $attempts = 0
  $stableProbes = 0
  $lastActual = $null
  $lastDelta = $null
  $previousActual = $null
  $lastProbeError = "none"
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process.HasExited) { throw "ScadMill exited before restoring its saved window rectangle." }
    $attempts++
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) { $Handle = $Process.MainWindowHandle }
    try {
      $lastActual = Read-WindowRect $Handle
      $lastProbeError = "none"
    } catch {
      $lastProbeError = $_.Exception.Message
      $stableProbes = 0
      Start-Sleep -Milliseconds 200
      continue
    }
    $lastDelta = Measure-WindowRectDelta $lastActual $Expected
    $matchesExpected = (
      $lastDelta.Left -le $Tolerance -and
      $lastDelta.Top -le $Tolerance -and
      $lastDelta.Width -le $Tolerance -and
      $lastDelta.Height -le $Tolerance
    )
    $stableFromPrevious = $false
    if ($null -ne $previousActual) {
      $stabilityDelta = Measure-WindowRectDelta $lastActual $previousActual
      $stableFromPrevious = (
        $stabilityDelta.Left -le 2 -and
        $stabilityDelta.Top -le 2 -and
        $stabilityDelta.Width -le 2 -and
        $stabilityDelta.Height -le 2
      )
    }
    if ($matchesExpected) {
      $stableProbes = if ($stableFromPrevious) { $stableProbes + 1 } else { 1 }
    } else {
      $stableProbes = 0
    }
    $previousActual = $lastActual
    if ([DateTime]::UtcNow -ge $minimumObservation -and $stableProbes -ge $requiredStableProbes) {
      Write-Host "Saved window rectangle restored after $attempts probe(s). Expected: $(Format-WindowRect $Expected). Actual: $(Format-WindowRect $lastActual). Deltas: $(Format-WindowRectDelta $lastDelta)."
      return $lastActual
    }
    Start-Sleep -Milliseconds 200
  }
  $processStatus = if ($Process.HasExited) { "exited" } else { "running" }
  throw "The installed window did not restore its saved rectangle within $TimeoutSeconds seconds after $attempts probe(s). Expected: $(Format-WindowRect $Expected). Last actual: $(Format-WindowRect $lastActual). Deltas: $(Format-WindowRectDelta $lastDelta). Last probe error: $lastProbeError. Process: $processStatus."
}

function Wait-VisibleWindowRect(
  [Diagnostics.Process]$Process,
  [IntPtr]$Handle,
  $ExpectedSize,
  [int]$Tolerance,
  [int]$VirtualLeft,
  [int]$VirtualTop,
  [int]$VirtualRight,
  [int]$VirtualBottom,
  [int]$TimeoutSeconds = 15
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $minimumObservation = [DateTime]::UtcNow.AddMilliseconds(600)
  $requiredStableProbes = 3
  $attempts = 0
  $stableVisibleProbes = 0
  $lastActual = $null
  $lastDelta = $null
  $previousActual = $null
  $lastProbeError = "none"
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process.HasExited) { throw "ScadMill exited before restoring its window to a visible display." }
    $attempts++
    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) { $Handle = $Process.MainWindowHandle }
    try {
      $lastActual = Read-WindowRect $Handle
      $lastProbeError = "none"
    } catch {
      $lastProbeError = $_.Exception.Message
      $stableVisibleProbes = 0
      Start-Sleep -Milliseconds 200
      continue
    }
    $isVisible = (
      $lastActual.Right -gt $VirtualLeft -and
      $lastActual.Left -lt $VirtualRight -and
      $lastActual.Bottom -gt $VirtualTop -and
      $lastActual.Top -lt $VirtualBottom
    )
    $lastDelta = Measure-WindowRectDelta $lastActual $ExpectedSize
    $matchesRestoredSize = (
      $lastDelta.Width -le $Tolerance -and
      $lastDelta.Height -le $Tolerance
    )
    $stableFromPrevious = $false
    if ($null -ne $previousActual) {
      $stabilityDelta = Measure-WindowRectDelta $lastActual $previousActual
      $stableFromPrevious = (
        $stabilityDelta.Left -le 2 -and
        $stabilityDelta.Top -le 2 -and
        $stabilityDelta.Width -le 2 -and
        $stabilityDelta.Height -le 2
      )
    }
    if ($isVisible -and $matchesRestoredSize) {
      $stableVisibleProbes = if ($stableFromPrevious) { $stableVisibleProbes + 1 } else { 1 }
    } else {
      $stableVisibleProbes = 0
    }
    $previousActual = $lastActual
    if ([DateTime]::UtcNow -ge $minimumObservation -and $stableVisibleProbes -ge $requiredStableProbes) {
      Write-Host "Off-monitor window state restored its saved size on a visible display after $attempts probe(s). Expected size: $(Format-WindowSize $ExpectedSize). Actual: $(Format-WindowRect $lastActual). Size deltas: $(Format-WindowSizeDelta $lastDelta). Virtual bounds: left=$VirtualLeft, top=$VirtualTop, right=$VirtualRight, bottom=$VirtualBottom."
      return $lastActual
    }
    Start-Sleep -Milliseconds 200
  }
  $processStatus = if ($Process.HasExited) { "exited" } else { "running" }
  throw "ScadMill did not restore the saved off-monitor window size on a visible display within $TimeoutSeconds seconds after $attempts probe(s). Expected size: $(Format-WindowSize $ExpectedSize). Last actual: $(Format-WindowRect $lastActual). Size deltas: $(Format-WindowSizeDelta $lastDelta). Virtual bounds: left=$VirtualLeft, top=$VirtualTop, right=$VirtualRight, bottom=$VirtualBottom. Last probe error: $lastProbeError. Process: $processStatus."
}

function New-LoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Invoke-DevToolsExpression([string]$WebSocketUrl, [string]$Expression) {
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  $timeout = [Threading.CancellationTokenSource]::new()
  $timeout.CancelAfter(5000)
  try {
    [void]$socket.ConnectAsync([Uri]$WebSocketUrl, $timeout.Token).GetAwaiter().GetResult()
    $request = @{
      id = 1
      method = "Runtime.evaluate"
      params = @{
        expression = $Expression
        returnByValue = $true
        awaitPromise = $true
      }
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
            throw "The WebView DevTools connection closed before returning editor state."
          }
          $message.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
        $response = [Text.Encoding]::UTF8.GetString($message.ToArray()) | ConvertFrom-Json
      } finally {
        $message.Dispose()
      }
      if ($response.id -ne 1) { continue }
      if ($response.exceptionDetails) {
        throw "The WebView editor-state expression failed: $($response.exceptionDetails.text)"
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

function Wait-EditorSource([int]$Port, [string]$ExpectedSource) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $lastFailure = $null
  $expression = "document.querySelector('.cm-content')?.innerText ?? null"
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2)
      foreach ($target in $targets) {
        if ($target.type -ne "page" -or [string]::IsNullOrWhiteSpace($target.webSocketDebuggerUrl)) {
          continue
        }
        $source = Invoke-DevToolsExpression $target.webSocketDebuggerUrl $expression
        if (($source -replace "`r`n", "`n") -ceq $ExpectedSource) {
          return
        }
      }
    } catch {
      $lastFailure = $_.Exception
    }
    Start-Sleep -Milliseconds 250
  }
  $detail = if ($lastFailure) { " Last DevTools error: $($lastFailure.Message)" } else { "" }
  throw "The associated fixture did not become the exact active editor source in the existing ScadMill WebView.$detail"
}

function Wait-WebViewReady([int]$Port) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $lastFailure = $null
  $expression = "document.readyState === 'complete' && document.querySelector('.workspace-frame') !== null"
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2)
      foreach ($target in $targets) {
        if ($target.type -ne "page" -or [string]::IsNullOrWhiteSpace($target.webSocketDebuggerUrl)) {
          continue
        }
        if ((Invoke-DevToolsExpression $target.webSocketDebuggerUrl $expression) -eq $true) {
          Write-Host "ScadMill WebView reached its complete application-ready state."
          return
        }
      }
    } catch {
      $lastFailure = $_.Exception
    }
    Start-Sleep -Milliseconds 250
  }
  $detail = if ($lastFailure) { " Last DevTools error: $($lastFailure.Message)" } else { "" }
  throw "The ScadMill WebView did not reach its complete application-ready state.$detail"
}

$Installer = (Resolve-Path -LiteralPath $Installer).Path
$ExpectedApplication = (Resolve-Path -LiteralPath $ExpectedApplication).Path
$ExpectedNotices = (Resolve-Path -LiteralPath $ExpectedNotices).Path
$expectedApplicationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ExpectedApplication).Hash
$expectedNoticesHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ExpectedNotices).Hash
$roots = @(
  (Join-Path $env:LOCALAPPDATA "ScadMill"),
  (Join-Path $env:LOCALAPPDATA "Programs\ScadMill")
)
$association = "Registry::HKEY_CURRENT_USER\Software\Classes\.scad"
$sentinelProgId = "ScadMill.Lifecycle.Sentinel"
$sentinelProgIdRoot = "Registry::HKEY_CURRENT_USER\Software\Classes\$sentinelProgId"

$preexistingApplications = @($roots | ForEach-Object {
  if (Test-Path -LiteralPath $_) {
    Get-ChildItem -LiteralPath $_ -Filter scadmill.exe -Recurse -File
  }
})
if ($preexistingApplications.Count -ne 0) {
  throw "The lifecycle host was not clean: a ScadMill executable already existed."
}
if (@(Get-Process -Name scadmill -ErrorAction SilentlyContinue).Count -ne 0) {
  throw "The lifecycle host was not clean: a ScadMill process was already running."
}
if (Test-Path -LiteralPath $association) {
  throw "The lifecycle host was not clean: a .scad association already existed."
}
Write-Host "Clean preinstall state verified."

New-Item -Path $association -Force | Out-Null
Set-Item -LiteralPath $association -Value $sentinelProgId
New-Item -Path $sentinelProgIdRoot -Force | Out-Null
Set-Item -LiteralPath $sentinelProgIdRoot -Value "Lifecycle sentinel association"
Write-Host "Sentinel prior .scad association installed for restoration proof."

try {

$install = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "NSIS install failed with exit code $($install.ExitCode)." }

$installedApplications = @($roots | ForEach-Object {
  if (Test-Path -LiteralPath $_) {
    Get-ChildItem -LiteralPath $_ -Filter scadmill.exe -Recurse -File
  }
})
if ($installedApplications.Count -ne 1) {
  throw "Expected exactly one installed ScadMill executable; found $($installedApplications.Count)."
}
$application = $installedApplications[0]
$installedApplicationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $application.FullName).Hash
if ($installedApplicationHash -cne $expectedApplicationHash) {
  throw "The installed ScadMill executable does not match the exact just-built release executable."
}
Write-Host "Installed application SHA256: $installedApplicationHash"

$installedNotices = @(Get-ChildItem -LiteralPath $application.DirectoryName -Filter "THIRD-PARTY-NOTICES.txt" -Recurse -File)
if ($installedNotices.Count -ne 1) {
  throw "Expected exactly one installed THIRD-PARTY-NOTICES.txt; found $($installedNotices.Count)."
}
$installedNoticesPath = $installedNotices[0].FullName
$installedNoticesHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedNoticesPath).Hash
if ($installedNoticesHash -cne $expectedNoticesHash) {
  throw "The installed third-party notices do not match the exact tracked release notices."
}
Write-Host "Installed third-party notices SHA256: $installedNoticesHash"

if (-not (Test-Path -LiteralPath $association)) { throw "The .scad association was not registered." }
$progId = [string](Get-Item -LiteralPath $association).GetValue("")
if ([string]::IsNullOrWhiteSpace($progId)) { throw "The .scad association did not name a ProgID." }
$associationKey = Get-Item -LiteralPath $association
if ([string]$associationKey.GetValue("OpenSCAD model_backup") -cne $sentinelProgId) {
  throw "The installer did not preserve the prior .scad association in its backup marker."
}
$progIdRoot = "Registry::HKEY_CURRENT_USER\Software\Classes\$progId"
$openCommandKey = Join-Path $progIdRoot "shell\open\command"
if (-not (Test-Path -LiteralPath $openCommandKey)) { throw "The .scad ProgID did not register an open command." }
$openCommand = [Environment]::ExpandEnvironmentVariables(
  [string](Get-Item -LiteralPath $openCommandKey).GetValue("")
)
$expectedOpenCommand = "`"$($application.FullName)`" `"%1`""
if (-not [string]::Equals($openCommand.Trim(), $expectedOpenCommand, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The .scad ProgID open command did not target the exact installed ScadMill executable and quoted %1. Actual: '$openCommand'. Expected: '$expectedOpenCommand'."
}
Write-Host "Installed ProgID/open command verified: $progId"

$debugPort = New-LoopbackPort
$debugArgument = "--edge-webview-switches=--remote-debugging-port=$debugPort"
$first = Start-Process -FilePath $application.FullName -ArgumentList $debugArgument -PassThru
$firstHandle = Wait-MainWindow $first
Wait-WebViewReady $debugPort
if (-not [ScadMillWindowProbe]::MoveWindow($firstHandle, 137, 149, 1111, 713, $true)) {
  throw "Could not set the window-state persistence probe rectangle."
}
Start-Sleep -Seconds 1
$expected = Read-WindowRect $firstHandle
Close-Normally $first

$second = Start-Process -FilePath $application.FullName -ArgumentList $debugArgument -PassThru
$secondHandle = Wait-MainWindow $second
Wait-WebViewReady $debugPort
$tolerance = 12
$restored = Wait-WindowRect $second $secondHandle $expected $tolerance
$restoredWidth = $restored.Right - $restored.Left
$restoredHeight = $restored.Bottom - $restored.Top

$model = Join-Path $env:RUNNER_TEMP "scadmill-associated-open.scad"
$marker = [Guid]::NewGuid().ToString("N")
$modelSource = "// ASSOCIATION-$marker`ncube([7, 8, 9]);"
[IO.File]::WriteAllText($model, $modelSource, [Text.UTF8Encoding]::new($false))
$associationLaunch = Start-Process -FilePath $model -PassThru
$associationLaunch.WaitForExit(15000)
Wait-EditorSource $debugPort $modelSource
$running = @(Get-Process -Name scadmill -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and [string]::Equals($_.Path, $application.FullName, [StringComparison]::OrdinalIgnoreCase)
})
if ($running.Count -ne 1 -or $running[0].Id -ne $second.Id) {
  throw "The exact associated fixture did not retain exactly one existing ScadMill instance."
}
$modelHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $model).Hash
Write-Host "Associated fixture active in existing WebView; SHA256: $modelHash"
$secondHandle = Wait-MainWindow $second

$virtualLeft = [ScadMillWindowProbe]::GetSystemMetrics(76)
$virtualTop = [ScadMillWindowProbe]::GetSystemMetrics(77)
$virtualRight = $virtualLeft + [ScadMillWindowProbe]::GetSystemMetrics(78)
$virtualBottom = $virtualTop + [ScadMillWindowProbe]::GetSystemMetrics(79)
$offscreenWidth = [Math]::Max(800, $restoredWidth - 97)
$offscreenHeight = [Math]::Max(600, $restoredHeight - 67)
if (-not [ScadMillWindowProbe]::MoveWindow($secondHandle, 40000, 40000, $offscreenWidth, $offscreenHeight, $true)) {
  throw "Could not set the off-monitor window-state probe rectangle."
}
$offscreenRequested = Read-WindowRect $secondHandle
$offscreenExpected = Wait-WindowRect $second $secondHandle $offscreenRequested $tolerance
if (
  $offscreenExpected.Right -gt $virtualLeft -and
  $offscreenExpected.Left -lt $virtualRight -and
  $offscreenExpected.Bottom -gt $virtualTop -and
  $offscreenExpected.Top -lt $virtualBottom
) {
  throw "The observed off-monitor probe rectangle remained visible. Actual: $(Format-WindowRect $offscreenExpected). Virtual bounds: left=$virtualLeft, top=$virtualTop, right=$virtualRight, bottom=$virtualBottom."
}
Write-Host "Saved unique off-monitor size for recovery proof: $(Format-WindowRect $offscreenExpected)."
Close-Normally $second

$third = Start-Process -FilePath $application.FullName -ArgumentList $debugArgument -PassThru
$thirdHandle = Wait-MainWindow $third
Wait-WebViewReady $debugPort
[void](Wait-VisibleWindowRect $third $thirdHandle $offscreenExpected $tolerance $virtualLeft $virtualTop $virtualRight $virtualBottom)
Close-Normally $third

$uninstallers = @(Get-ChildItem -LiteralPath $application.DirectoryName -Filter "uninstall*.exe" -File)
if ($uninstallers.Count -ne 1) { throw "Expected exactly one ScadMill uninstaller; found $($uninstallers.Count)." }
$uninstaller = $uninstallers[0]
$uninstallerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $uninstaller.FullName).Hash
Write-Host "Installed uninstaller SHA256: $uninstallerHash"
$uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)." }
if (Test-Path -LiteralPath $application.FullName) { throw "ScadMill remained installed after uninstall." }
if (Test-Path -LiteralPath $installedNoticesPath) { throw "Third-party notices remained installed after uninstall." }
if (-not (Test-Path -LiteralPath $association)) { throw "Uninstall deleted the prior .scad association." }
$restoredAssociation = Get-Item -LiteralPath $association
if ([string]$restoredAssociation.GetValue("") -cne $sentinelProgId) {
  throw "Uninstall did not restore the prior .scad association."
}
if ($restoredAssociation.GetValueNames() -contains "OpenSCAD model_backup") {
  throw "The ScadMill association backup marker remained after uninstall."
}
if (-not (Test-Path -LiteralPath $sentinelProgIdRoot)) {
  throw "Uninstall deleted the prior association's ProgID."
}
if (Test-Path -LiteralPath $progIdRoot) { throw "The ScadMill ProgID remained after uninstall." }

Write-Host "Exact installed NSIS lifecycle, third-party notices, active associated-file single-instance routing, normal/off-monitor window restoration, and uninstall passed."
} finally {
  Get-Process -Name scadmill -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $cleanupUninstallers = @($roots | ForEach-Object {
    if (Test-Path -LiteralPath $_) {
      Get-ChildItem -LiteralPath $_ -Filter "uninstall*.exe" -Recurse -File -ErrorAction SilentlyContinue
    }
  })
  foreach ($cleanupUninstaller in $cleanupUninstallers) {
    Start-Process -FilePath $cleanupUninstaller.FullName -ArgumentList "/S" -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $association) {
    $cleanupAssociation = Get-Item -LiteralPath $association
    if ([string]$cleanupAssociation.GetValue("") -ceq $sentinelProgId) {
      Remove-Item -LiteralPath $association -Force
    }
  }
  if (Test-Path -LiteralPath $sentinelProgIdRoot) {
    Remove-Item -LiteralPath $sentinelProgIdRoot -Recurse -Force
  }
  if ($model -and (Test-Path -LiteralPath $model)) {
    Remove-Item -LiteralPath $model -Force
  }
}
