# Frontend Launcher (Windows PowerShell)
# 脚本与 frontend 目录相对位置固定：仓库根/start_frontend.ps1 → 仓库根/frontend
Write-Host "Starting Frontend..." -ForegroundColor Cyan

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $ScriptRoot "frontend"
if (-not (Test-Path $FrontendDir)) {
    Write-Host "未找到 frontend 目录: $FrontendDir" -ForegroundColor Red
    exit 1
}

# Kill existing Vite processes on ports
$ports = @(5173, 5174, 5175)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Port $port cleared" -ForegroundColor Gray
    }
}

Start-Sleep -Seconds 1

Set-Location $FrontendDir
Write-Host "目录: $FrontendDir" -ForegroundColor Gray
npm run dev
