# Gera firmware/pievi_esp32/secrets.h sem imprimir segredos.
#   - Padrao: broker LOCAL do notebook. Broker, usuario, senha e client ID do ESP vem de .env.physical.
#   - -Nuvem: broker EMQX Cloud com TLS. Vem de .env.cloud (EMQX_HOST, EMQX_PORT, MQTT_ESP_*). O certificado e
#     validado pelo pacote de certificados do ESP-IDF (core 3.3.x: cadeia conferida, data nao).
#   - Wi-Fi: rede atual do notebook (perfil do Windows). Use -Ssid para outra rede ja salva no Windows.
# Uso (raiz do repositorio):  powershell -ExecutionPolicy Bypass -File firmware\tools\gerar-secrets.ps1 [-Nuvem] [-Ssid REDE]
param([string]$Ssid = '', [switch]$Nuvem)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envName = if ($Nuvem) { '.env.cloud' } else { '.env.physical' }
$envFile = Join-Path $root $envName
$out = Join-Path $root 'firmware\pievi_esp32\secrets.h'
if (-not (Test-Path $envFile)) {
  if ($Nuvem) { throw '.env.cloud ausente: copie .env.cloud.example e preencha (GUIA-NUVEM.md)' }
  throw '.env.physical ausente: rode npm.cmd run setup:physical'
}

$cfg = @{}
foreach ($line in Get-Content $envFile -Encoding UTF8) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}
if ($Nuvem) {
  if (-not $cfg['DEVICE_ID']) { $cfg['DEVICE_ID'] = 'bancada-01' }
  if (-not $cfg['EMQX_PORT']) { $cfg['EMQX_PORT'] = '8883' }
  foreach ($k in 'EMQX_HOST','MQTT_ESP_USERNAME','MQTT_ESP_CLIENT_ID','MQTT_ESP_PASSWORD') {
    if (-not $cfg[$k]) { throw "Preencha $k em .env.cloud" }
  }
  $uri = "mqtts://$($cfg['EMQX_HOST']):$($cfg['EMQX_PORT'])"
} else {
  foreach ($k in 'LAN_IP','MQTT_PORT','DEVICE_ID','MQTT_ESP_USERNAME','MQTT_ESP_CLIENT_ID','MQTT_ESP_PASSWORD') {
    if (-not $cfg[$k]) { throw "Preencha $k em .env.physical" }
  }
  if ($cfg['MQTT_BROKER_MODE'] -and $cfg['MQTT_BROKER_MODE'] -ne 'local') { throw 'MQTT_BROKER_MODE externo: para o EMQX Cloud use -Nuvem (le .env.cloud).' }
  $uri = "mqtt://$($cfg['LAN_IP']):$($cfg['MQTT_PORT'])"
}

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
$content = @"
// GERADO por firmware/tools/gerar-secrets.ps1 ($envName) - NAO versionar, NAO compartilhar.
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
$shown = if ($Nuvem) { 'EMQX Cloud (mqtts, porta ' + $cfg['EMQX_PORT'] + ')' } else { $uri }
Write-Host "secrets.h gerado: Wi-Fi '$Ssid', broker $shown, usuario $($cfg['MQTT_ESP_USERNAME']), client ID $($cfg['MQTT_ESP_CLIENT_ID']). Senhas nao exibidas."
