$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDirectory = Join-Path $projectRoot 'output\entrega'
$stageDirectory = Join-Path $projectRoot ('tmp\delivery-' + [guid]::NewGuid().ToString('N'))
$packageName = 'PIEVI-integrado-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$packageRoot = Join-Path $stageDirectory $packageName
New-Item -ItemType Directory -Path $outputDirectory, $packageRoot -Force | Out-Null

# git lists current source files, including untracked implementation work.
$sourceFiles = & git -C $projectRoot ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível listar os arquivos do projeto.' }
$included = @()
foreach ($relativePath in $sourceFiles) {
    if ($relativePath -notmatch '^(api/|mobile/|db/|docs/|protocol/|infra/|scripts/|README\.md$|GUIA-ANDROID-EXPO-GO\.md$|GUIA-TESTE-ESP-FISICO\.md$|GLOSSARY\.md$|package(-lock)?\.json$|compose\.yaml$|Dockerfile$|\.dockerignore$|\.gitignore$)') { continue }
    if ($relativePath -match '(^|/)(node_modules|dist|\.expo|\.git|android|ios)(/|$)') { continue }
    $leafName = [System.IO.Path]::GetFileName($relativePath)
    if ($leafName -like '.env*' -and $leafName -ne '.env.example') { continue }
    if ($leafName -match '\.(log|zip|pem|key|p12|pfx|jks|keystore)$|^credentials\.json$|^google-services\.json$|^GoogleService-Info\.plist$') { continue }
    $source = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $destination = Join-Path $packageRoot $relativePath
    New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
    $included += $relativePath
}
$requiredFiles = @('compose.yaml', 'Dockerfile', '.dockerignore', 'package-lock.json', 'api/scripts/setup-compose.mjs', 'docs/ambiente-integrado.md', 'GUIA-TESTE-ESP-FISICO.md', 'api/scripts/setup-physical.mjs', 'docs/checklist-esp-fisico.md')
foreach ($required in $requiredFiles) {
    if ($required -notin $included) { throw "Arquivo obrigatório ausente: $required" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = Join-Path $outputDirectory ($packageName + '.zip')
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageDirectory, $archivePath)
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($archivePath + '.sha256') -Value ($hash + '  ' + [System.IO.Path]::GetFileName($archivePath)) -Encoding ASCII
Write-Output "Pacote criado: $archivePath"
Write-Output "Arquivos: $($included.Count). SHA-256: $hash"
