param()
$ErrorActionPreference = "Continue"
docker rm -f parkinsondiet 2>$null
Write-Host "Stopped."
