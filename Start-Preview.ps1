param(
    [ValidateRange(1024, 65535)][int]$Port = 8741,
    [switch]$ResetAdminPassword
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
Add-Type -Path (Join-Path $projectRoot 'server/HandHelperServer.cs') -ReferencedAssemblies System.Web.Extensions, System.Core
$newPassword = $null
if ($ResetAdminPassword) {
    $securePassword = Read-Host 'New administrator password (at least 5 characters)' -AsSecureString
    if ($securePassword.Length -lt 5 -or $securePassword.Length -gt 256) { throw 'Password must contain 5 to 256 characters.' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $newPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$server = [HandHelper.PortalServer]::new($projectRoot, $Port)
$initialPassword = $server.Initialize($newPassword)
$newPassword = $null
Write-Output "HandHelper: http://127.0.0.1:$Port/ (Ctrl+C to stop)"
if ($initialPassword) {
    Write-Output 'Administrator username: admin'
    Write-Output "Initial password (shown once): $initialPassword"
    $initialPassword = $null
}
try { $server.Run() } finally { $server.Dispose() }
