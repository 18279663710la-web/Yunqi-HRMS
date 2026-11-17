# 运维调度器（Windows 10）
#
# 读取 server\.env，按配置周期执行数据库备份和 Nginx 日志轮转：
#   BACKUP_ENABLED / BACKUP_INTERVAL_HOURS
#   LOG_ROTATE_ENABLED / LOG_ROTATE_INTERVAL_HOURS
#   NGINX_LOG_DIR / NGINX_EXE
# 修改 .env 后无需重启调度器，下一轮自动生效。
#
# 建议通过“任务计划程序”在系统启动时运行：
#   powershell -ExecutionPolicy Bypass -File C:\yunqi\deploy\ops\install-windows-tasks.ps1

param(
    [string]$AppDir = "",
    [int]$IntervalSeconds = 60,
    [switch]$Once
)

$ErrorActionPreference = "Stop"
if (-not $AppDir) {
    $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$envFile = Join-Path $AppDir "server\.env"
$backupScript = Join-Path $PSScriptRoot "backup\mysql-backup.ps1"
$rotateScript = Join-Path $PSScriptRoot "logs\rotate-logs.ps1"

function Read-DotEnv([string]$Path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $index = $line.IndexOf("=")
        if ($index -lt 1) { return }
        $key = $line.Substring(0, $index).Trim()
        $value = $line.Substring($index + 1).Trim().Trim('"').Trim("'")
        $map[$key] = $value
    }
    return $map
}

$envMap = Read-DotEnv $envFile
$logRoot = $envMap["LOG_DIR"]
if (-not $logRoot) { $logRoot = "logs" }
if (-not [System.IO.Path]::IsPathRooted($logRoot)) { $logRoot = Join-Path $AppDir "server\$logRoot" }
$logDir = Join-Path $logRoot "ops\scheduler"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
$stateFile = Join-Path $logRoot "ops\scheduler-state.json"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($logFile, $line + "`r`n", $utf8)
    Write-Host $line
}

function Read-State {
    if (-not (Test-Path -LiteralPath $stateFile)) { return @{} }
    try {
        $object = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $map = @{}
        $object.PSObject.Properties | ForEach-Object { $map[$_.Name] = $_.Value }
        return $map
    } catch { return @{} }
}

function Save-State($State) {
    $State | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

function Get-Hours($Map, [string]$Key, [double]$Default) {
    $value = $Map[$Key]
    if ($value -match '^\d+(\.\d+)?$') { return [double]$value }
    return $Default
}

function Test-Due($LastText, [double]$Hours) {
    if (-not $LastText) { return $true }
    try { $last = [datetime]$LastText } catch { return $true }
    return ((Get-Date) - $last).TotalHours -ge [Math]::Max(1, $Hours)
}

function Invoke-Child([string]$Script, [string[]]$ExtraArgs) {
    $childArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$Script`"") + $ExtraArgs
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $childArgs -Wait -PassThru -WindowStyle Hidden
    return $process.ExitCode
}

Write-Log "运维调度器启动（检查间隔 ${IntervalSeconds}s）"

while ($true) {
    try {
        $envMap = Read-DotEnv $envFile
        $state = Read-State

        $backupEnabled = $envMap["BACKUP_ENABLED"]
        if (-not $backupEnabled) { $backupEnabled = "true" }
        $backupHours = Get-Hours $envMap "BACKUP_INTERVAL_HOURS" 24
        if ($backupEnabled -ne "false" -and (Test-Due $state["lastBackupAt"] $backupHours)) {
            Write-Log "开始执行数据库备份（周期 ${backupHours}h）"
            $code = Invoke-Child $backupScript @("-AppDir", "`"$AppDir`"")
            if ($code -eq 0) { Write-Log "数据库备份完成" } else { Write-Log "数据库备份失败，退出码 $code" }
            $state["lastBackupAt"] = (Get-Date).ToString("o")
            Save-State $state
        }

        $rotateEnabled = $envMap["LOG_ROTATE_ENABLED"]
        if (-not $rotateEnabled) { $rotateEnabled = "true" }
        $rotateHours = Get-Hours $envMap "LOG_ROTATE_INTERVAL_HOURS" 24
        $nginxLogDir = $envMap["NGINX_LOG_DIR"]
        if ($rotateEnabled -ne "false" -and $nginxLogDir -and (Test-Due $state["lastRotateAt"] $rotateHours)) {
            Write-Log "开始轮转 Nginx 日志（周期 ${rotateHours}h）"
            $extra = @("-NginxLogDir", "`"$nginxLogDir`"")
            $nginxExe = $envMap["NGINX_EXE"]
            if ($nginxExe) { $extra += @("-NginxExe", "`"$nginxExe`"") }
            $code = Invoke-Child $rotateScript $extra
            if ($code -eq 0) { Write-Log "Nginx 日志轮转完成" } else { Write-Log "Nginx 日志轮转失败，退出码 $code" }
            $state["lastRotateAt"] = (Get-Date).ToString("o")
            Save-State $state
        }
    } catch {
        Write-Log "调度周期异常：$($_.Exception.Message)"
    }

    if ($Once) { break }
    Start-Sleep -Seconds ([Math]::Max(15, $IntervalSeconds))
}
