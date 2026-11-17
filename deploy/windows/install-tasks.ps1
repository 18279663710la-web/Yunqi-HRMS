# 注册 Windows 10 开机启动任务：服务端、Nginx、运维调度器（需管理员）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\windows\install-tasks.ps1
# 可选：-NginxExe "C:\nginx-1.30.6\nginx.exe" -SkipNginx

param(
    [string]$AppDir = "",
    [string]$NginxExe = "C:\nginx-1.30.6\nginx.exe",
    [switch]$SkipNginx
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

$startScript = Join-Path $PSScriptRoot "start-server.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "YunqiServer" -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "YunqiServer"
Write-Host "已注册并启动计划任务：YunqiServer"

if (-not $SkipNginx) {
    if (-not (Test-Path -LiteralPath $NginxExe)) {
        Write-Warning "找不到 Nginx：$NginxExe，跳过 Nginx 启动任务"
    } else {
        $nginxDir = Split-Path -Parent $NginxExe
        $nginxAction = New-ScheduledTaskAction -Execute $NginxExe -WorkingDirectory $nginxDir
        Register-ScheduledTask -TaskName "YunqiNginx" -Action $nginxAction -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null
        try {
            Start-ScheduledTask -TaskName "YunqiNginx"
            Write-Host "已注册并启动计划任务：YunqiNginx"
        } catch {
            Write-Warning "Nginx 任务已注册，但启动失败（可能已在运行）：$($_.Exception.Message)"
        }
    }
}

$opsInstaller = Join-Path $AppDir "deploy\ops\install-windows-tasks.ps1"
if (Test-Path -LiteralPath $opsInstaller) {
    & $opsInstaller -AppDir $AppDir
} else {
    Write-Warning "未找到运维调度任务安装脚本：$opsInstaller"
}
