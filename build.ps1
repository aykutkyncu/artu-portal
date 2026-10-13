# Artu Portal - dağıtım paketi üretir.
# Kullanım (geliştirme bilgisayarında):  powershell -ExecutionPolicy Bypass -File .\build.ps1
# Çıktı: .\dist\artu-portal\  (sunucuya kopyalanacak klasör)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path $root 'dist\artu-portal'

Write-Host '1/3 Web arayüzü derleniyor...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'web')
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci başarısız' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'web derlemesi başarısız' }
} finally { Pop-Location }

Write-Host '2/3 Sunucu derleniyor (Windows x64)...' -ForegroundColor Cyan
Push-Location (Join-Path $root 'server')
try {
    $env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    go build -trimpath -ldflags '-s -w' -o artu-portal.exe .
    if ($LASTEXITCODE -ne 0) { throw 'go build başarısız' }
} finally { Pop-Location }

Write-Host '3/3 Paket hazırlanıyor...' -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item -Recurse -Force $out -Confirm:$false }
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $root 'server\artu-portal.exe') $out
Copy-Item -Recurse (Join-Path $root 'server\pb_public') $out
Copy-Item (Join-Path $root 'KURULUM.md') $out

Write-Host "Tamam: $out" -ForegroundColor Green
Write-Host 'Bu klasörü sunucuya kopyalayın. pb_data klasörünün ÜZERİNE YAZMAYIN (veritabanı oradadır).'
