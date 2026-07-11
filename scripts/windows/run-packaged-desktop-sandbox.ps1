$ErrorActionPreference = "Continue"
$output = "C:\ScadMillEvidenceOutput"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$local = "C:\ScadMillRun"
$copyLog = Join-Path $output "sandbox-staging-copy.txt"

foreach ($mapping in @(
  @{ Source = "C:\ScadMillEvidence\app"; Destination = "$local\app" },
  @{ Source = "C:\ScadMillEvidence\tools"; Destination = "$local\tools" },
  @{ Source = "C:\ScadMillEvidence\scripts"; Destination = "$local\scripts" },
  @{ Source = "C:\ScadMillEngine"; Destination = "$local\engine" },
  @{ Source = "C:\ScadMillWebView"; Destination = "$local\webview" }
)) {
  & robocopy.exe $mapping.Source $mapping.Destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NP /LOG+:$copyLog | Out-Null
  if ($LASTEXITCODE -gt 7) {
    Set-Content -LiteralPath (Join-Path $output "sandbox-exit-code.txt") -Value $LASTEXITCODE -Encoding ascii
    shutdown.exe /s /t 5 /f
    exit $LASTEXITCODE
  }
}

$arguments = @(
  "$local\scripts\run-packaged-desktop-evidence.mjs",
  "--app", "$local\app\scadmill.exe",
  "--engine", "$local\engine\openscad.exe",
  "--tauri-driver", "$local\tools\tauri-driver.exe",
  "--native-driver", "$local\tools\msedgedriver.exe",
  "--webview", "$local\webview",
  "--credential-probe", "$local\scripts\credential-probe.ps1",
  "--source-metadata", "$local\scripts\source-metadata.json",
  "--harness-manifest", "C:\ScadMillEvidence\harness-manifest.json",
  "--output", $output
)

& "$local\tools\node.exe" @arguments *> (Join-Path $output "runner-console.txt")
$exitCode = $LASTEXITCODE
Set-Content -LiteralPath (Join-Path $output "sandbox-exit-code.txt") -Value $exitCode -Encoding ascii
shutdown.exe /s /t 5 /f
exit $exitCode
