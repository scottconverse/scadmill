$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
. (Join-Path $repositoryRoot "scripts/windows/lib/installed-lifecycle-window.ps1")

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -ne $Expected) {
    throw "$Message Expected '$Expected'; received '$Actual'."
  }
}

function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Message) {
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notmatch $Pattern) {
      throw "$Message Wrong error: $($_.Exception.Message)"
    }
    return
  }
  throw "$Message Expected an exception."
}

function New-FakeProcess([int]$Id) {
  return [PSCustomObject]@{ Id = $Id }
}

$process = New-FakeProcess 41
$postedHandle = [IntPtr]::Zero
$killed = $false
Close-Normally -Process $process `
  -ResolveCurrentHandle { [IntPtr]456 } `
  -ResolveWindowOwner { param($Handle) if ($Handle -ne [IntPtr]456) { throw "stale handle selected" }; 41 } `
  -PostClose { param($Handle) $script:postedHandle = $Handle; $true } `
  -WaitForExit { param($Target, $Timeout) Assert-Equal $Target.Id 41 "Wrong process waited."; Assert-Equal $Timeout 15000 "Wrong close timeout."; $true } `
  -KillProcess { $script:killed = $true }
Assert-Equal $postedHandle ([IntPtr]456) "The refreshed current handle was not posted."
Assert-Equal $killed $false "A normally exiting process was killed."

$postCount = 0
Assert-Throws {
  Close-Normally -Process $process `
    -ResolveCurrentHandle { [IntPtr]::Zero } `
    -ResolveWindowOwner { 41 } `
    -PostClose { $script:postCount++; $true }
} "current main window handle is unavailable" "Zero current handle did not fail closed."
Assert-Equal $postCount 0 "Zero current handle still posted a close request."

Assert-Throws {
  Close-Normally -Process $process `
    -ResolveCurrentHandle { [IntPtr]456 } `
    -ResolveWindowOwner { 99 } `
    -PostClose { $script:postCount++; $true }
} "belongs to process 99 instead of 41" "Foreign current handle did not fail closed."
Assert-Equal $postCount 0 "Foreign current handle still posted a close request."

Assert-Throws {
  Close-Normally -Process $process `
    -ResolveCurrentHandle { [IntPtr]456 } `
    -ResolveWindowOwner { 41 } `
    -PostClose { $false } `
    -ReadLastError { 87 }
} "Win32 error: 87" "PostMessage failure did not retain its Win32 error."

$killed = $false
Assert-Throws {
  Close-Normally -Process $process `
    -ResolveCurrentHandle { [IntPtr]456 } `
    -ResolveWindowOwner { 41 } `
    -PostClose { $true } `
    -WaitForExit { $false } `
    -KillProcess { param($Target) Assert-Equal $Target.Id 41 "Wrong process killed."; $script:killed = $true }
} "did not close normally" "Non-exit did not fail the lifecycle."
Assert-Equal $killed $true "Non-exiting process was not killed before failure."

Write-Output "Windows lifecycle close behavior: PASS"
