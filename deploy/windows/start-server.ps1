# 启动服务端（Windows 10）
# 用法：powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\start-server.ps1
# 日志：server\logs\system\console-YYYY-MM-DD.out.log / .err.log

param([string]$AppDir = "")

$ErrorActionPreference = "Stop"
if (-not $AppDir) {
    $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$serverDir = Join-Path $AppDir "server"
if (-not (Test-Path -LiteralPath (Join-Path $serverDir "dist\index.js"))) {
    Write-Error "找不到 $serverDir\dist\index.js，请先执行 npm run build:server"
    exit 1
}
$logDir = Join-Path $serverDir "logs\system"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$pidFile = Join-Path $logDir "server.pid"

if (Test-Path -LiteralPath $pidFile) {
    $oldPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Write-Host "服务端已在运行，PID=$oldPid"
        exit 0
    }
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Error "找不到 node，请先安装 Node 18+ 并加入 PATH"
    exit 1
}

$day = Get-Date -Format "yyyy-MM-dd"
$outLog = Join-Path $logDir "console-$day.out.log"
$errLog = Join-Path $logDir "console-$day.err.log"
$process = Start-Process -FilePath $node -ArgumentList "dist/index.js" `
    -WorkingDirectory $serverDir `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden -PassThru
$process.Id | Set-Content -LiteralPath $pidFile
Write-Host "服务端已启动，PID=$($process.Id)"
