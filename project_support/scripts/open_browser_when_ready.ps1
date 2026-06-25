param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "SilentlyContinue"
$healthUrl = "$Url/health"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

do {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        if ($health.backend -eq $true) {
            Start-Process $Url
            exit 0
        }
    } catch {
    }
    Start-Sleep -Milliseconds 700
} while ((Get-Date) -lt $deadline)

exit 1
