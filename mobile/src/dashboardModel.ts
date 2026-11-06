import type { PumpId, Snapshot } from '../../api/src/contracts';

export function hasRecentState(snapshot: Snapshot, connected: boolean, clock: number) {
  const age = clock - Date.parse(snapshot.lastSeenAt);
  return connected && snapshot.online && snapshot.simulationScenario !== 'stale' && Number.isFinite(age) && age >= -5000 && age <= 45_000;
}

export function pumpControlBlock(snapshot: Snapshot, id: PumpId, connected: boolean, clock: number) {
  if (!hasRecentState(snapshot, connected, clock)) return 'Sem estado recente. Aguarde a reconexão antes de enviar comandos.';
  if (snapshot.telemetry.waterLevel === 'LOW') return 'Nível baixo: as duas bombas estão bloqueadas.';
  if (id === 'B2') {
    if (!snapshot.telemetry.dhtReliable) return 'DHT22 sem leitura confiável; aguarde 3 leituras válidas.';
    const emergency = (snapshot.telemetry.airTemperatureC ?? 0) >= snapshot.config.emergencyTemperatureC;
    if ((snapshot.telemetry.airHumidityPercent ?? 100) >= (emergency ? 95 : snapshot.config.fogHumidityBlockPercent)) return 'Umidade do ar bloqueia B2.';
  }
  return null;
}

export function dashboardStatus(snapshot: Snapshot, connected: boolean, clock: number) {
  const t = snapshot.telemetry;
  if (!hasRecentState(snapshot, connected, clock)) return { warning: true, text: 'Sem dados recentes · exibindo o último estado conhecido' };
  if (t.waterLevel === 'LOW') return { warning: true, text: 'Nível baixo · bombas bloqueadas' };
  const important = snapshot.activeAlerts.find(a => a.severity === 'critical') ?? snapshot.activeAlerts.find(a => a.severity === 'warning');
  if (important) return { warning: true, text: important.title };
  if (!t.soilReliable || t.soilMoisturePercent === null) return { warning: true, text: 'Umidade do substrato sem leitura confiável' };
  if (t.soilMoisturePercent < snapshot.config.soilMinPercent) return { warning: true, text: snapshot.pumps.B1.isOn ? 'Solo seco · irrigação automática em andamento' : 'Solo abaixo do mínimo · acompanhe a irrigação' };
  if (t.soilMoisturePercent > snapshot.config.soilMaxPercent) return { warning: true, text: 'Solo acima da faixa · irrigação automática em espera' };
  return { warning: false, text: 'Sensores disponíveis · umidade do solo dentro da faixa' };
}

export function readingAge(timestamp: string, clock: number) {
  const seconds = Math.max(0, Math.floor((clock - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(seconds)) return 'Horário indisponível';
  return seconds < 60 ? `há ${seconds} s` : seconds < 3600 ? `há ${Math.floor(seconds / 60)} min` : `há ${Math.floor(seconds / 3600)} h`;
}
