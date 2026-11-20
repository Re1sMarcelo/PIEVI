# Captura a serial do ESP32 (115200) em arquivo, sem reiniciar a placa (DTR/RTS desligados).
# Uso: powershell -ExecutionPolicy Bypass -File firmware\tools\capturar-serial.ps1 -Port COM12 -Seconds 120 [-Send "status"]
param([string]$Port = 'COM12', [int]$Seconds = 120, [string]$Out = '', [string[]]$Send = @())
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not $Out) { $Out = Join-Path $root 'tmp\physical-bench\serial.log' }
$sp = New-Object System.IO.Ports.SerialPort $Port, 115200, 'None', 8, 'One'
$sp.DtrEnable = $false; $sp.RtsEnable = $false; $sp.ReadTimeout = 500; $sp.NewLine = "`n"
$sp.Open()
$w = New-Object System.IO.StreamWriter($Out, $true, (New-Object Text.UTF8Encoding $false))
try {
  $end = (Get-Date).AddSeconds($Seconds); $sent = $false
  while ((Get-Date) -lt $end) {
    if (-not $sent -and $Send.Count) {
      Start-Sleep -Milliseconds 1000; $sp.DiscardInBuffer()   # a placa so aceita comandos ~1 s depois de abrir a porta
      foreach ($c in $Send) { $sp.Write("$c`r`n"); Start-Sleep -Milliseconds 600 }
      $sent = $true
    }
    try { $line = $sp.ReadLine(); $w.WriteLine($line.TrimEnd("`r")); $w.Flush() } catch [System.TimeoutException] { }
  }
} finally { $w.Close(); $sp.Close() }
Write-Host "Serial salva em $Out"
