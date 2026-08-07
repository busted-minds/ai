[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectRef,
  [Parameter(Mandatory)][string]$MigrationsPath,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

function Get-SupabaseAccessToken {
  if ($env:SUPABASE_ACCESS_TOKEN) { return $env:SUPABASE_ACCESS_TOKEN }

  if ($IsWindows -or $env:OS -eq "Windows_NT") {
    if (-not ("BmaiSupabaseCredentialReader" -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class BmaiSupabaseCredentialReader
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public UInt32 Flags; public UInt32 Type; public IntPtr TargetName;
        public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
        public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern void CredFree(IntPtr credentialPtr);
    public static string Read(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, 1, 0, out pointer)) return null;
        try {
            CREDENTIAL credential = Marshal.PtrToStructure<CREDENTIAL>(pointer);
            byte[] bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.UTF8.GetString(bytes);
        } finally { CredFree(pointer); }
    }
}
'@
    }
    foreach ($credentialName in @("Supabase CLI:supabase", "Supabase CLI:access-token")) {
      $token = [BmaiSupabaseCredentialReader]::Read($credentialName)
      if ($token) { return $token }
    }
  }

  $fallback = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".supabase\access-token"
  if (Test-Path -LiteralPath $fallback) { return (Get-Content -LiteralPath $fallback -Raw).Trim() }
  throw "Supabase CLI credentials were not found. Run 'supabase login' or set SUPABASE_ACCESS_TOKEN."
}

function Invoke-ManagementSql {
  param([Parameter(Mandatory)][string]$Sql, [bool]$ReadOnly = $false)
  $body = @{ query = $Sql; read_only = $ReadOnly } | ConvertTo-Json -Depth 4
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
    -Headers @{ Authorization = "Bearer $script:AccessToken" } `
    -ContentType "application/json" `
    -Body $body
}

$resolvedMigrationsPath = (Resolve-Path -LiteralPath $MigrationsPath).Path
$script:AccessToken = Get-SupabaseAccessToken

try {
  $historyResult = Invoke-ManagementSql -ReadOnly $true -Sql @'
select version, coalesce(name, '') as name
from supabase_migrations.schema_migrations
order by version;
'@
  Write-Verbose ($historyResult | ConvertTo-Json -Depth 8 -Compress)
  $history = @($historyResult)
} catch {
  $history = @()
}

$local = @(Get-ChildItem -LiteralPath $resolvedMigrationsPath -Filter "*.sql" -File | ForEach-Object {
  if ($_.BaseName -notmatch '^(\d+)_(.+)$') {
    throw "Migration name must start with a numeric version: $($_.Name)"
  }
  [pscustomobject]@{ Version = $matches[1]; Name = $matches[2]; Path = $_.FullName; File = $_.Name }
} | Sort-Object Version)

$liveVersions = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($row in $history) { [void]$liveVersions.Add([string]$row.version) }
$pending = @($local | Where-Object { -not $liveVersions.Contains($_.Version) })

Write-Output "Project ${ProjectRef}: $($history.Count) live migrations, $($local.Count) local migrations, $($pending.Count) pending."
if ($history.Count) {
  Write-Output "Complete live history:"
  $history | ForEach-Object { Write-Output ("  {0} {1}" -f $_.version, $_.name) }
}
if ($pending.Count) {
  Write-Output "Pending in application order:"
  $pending | ForEach-Object { Write-Output ("  {0}" -f $_.File) }
}

if (-not $Apply) { return }

if (-not $history.Count) {
  Invoke-ManagementSql -Sql @'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
'@ | Out-Null
}

foreach ($migration in $pending) {
  $sql = Get-Content -LiteralPath $migration.Path -Raw
  $escapedVersion = $migration.Version.Replace("'", "''")
  $escapedName = $migration.Name.Replace("'", "''")
  $transaction = @"
begin;
$sql
insert into supabase_migrations.schema_migrations(version, statements, name)
values ('$escapedVersion', array[]::text[], '$escapedName');
commit;
"@
  Invoke-ManagementSql -Sql $transaction | Out-Null
  Write-Output "Applied $($migration.File)"
}

$verifiedHistoryResult = Invoke-ManagementSql -ReadOnly $true -Sql @'
select version, coalesce(name, '') as name
from supabase_migrations.schema_migrations
order by version;
'@
$verifiedHistory = @($verifiedHistoryResult)
$verifiedVersions = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($row in $verifiedHistory) { [void]$verifiedVersions.Add([string]$row.version) }
$missing = @($local | Where-Object { -not $verifiedVersions.Contains($_.Version) })
if ($missing.Count) { throw "Migration verification failed. Still missing: $($missing.Version -join ', ')" }
Write-Output "Verified: all $($local.Count) local migrations are present in live history for $ProjectRef."
