param(
    [Parameter(Mandatory = $true)][string]$Bin,
    [Parameter(Mandatory = $true)][ValidateSet('activate', 'deactivate')][string]$Mode
)
$ErrorActionPreference = 'Stop'
$resolvedBin = [System.IO.Path]::GetFullPath($Bin).TrimEnd('\')
if ($Mode -eq 'activate') {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    foreach ($entry in ($machinePath -split ';')) {
        if (-not $entry) { continue }
        foreach ($suffix in @('.com', '.exe', '.bat', '.cmd')) {
            if (Test-Path -LiteralPath (Join-Path ([Environment]::ExpandEnvironmentVariables($entry)) ('kimi' + $suffix))) {
                throw 'A system PATH entry already provides kimi. The managed launcher is available, but user PATH cannot take precedence. No PATH change was made.'
            }
        }
    }
}
$previousPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$otherEntries = @($previousPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $resolvedBin })
$nextEntries = if ($Mode -eq 'activate') { @($resolvedBin) + $otherEntries } else { $otherEntries }
[Environment]::SetEnvironmentVariable('Path', ($nextEntries -join ';'), 'User')
Write-Output "User PATH: $Mode"
