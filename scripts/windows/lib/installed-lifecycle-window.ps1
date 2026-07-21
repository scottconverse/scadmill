function Close-Normally {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Process,

    [scriptblock]$ResolveCurrentHandle = {
      param($Target)
      $Target.Refresh()
      return [IntPtr]$Target.MainWindowHandle
    },

    [scriptblock]$ResolveWindowOwner = {
      param([IntPtr]$WindowHandle)
      [uint32]$ownerProcessId = 0
      $threadId = [ScadMillWindowProbe]::GetWindowThreadProcessId($WindowHandle, [ref]$ownerProcessId)
      if ($threadId -eq 0) { return 0 }
      return [int]$ownerProcessId
    },

    [scriptblock]$PostClose = {
      param([IntPtr]$WindowHandle)
      return [ScadMillWindowProbe]::PostMessage(
        $WindowHandle,
        0x0010,
        [IntPtr]::Zero,
        [IntPtr]::Zero
      )
    },

    [scriptblock]$ReadLastError = {
      return [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    },

    [scriptblock]$WaitForExit = {
      param($Target, [int]$TimeoutMilliseconds)
      return $Target.WaitForExit($TimeoutMilliseconds)
    },

    [scriptblock]$KillProcess = {
      param($Target)
      $Target.Kill($true)
    }
  )

  $currentHandle = [IntPtr](& $ResolveCurrentHandle $Process)
  if ($currentHandle -eq [IntPtr]::Zero) {
    throw "Could not send a normal close request to ScadMill because its current main window handle is unavailable."
  }

  $ownerProcessId = [int](& $ResolveWindowOwner $currentHandle)
  if ($ownerProcessId -ne [int]$Process.Id) {
    throw "Could not send a normal close request to ScadMill because current window handle $currentHandle belongs to process $ownerProcessId instead of $($Process.Id)."
  }

  if (-not (& $PostClose $currentHandle)) {
    $code = & $ReadLastError
    throw "Could not send a normal close request to ScadMill. Win32 error: $code."
  }

  if (-not (& $WaitForExit $Process 15000)) {
    & $KillProcess $Process
    throw "ScadMill did not close normally after a close request to current window handle $currentHandle."
  }
}
