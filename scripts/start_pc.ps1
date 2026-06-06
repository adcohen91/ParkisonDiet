param()
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot  = Split-Path -Parent $scriptDir
$image     = "parkinsondiet"
$container = "parkinsondiet"

Write-Host "==> Stopping any running container..."
docker rm -f $container 2>$null

Write-Host "==> Building image..."
docker build -t $image $repoRoot

Write-Host "==> Starting container..."
docker run -d `
  --name $container `
  -p 3000:3000 `
  --env-file "$repoRoot\.env" `
  $image

Write-Host ""
Write-Host "ParkinsonDiet running at http://localhost:3000"
Write-Host "Admin at http://localhost:3000/admin"
