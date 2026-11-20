# Gera firmware/pievi_esp32/secrets.h para o broker LOCAL da bancada, sem imprimir segredos.
#   - Broker, usuario, senha e client ID do ESP: .env.physical (criado por npm.cmd run setup:physical)
#   - Wi-Fi: rede atual do notebook (perfil do Windows). Use -Ssid para outra rede ja salva no Windows.
# Uso (raiz do repositorio):  powershell -ExecutionPolicy Bypass -File firmware\tools\gerar-secrets.ps1
param([string]$Ssid = '')
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $root '.env.physical'
$out = Join-Path $root 'firmware\pievi_esp32\secrets.h'
if (-not (Test-Path $envFile)) { throw '.env.physical ausente: rode npm.cmd run setup:physical' }

$cfg = @{}
foreach ($line in Get-Content $envFile -Encoding UTF8) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}
foreach ($k in 'LAN_IP','MQTT_PORT','DEVICE_ID','MQTT_ESP_USERNAME','MQTT_ESP_CLIENT_ID','MQTT_ESP_PASSWORD') {
  if (-not $cfg[$k]) { throw "Preencha $k em .env.physical" }
}
if ($cfg['MQTT_BROKER_MODE'] -and $cfg['MQTT_BROKER_MODE'] -ne 'local') { throw 'Este gerador e para MQTT_BROKER_MODE=local. Para EMQX, edite secrets.h a partir de secrets.example.h.' }

# Wi-Fi atual (ou -Ssid) e senha do perfil salvo no Windows
$iface = netsh wlan show interfaces
if (-not $Ssid) { $m = $iface | Select-String -Pattern '^\s*SSID\s*:\s*(.+)$' | Select-Object -First 1; if (-not $m) { throw 'Notebook sem Wi-Fi conectado; informe -Ssid' }; $Ssid = $m.Matches[0].Groups[1].Value.Trim() }
$profileLine = $iface | Select-String -Pattern '^\s*(Perfil|Profile)\s*:\s*(.+)$' | Select-Object -First 1
$profileName = if ($profileLine -and -not $PSBoundParameters.ContainsKey('Ssid')) { $profileLine.Matches[0].Groups[2].Value.Trim() } else { $Ssid }
$prof = netsh wlan show profile name="$profileName" key=clear
$keyLine = $prof | Select-String -Pattern '^\s*(Conte.do da Chave|Key Content)\s*:\s*(.+)$' | Select-Object -First 1
if (-not $keyLine) { throw "Senha do Wi-Fi '$Ssid' nao encontrada no perfil do Windows (rode como o usuario que conectou a rede)" }
$wifiPass = $keyLine.Matches[0].Groups[2].Value.Trim()

function CStr([string]$s) { '"' + ($s -replace '\\','\\' -replace '"','\"') + '"' }
$uri = "mqtt://$($cfg['LAN_IP']):$($cfg['MQTT_PORT'])"
$content = @"
// GERADO por firmware/tools/gerar-secrets.ps1 - NAO versionar, NAO compartilhar.
#pragma once
#define WIFI_SSID        $(CStr $Ssid)
#define WIFI_PASSWORD    $(CStr $wifiPass)
#define DEVICE_ID        $(CStr $cfg['DEVICE_ID'])
#define MQTT_CLIENT_ID   $(CStr $cfg['MQTT_ESP_CLIENT_ID'])
#define MQTT_USERNAME    $(CStr $cfg['MQTT_ESP_USERNAME'])
#define MQTT_PASSWORD    $(CStr $cfg['MQTT_ESP_PASSWORD'])
#define MQTT_URI         $(CStr $uri)
"@
[IO.File]::WriteAllText($out, $content, (New-Object Text.UTF8Encoding $false))
Write-Host "secrets.h gerado: Wi-Fi '$Ssid', broker $uri, usuario $($cfg['MQTT_ESP_USERNAME']), client ID $($cfg['MQTT_ESP_CLIENT_ID']). Senhas nao exibidas."
