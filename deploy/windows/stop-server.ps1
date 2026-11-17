# 停止服务端（Windows 10）
param([string]$AppDir = "")

$ErrorActionPreference = "Stop"
if (-not $AppDir) {
    $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$pidFile = Join-Path $AppDir "server\logs\system\server.pid"
if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host "未找到运行中的服务端 PID 文件"
    exit 0
}
$serverPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
if ($serverPid -and (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $serverPid -Force
    Start-Sleep -Seconds 1
    Write-Host "服务端已停止，PID=$serverPid"
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
