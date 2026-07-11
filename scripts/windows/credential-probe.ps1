param(
  [Parameter(Mandatory = $true)]
  [string] $Target
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class ScadMillCredentialProbe
{
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("advapi32.dll", SetLastError = false)]
    public static extern void CredFree(IntPtr credential);
}
"@

$credential = [IntPtr]::Zero
$found = [ScadMillCredentialProbe]::CredRead($Target, 1, 0, [ref] $credential)
$lastError = if ($found) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
if ($credential -ne [IntPtr]::Zero) {
  [ScadMillCredentialProbe]::CredFree($credential)
}

[pscustomobject]@{
  target = $Target
  found = $found
  lastError = $lastError
} | ConvertTo-Json -Compress
