# Moves ios/ and android/ to timestamped backups to let Prebuild manage native config
# Usage: .\move_native_to_backup.ps1
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
Set-Location $repoRoot
$timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$dirs = @('ios','android')
foreach ($d in $dirs) {
  if (Test-Path $d) {
    $backup = "$d-backup-$timestamp"
    Write-Host "Moving $d -> $backup"
    try {
      Rename-Item -Path $d -NewName $backup -ErrorAction Stop
      Write-Host "Moved $d to $backup"
    } catch {
      Write-Host ("Failed to move {0}: {1}" -f $d, $_.Exception.Message) -ForegroundColor Red
      Write-Host "Attempting copy+remove fallback"
      try {
        robocopy $d $backup /MIR | Out-Null
        Remove-Item -Recurse -Force $d
        Write-Host "Copied and removed $d -> $backup"
      } catch {
        Write-Host ("Fallback failed for {0}: {1}" -f $d, $_.Exception.Message) -ForegroundColor Red
      }
    }
  } else {
    Write-Host "$d not found, skipping"
  }
}
Write-Host "Done. Backups named like 'ios-backup-<timestamp>' and 'android-backup-<timestamp>'."