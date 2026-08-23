# Build and start the Kanban PM app container. For Windows.
Set-Location (Join-Path $PSScriptRoot "..")

New-Item -ItemType Directory -Force -Path backend\data | Out-Null

docker build -t pm-app .
docker rm -f pm-app 2>$null
docker run -d --name pm-app -p 8000:8000 --env-file .env `
  -v "${PWD}\backend\data:/app/backend/data" pm-app

Write-Output "Kanban PM running at http://localhost:8000"
