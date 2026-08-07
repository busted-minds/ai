[CmdletBinding()]
param(
  [string]$BmaiSiteUrl = "https://ai.bustedminds.us.kg",
  [string]$CentralAccountUrl = "https://accounts.bustedminds.us.kg",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$centralRef = "mbqplfqelnljrlvzkmxe"
$bmaiRef = "zwefyzpiknkopvcjbfsy"

function Get-SupabaseAccessToken {
  if ($env:SUPABASE_ACCESS_TOKEN) { return $env:SUPABASE_ACCESS_TOKEN }
  if ($IsWindows -or $env:OS -eq "Windows_NT") {
    if (-not ("BmaiAuthCredentialReader" -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BmaiAuthCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern void CredFree(IntPtr credentialPtr);
  public static string Read(string target) { IntPtr pointer; if (!CredRead(target, 1, 0, out pointer)) return null; try { CREDENTIAL credential = Marshal.PtrToStructure<CREDENTIAL>(pointer); byte[] bytes = new byte[credential.CredentialBlobSize]; Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length); return Encoding.UTF8.GetString(bytes); } finally { CredFree(pointer); } }
}
'@
    }
    foreach ($name in @("Supabase CLI:supabase", "Supabase CLI:access-token")) {
      $token = [BmaiAuthCredentialReader]::Read($name)
      if ($token) { return $token }
    }
  }
  $fallback = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".supabase\access-token"
  if (Test-Path -LiteralPath $fallback) { return (Get-Content -LiteralPath $fallback -Raw).Trim() }
  throw "Supabase CLI credentials were not found."
}

$token = Get-SupabaseAccessToken
$headers = @{ Authorization = "Bearer $token" }
function Get-AuthConfig([string]$ref) {
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/config/auth" -Headers $headers
}
function Patch-AuthConfig([string]$ref, [hashtable]$patch) {
  Invoke-RestMethod -Method Patch -Uri "https://api.supabase.com/v1/projects/$ref/config/auth" -Headers $headers -ContentType "application/json" -Body ($patch | ConvertTo-Json -Depth 8) | Out-Null
}

$central = Get-AuthConfig $centralRef
$bmai = Get-AuthConfig $bmaiRef
Write-Output "Central: site_url=$($central.site_url), oauth_server_enabled=$($central.oauth_server_enabled), authorization_path=$($central.oauth_server_authorization_path), google_enabled=$($central.external_google_enabled)"
Write-Output "BMAI: site_url=$($bmai.site_url), google_enabled=$($bmai.external_google_enabled), custom_oauth_enabled=$($bmai.custom_oauth_enabled)"
if (-not $Apply) { return }

$backupDirectory = Join-Path $PSScriptRoot "..\tmp"
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$backupPath = Join-Path $backupDirectory ("auth-config-backup-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
@{
  central = @{
    site_url = $central.site_url
    uri_allow_list = $central.uri_allow_list
    oauth_server_enabled = $central.oauth_server_enabled
    oauth_server_authorization_path = $central.oauth_server_authorization_path
    oauth_server_allow_dynamic_registration = $central.oauth_server_allow_dynamic_registration
  }
  bmai = @{
    site_url = $bmai.site_url
    uri_allow_list = $bmai.uri_allow_list
    external_google_enabled = $bmai.external_google_enabled
    custom_oauth_enabled = $bmai.custom_oauth_enabled
  }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $backupPath -Encoding utf8

$normalizedBmaiSiteUrl = $BmaiSiteUrl.TrimEnd("/")
$normalizedCentralAccountUrl = $CentralAccountUrl.TrimEnd("/")
$redirects = @(
  "$normalizedBmaiSiteUrl/auth/callback",
  "http://localhost:3000/auth/callback"
)
if ($bmai.uri_allow_list) {
  $redirects += @([string]$bmai.uri_allow_list -split ",")
}
$redirectList = ($redirects | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique) -join ","

$centralRedirects = @(
  "$normalizedCentralAccountUrl/auth/callback"
)
if ($central.uri_allow_list) {
  $centralRedirects += @([string]$central.uri_allow_list -split ",")
}
$centralRedirectList = ($centralRedirects | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique) -join ","

Patch-AuthConfig $centralRef @{
  site_url = $normalizedCentralAccountUrl
  uri_allow_list = $centralRedirectList
  oauth_server_enabled = $true
  oauth_server_authorization_path = "/oauth/consent"
  oauth_server_allow_dynamic_registration = $false
}
Patch-AuthConfig $bmaiRef @{
  site_url = $normalizedBmaiSiteUrl
  uri_allow_list = $redirectList
  external_google_enabled = $false
  custom_oauth_enabled = $true
}

$centralVerified = Get-AuthConfig $centralRef
$bmaiVerified = Get-AuthConfig $bmaiRef
if (
  -not $centralVerified.oauth_server_enabled -or
  $centralVerified.oauth_server_authorization_path -ne "/oauth/consent" -or
  $centralVerified.site_url -ne $normalizedCentralAccountUrl -or
  "$normalizedCentralAccountUrl/auth/callback" -notin (@([string]$centralVerified.uri_allow_list -split ",") | ForEach-Object { $_.Trim() })
) {
  throw "Central OAuth server configuration did not persist."
}
$verifiedRedirects = @([string]$bmaiVerified.uri_allow_list -split ",") | ForEach-Object { $_.Trim() }
if (
  $bmaiVerified.external_google_enabled -or
  -not $bmaiVerified.custom_oauth_enabled -or
  $bmaiVerified.site_url -ne $normalizedBmaiSiteUrl -or
  "$normalizedBmaiSiteUrl/auth/callback" -notin $verifiedRedirects
) {
  throw "BMAI Auth configuration did not persist."
}
Write-Output "Verified central OAuth server and BMAI Auth settings. Google remains $($centralVerified.external_google_enabled) in Chess and is disabled in BMAI."
Write-Output "Previous non-secret settings were backed up to $backupPath"
