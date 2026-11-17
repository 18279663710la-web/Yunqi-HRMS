# 为 Windows 10 注册运维调度任务（需要管理员权限）
#
# 以管理员身份运行：
#   powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\ops\install-windows-tasks.ps1
#
# 任务在系统启动时运行 scheduler.ps1，由它读取 server\.env 中的备份开关和周期。

param(
    [string]$AppDir = "",
    [string]$TaskName = "YunqiOpsScheduler"
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "请以管理员身份运行本脚本"
    exit 1
}

if (-not $AppDir) {
    $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$scheduler = Join-Path $AppDir "deploy\ops\scheduler.ps1"
if (-not (Test-Path -LiteralPath $scheduler)) {
    Write-Error "找不到调度脚本：$scheduler"
    exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scheduler`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "已注册并启动计划任务：$TaskName"
Write-Host "查看状态：Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
