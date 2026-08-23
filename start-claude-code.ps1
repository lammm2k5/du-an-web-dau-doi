# ============================================================
# start-claude-code.ps1
# Tu dong: (1) tai ban moi nhat cua claude-code-controller.html
#              tu GitHub ve thu muc local (ghi de ban cu)
#          (2) khoi dong fcc-server neu chua chay
#          (3) khoi dong 1 server tinh loopback de mo
#              claude-code-controller.html (de CORS cua
#              fcc-server chap nhan request)
#          (4) mo trinh duyet san sang de ban go lenh
# ============================================================

# ---- SUA CAC DONG DUOI CHO DUNG VOI REPO CUA BAN ----
$controllerFolder = "F:\claude-code-controller"
$githubRawUrl      = "https://raw.githubusercontent.com/lammm2k5/test-y-hoc-tbump/main/claude-code-controller.html"
$controllerFile    = "claude-code-controller.html"

$fccPort       = 8082
$staticPort    = 5500
$fccProjectDir = "F:\free-claude-code-main\free-claude-code-main"

function Test-PortOpen {
    param([int]$Port)
    $t = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
    return $t.TcpTestSucceeded
}

# --- 0. Tai ban moi nhat cua trang controller tu GitHub ---
if (-not (Test-Path $controllerFolder)) {
    New-Item -ItemType Directory -Path $controllerFolder -Force | Out-Null
}
$destPath = Join-Path $controllerFolder $controllerFile
try {
    Write-Host "Dang tai ban moi nhat tu GitHub..."
    Invoke-WebRequest -Uri $githubRawUrl -OutFile $destPath -UseBasicParsing -TimeoutSec 15
    Write-Host "Da cap nhat file local tu GitHub."
} catch {
    if (Test-Path $destPath) {
        Write-Warning "Khong tai duoc ban moi tu GitHub (co the do mang). Dung tam ban local cu da co san."
    } else {
        Write-Error "Khong tai duoc file tu GitHub va cung khong co ban local nao. Kiem tra lai duong dan `$githubRawUrl hoac ket noi mang."
        exit 1
    }
}

# --- 1. Khoi dong fcc-server neu cong 8082 chua mo ---
if (-not (Test-PortOpen -Port $fccPort)) {
    Write-Host "Dang khoi dong fcc-server..."
    if (-not (Test-Path $fccProjectDir)) {
        Write-Error "Khong tim thay thu muc fcc-server tai '$fccProjectDir'. Kiem tra lai duong dan trong bien `$fccProjectDir."
        exit 1
    }
    Start-Process -FilePath "uv" -ArgumentList "run", "fcc-server" -WorkingDirectory $fccProjectDir -WindowStyle Hidden
    $tries = 0
    while (-not (Test-PortOpen -Port $fccPort) -and $tries -lt 15) {
        Start-Sleep -Seconds 1
        $tries++
    }
    if (Test-PortOpen -Port $fccPort) {
        Write-Host "fcc-server da san sang o cong $fccPort."
    } else {
        Write-Warning "fcc-server chua phan hoi sau 15 giay. Kiem tra lai cai dat (lenh 'fcc-server' co chay duoc truc tiep trong PowerShell khong?)."
    }
} else {
    Write-Host "fcc-server da chay san o cong $fccPort."
}

# --- 2. Khoi dong server tinh loopback cho trang controller ---
if (-not (Test-PortOpen -Port $staticPort)) {
    Write-Host "Dang khoi dong server tinh o cong $staticPort..."

    $serverScript = @'
param([string]$Root, [int]$Port)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.LocalPath.TrimStart("/")
    if ([string]::IsNullOrEmpty($path)) { $path = "claude-code-controller.html" }
    $filePath = Join-Path $Root $path
    if (Test-Path $filePath -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $mime = switch ($ext) {
            ".html" { "text/html; charset=utf-8" }
            ".js"   { "application/javascript" }
            ".css"  { "text/css" }
            ".png"  { "image/png" }
            ".json" { "application/json" }
            default { "application/octet-stream" }
        }
        $context.Response.ContentType = $mime
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $context.Response.StatusCode = 404
    }
    $context.Response.Close()
}
'@

    $tempScript = Join-Path $env:TEMP "fcc-static-server.ps1"
    Set-Content -Path $tempScript -Value $serverScript -Encoding UTF8

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempScript`" -Root `"$controllerFolder`" -Port $staticPort" `
        -WindowStyle Hidden

    Start-Sleep -Seconds 2
} else {
    Write-Host "Server tinh da chay san o cong $staticPort."
}

# --- 3. Mo trinh duyet vao trang controller ---
Start-Process "http://127.0.0.1:$staticPort/$controllerFile"
