# MySQL + 上传文件 + 运行时密钥备份（Windows PowerShell）
#
# 备份开关、目录、保留天数从 server\.env 读取：
#   BACKUP_ENABLED=true|false
#   BACKUP_DIR=D:\yunqi-backups
#   BACKUP_RETENTION_DAYS=14
#   MYSQLDUMP_BIN=C:\Program Files\MySQL\MySQL Server 9.7\bin\mysqldump.exe
# 日志写入 LOG_DIR\ops\backup\YYYY-MM-DD.log。

param(
    [string]$AppDir = "",
    [string]$BackupDir = "",
    [int]$RetentionDays = 0,
    [string]$MySqlDump = ""
)

$ErrorActionPreference = "Stop"
if (-not $AppDir) {
    $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
}
$envFile = Join-Path $AppDir "server\.env"
$serverDir = Join-Path $AppDir "server"

function Read-DotEnv([string]$Path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    # .env 为 UTF-8；Windows PowerShell 5.1 默认按 ANSI 读取会把中文注释和下一行合并
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
$logDir = Join-Path $logRoot "ops\backup"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($logFile, $line + "`r`n", $utf8)
    Write-Host $line
}

$backupEnabled = $envMap["BACKUP_ENABLED"]
if (-not $backupEnabled) { $backupEnabled = "true" }
if ($backupEnabled -eq "false") {
    Write-Log "备份已关闭（BACKUP_ENABLED=false）"
    exit 0
}

if (-not $BackupDir) { $BackupDir = $envMap["BACKUP_DIR"] }
if (-not $BackupDir) { $BackupDir = "C:\yunqi-backups" }
if ($RetentionDays -le 0) {
    $envRetention = $envMap["BACKUP_RETENTION_DAYS"]
    if ($envRetention -match '^\d+$') { $RetentionDays = [int]$envRetention }
}
if ($RetentionDays -le 0) { $RetentionDays = 14 }
if (-not $MySqlDump) { $MySqlDump = $envMap["MYSQLDUMP_BIN"] }
if (-not $MySqlDump) { $MySqlDump = "mysqldump.exe" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

$dbHost = $envMap["MYSQL_HOST"]
$dbPort = $envMap["MYSQL_PORT"]
$dbUser = $envMap["MYSQL_USER"]
$dbPassword = $envMap["MYSQL_PASSWORD"]
$dbName = $envMap["MYSQL_DATABASE"]
if (-not $dbHost) { $dbHost = "127.0.0.1" }
if (-not $dbPort) { $dbPort = "3306" }
if (-not $dbUser -or -not $dbName) {
    Write-Log "ERROR server\.env 缺少 MYSQL_USER / MYSQL_DATABASE"
    exit 1
}

$dumpExe = (Get-Command $MySqlDump -ErrorAction SilentlyContinue).Source
if (-not $dumpExe) {
    Write-Log "ERROR 找不到 mysqldump：$MySqlDump"
    exit 1
}

$tempDefaults = [System.IO.Path]::GetTempFileName()
try {
    $defaults = @(
        "[client]",
        "host=$dbHost",
        "port=$dbPort",
        "user=$dbUser",
        "password=$dbPassword",
        "default-character-set=utf8mb4"
    ) -join "`r`n"
    Set-Content -LiteralPath $tempDefaults -Value $defaults -Encoding ASCII

    $sqlFile = Join-Path $BackupDir "yunqi_$stamp.sql"
    $gzFile = "$sqlFile.gz"
    Write-Log "开始备份数据库 $dbName@$dbHost`:$dbPort"
    & $dumpExe "--defaults-extra-file=$tempDefaults" `
        --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF `
        --databases $dbName "--result-file=$sqlFile"
    if ($LASTEXITCODE -ne 0) { throw "mysqldump 退出码 $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath $sqlFile) -or (Get-Item -LiteralPath $sqlFile).Length -le 0) {
        throw "mysqldump 未生成有效文件"
    }

    $input = [System.IO.File]::OpenRead($sqlFile)
    try {
        $output = [System.IO.File]::Create($gzFile)
        try {
            $gzip = New-Object System.IO.Compression.GZipStream($output, [System.IO.Compression.CompressionMode]::Compress)
            try { $input.CopyTo($gzip) } finally { $gzip.Dispose() }
        } finally { $output.Dispose() }
    } finally { $input.Dispose() }
    Remove-Item -LiteralPath $sqlFile -Force
    Write-Log ("数据库备份完成：{0}（{1:N1} MB）" -f $gzFile, ((Get-Item -LiteralPath $gzFile).Length / 1MB))
} catch {
    Write-Log "ERROR 数据库备份失败：$($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item -LiteralPath $tempDefaults -Force -ErrorAction SilentlyContinue
}

foreach ($name in @("uploads", ".runtime")) {
    $source = Join-Path $serverDir $name
    if (Test-Path -LiteralPath $source) {
        $safeName = $name -replace '\.', ''
        $archive = Join-Path $BackupDir "yunqi_${safeName}_$stamp.zip"
        Compress-Archive -Path $source -DestinationPath $archive -CompressionLevel Optimal -Force
        Write-Log ("已备份 {0}：{1}（{2:N1} MB）" -f $name, $archive, ((Get-Item -LiteralPath $archive).Length / 1MB))
    }
}

Write-Log "清理 $RetentionDays 天前的备份"
Get-ChildItem -LiteralPath $BackupDir -Filter "yunqi_*" -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Log "已删除旧备份：$($_.FullName)"
    }

Write-Log "备份完成"
