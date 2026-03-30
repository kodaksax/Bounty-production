#!/usr/bin/env pwsh
# Repairs the remote Supabase migration history to match local migrations.
# Run once to resolve "Remote migration versions not found in local directory".

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)

$versions = @(
  "20251001","20251002","20251010","20251015",
  "20251102","20251117","20251119",
  "20251120","20251120","20251122",
  "20251126","20251126","20251216","20251230",
  "20260107","20260109",
  "20260115","20260115","20260115",
  "20260212","20260215","20260221","20260224",
  "20260301","20260302","20260302","20260302",
  "20260303","20260303","20260303",
  "20260304","20260309","20260309",
  "20260310","20260311","20260311",
  "20260316","20260316","20260316",
  "20260317","20260318",
  "20260320","20260320","20260320","20260320","20260320","20260320",
  "20260322","20260323"
)

foreach ($v in $versions) {
  Write-Host "Marking $v as applied..." -ForegroundColor Cyan
  npx supabase migration repair --status applied $v
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Failed on $v (exit $LASTEXITCODE) — continuing"
  }
}

Write-Host "`nDone. Verifying..." -ForegroundColor Green
npx supabase migration list
