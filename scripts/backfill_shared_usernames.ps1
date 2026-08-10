[CmdletBinding()]
param(
  [string]$CentralProjectRef = "mbqplfqelnljrlvzkmxe",
  [string]$BmaiProjectRef = "zwefyzpiknkopvcjbfsy",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
$usernamePattern = '^[a-zA-Z0-9_]{3,24}$'

function Get-SupabaseAccessToken {
  if ($env:SUPABASE_ACCESS_TOKEN) { return $env:SUPABASE_ACCESS_TOKEN }

  if ($IsWindows -or $env:OS -eq "Windows_NT") {
    if (-not ("BmaiUsernameCredentialReader" -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class BmaiUsernameCredentialReader
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
      $token = [BmaiUsernameCredentialReader]::Read($credentialName)
      if ($token) { return $token }
    }
  }

  $fallback = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".supabase\access-token"
  if (Test-Path -LiteralPath $fallback) { return (Get-Content -LiteralPath $fallback -Raw).Trim() }
  throw "Supabase CLI credentials were not found. Run 'supabase login' or set SUPABASE_ACCESS_TOKEN."
}

function Invoke-ManagementSql {
  param(
    [Parameter(Mandatory)][string]$ProjectRef,
    [Parameter(Mandatory)][string]$Sql,
    [bool]$ReadOnly = $false
  )
  $body = @{ query = $Sql; read_only = $ReadOnly } | ConvertTo-Json -Depth 4
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/database/query" `
    -Headers @{ Authorization = "Bearer $script:AccessToken" } `
    -ContentType "application/json" `
    -Body $body
}

$script:AccessToken = Get-SupabaseAccessToken

$centralResult = Invoke-ManagementSql -ProjectRef $CentralProjectRef -ReadOnly $true -Sql @'
select profile.id::text as central_account_id, profile.username::text as username
from public.profiles as profile
join auth.users as auth_user on auth_user.id = profile.id
where profile.username_is_custom = true
  and profile.account_kind = 'permanent'
  and profile.status = 'active'
  and coalesce(auth_user.is_anonymous, false) = false
  and auth_user.email_confirmed_at is not null
  and profile.username::text ~ '^[a-zA-Z0-9_]{3,24}$'
order by profile.id;
'@
$centralRows = @($centralResult)

$centralIntegrity = Invoke-ManagementSql -ProjectRef $CentralProjectRef -ReadOnly $true -Sql @'
with expected as (
  select
    auth_user.id,
    auth_user.raw_user_meta_data,
    case
      when coalesce(auth_user.is_anonymous, false) = false
        and auth_user.email_confirmed_at is not null
        and profile.username_is_custom = true
        and profile.account_kind = 'permanent'
        and profile.status = 'active'
        and profile.username::text ~ '^[a-zA-Z0-9_]{3,24}$'
      then profile.username::text
      else null
    end as username
  from auth.users as auth_user
  left join public.profiles as profile on profile.id = auth_user.id
)
select count(*)::integer as mismatch_count
from expected
where raw_user_meta_data ->> 'preferred_username' is distinct from username
   or raw_user_meta_data ? 'username';
'@
if ([int]$centralIntegrity.mismatch_count -ne 0) {
  throw "The central OIDC username projection has $($centralIntegrity.mismatch_count) mismatched Auth users."
}

$bmaiResult = Invoke-ManagementSql -ProjectRef $BmaiProjectRef -ReadOnly $true -Sql @'
select id::text as profile_id, central_account_id::text as central_account_id, username
from public.account_profiles
order by id;
'@
$bmaiRows = @($bmaiResult)

$canonical = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($row in $centralRows) {
  $centralAccountId = [string]$row.central_account_id
  $username = [string]$row.username
  if ($centralAccountId -notmatch $uuidPattern -or $username -notmatch $usernamePattern) {
    throw "The central query returned invalid data (valid account ID: $($centralAccountId -match $uuidPattern); account ID length: $($centralAccountId.Length); valid username: $($username -match $usernamePattern); username length: $($username.Length))."
  }
  $canonical.Add($centralAccountId, $username)
}

$updates = [Collections.Generic.List[object]]::new()
$linked = 0
foreach ($row in $bmaiRows) {
  $profileId = [string]$row.profile_id
  $centralAccountId = [string]$row.central_account_id
  if ($profileId -notmatch $uuidPattern -or $centralAccountId -notmatch $uuidPattern) {
    throw "The BMAI query returned an invalid account identifier."
  }
  if (-not $canonical.ContainsKey($centralAccountId)) { continue }
  $linked += 1
  $username = $canonical[$centralAccountId]
  if ([string]$row.username -cne $username) {
    $updates.Add([pscustomobject]@{
      ProfileId = $profileId
      CentralAccountId = $centralAccountId
      Username = $username
    })
  }
}

Write-Output "Central verified custom usernames: $($centralRows.Count)."
Write-Output "Central OIDC projection mismatches: 0."
Write-Output "BMAI account profiles: $($bmaiRows.Count); linked to an eligible central username: $linked; pending updates: $($updates.Count)."
if (-not $Apply) { return }

for ($offset = 0; $offset -lt $updates.Count; $offset += 100) {
  $end = [Math]::Min($offset + 99, $updates.Count - 1)
  $values = @($updates[$offset..$end] | ForEach-Object {
    $escapedUsername = $_.Username.Replace("'", "''")
    "('$($_.ProfileId)'::uuid, '$($_.CentralAccountId)'::uuid, '$escapedUsername'::text)"
  }) -join ",`n"
  $sql = @"
update public.account_profiles as profile
set username = source.username
from (values
$values
) as source(profile_id, central_account_id, username)
where profile.id = source.profile_id
  and profile.central_account_id = source.central_account_id
  and profile.username is distinct from source.username;
"@
  Invoke-ManagementSql -ProjectRef $BmaiProjectRef -Sql $sql | Out-Null
}

$verifiedResult = Invoke-ManagementSql -ProjectRef $BmaiProjectRef -ReadOnly $true -Sql @'
select id::text as profile_id, central_account_id::text as central_account_id, username
from public.account_profiles
order by id;
'@
$verifiedRows = @($verifiedResult)
$missing = 0
foreach ($row in $verifiedRows) {
  $centralAccountId = [string]$row.central_account_id
  if ($canonical.ContainsKey($centralAccountId) -and [string]$row.username -cne $canonical[$centralAccountId]) {
    $missing += 1
  }
}
if ($missing -ne 0) { throw "Shared username backfill verification failed for $missing linked BMAI profiles." }
Write-Output "Verified: every linked BMAI profile has its canonical central username."
