# Nginx / 服务端日志轮转（Windows PowerShell）
#
# 用法示例（每天或每周由任务计划程序调用）：
#   powershell -ExecutionPolicy Bypass -File .\rotate-logs.ps1 `
#     -NginxLogDir "C:\nginx-1.30.6\logs" -ServerLogDir "C:\yunqi\logs" `
#     -NginxExe "C:\nginx-1.30.6\nginx.exe" -RetentionDays 14
#
# 做法：把当前日志复制为带日期的归档，再清空原文件（等价 copytruncate），
# 最后执行 nginx -s reopen 让 nginx 重新打开日志，避免占用旧句柄。

param(
    [string]$NginxLogDir = "C:\nginx-1.30.6\logs",
    [string]$ServerLogDir = "",
    [string]$NginxExe = "",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Rotate-Directory([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    Get-ChildItem -LiteralPath $Directory -Filter "*.log" -File |
        Where-Object { $_.Name -notmatch '\.\d{8}_\d{6}\.log$' } |
        ForEach-Object {
        if ($_.Length -le 0) { return }
        $archive = Join-Path $Directory ("{0}.{1}.log" -f $_.BaseName, $stamp)
        try {
            Copy-Item -LiteralPath $_.FullName -Destination $archive -Force
            Clear-Content -LiteralPath $_.FullName -Force
            Write-Host "已轮转：$($_.FullName) -> $archive"
        } catch {
            Write-Warning "轮转失败：$($_.FullName)：$($_.Exception.Message)"
        }
    }
}

$directories = @($NginxLogDir, $ServerLogDir) | Where-Object { $_ } | Select-Object -Unique
foreach ($directory in $directories) { Rotate-Directory $directory }

if ($NginxExe -and (Test-Path -LiteralPath $NginxExe)) {
    try {
        & $NginxExe -s reopen
        Write-Host "已通知 nginx 重新打开日志"
    } catch {
        Write-Warning "nginx -s reopen 失败：$($_.Exception.Message)"
    }
}

foreach ($directory in $directories) {
    if (-not (Test-Path -LiteralPath $directory)) { continue }
    Get-ChildItem -LiteralPath $directory -Filter "*.log" -File |
        Where-Object { $_.Name -match '\.\d{8}_\d{6}\.log$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
            Write-Host "已删除过期日志：$($_.FullName)"
        }
}
