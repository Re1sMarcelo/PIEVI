import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { PumpId, Snapshot } from '../../../api/src/contracts';
import { Icon, type IconName } from './Icon';
import type { Tab } from './Navigation';
import { cardShadow, colors } from './theme';

interface Props {
  snapshot: Snapshot;
  connected: boolean;
  clock: number;
  onNavigate: (tab: Tab) => void;
}

const formatReading = (value: number | null, unit: string) => value === null ? 'Sem leitura' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`;

function ReadingCard({ icon, label, value, detail, warning, badge, smallValue, onPress }: {
  icon: IconName; label: string; value: string; detail?: string; warning?: boolean;
  badge?: string; smallValue?: boolean; onPress: () => void;
}) {
  const color = warning ? '#c92230' : colors.greenDark;
  const compact = useWindowDimensions().width < 360;
  const fontSize = smallValue || value === 'Sem leitura'
    ? (compact ? 16 : 20)
    : (compact ? (value.length > 6 ? 21 : 28) : 34);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}${badge ? `, ${badge}` : ''}`} style={({ pressed }) => [styles.reading, pressed && { opacity: 0.8 }]}>
      <LinearGradient colors={warning ? ['#fff2f3', '#fff0f2'] : ['#edf5ec', '#edf5eb']} style={styles.readingFill}>
        <Icon name={icon} size={32} color={color} />
        <Text style={styles.readingLabel}>{label}</Text>
        <View style={styles.valueRow}>
          <Text style={[styles.value, smallValue && styles.smallValue, { fontSize }, warning && { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>{value}</Text>
          <Icon name="chevron" size={15} color={warning ? '#c92230' : colors.ink} />
        </View>
        {badge && <View style={[styles.badge, { backgroundColor: warning ? '#ffdade' : '#d9eddb' }]}><Icon name={warning ? 'warning' : 'check'} size={13} color={color} /><Text style={[styles.badgeText, { color }]}>{badge}</Text></View>}
        {detail && <Text style={styles.detail}>{detail}</Text>}
      </LinearGradient>
    </Pressable>
  );
}

function EquipmentCard({ id, snapshot, clock, onPress }: { id: PumpId; snapshot: Snapshot; clock: number; onPress: () => void }) {
  const pump = snapshot.pumps[id];
  const remainingSeconds = pump.expiresAt ? Math.max(0, Math.ceil((Date.parse(pump.expiresAt) - clock) / 1000)) : null;
  const remaining = remainingSeconds === null ? null : `${Math.floor(remainingSeconds / 60)}m ${String(remainingSeconds % 60).padStart(2, '0')}s`;
  const name = id === 'B1' ? 'Irrigação' : 'Aspersão';
  return (
    <Pressable style={({ pressed }) => [styles.equipment, pressed && { opacity: 0.78 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, ${pump.isOn ? 'ligada' : 'desligada'}${remaining ? `, expira em ${remaining}` : ''}`} accessibilityHint="Abre os controles temporizados do equipamento">
      <View style={styles.equipmentRow}>
        <Icon name={id === 'B1' ? 'plant' : 'sprinkler'} size={38} />
        <View style={styles.equipmentDetails}>
          <Text style={styles.equipmentTitle}>{name}</Text>
          <View style={[styles.indicatorTrack, pump.isOn && { backgroundColor: colors.green }]}><View style={[styles.indicatorThumb, pump.isOn && { alignSelf: 'flex-end' }]} /></View>
        </View>
      </View>
      <View style={styles.equipmentChevron}><Icon name="chevron" size={14} color={colors.ink} /></View>
      <View style={[styles.equipmentState, pump.isOn && { backgroundColor: '#e1f1e2' }]}><Text style={[styles.stateText, pump.isOn && { color: colors.greenDark }]}>{pump.isOn ? 'Ligada' : 'Desligada'}</Text></View>
      {remaining && <Text style={styles.countdown}>Expira em {remaining}</Text>}
    </Pressable>
  );
}

export function Dashboard({ snapshot, connected, clock, onNavigate }: Props) {
  const { telemetry, config, pumps } = snapshot;
  const lowWater = telemetry.waterLevel === 'LOW';
  const soil = telemetry.soilMoisturePercent;
  const allAuto = pumps.B1.mode === 'AUTO' && pumps.B2.mode === 'AUTO';
  const allManual = pumps.B1.mode !== 'AUTO' && pumps.B2.mode !== 'AUTO';
  const operation = allAuto ? 'Automático' : allManual ? 'Manual' : 'Misto';

  let statusText = 'Umidade dentro da faixa configurada';
  let statusIcon: IconName = 'check';
  let statusWarning = false;
  if (!connected || !snapshot.online) {
    statusText = 'Sem conexão · exibindo a última leitura'; statusIcon = 'info'; statusWarning = true;
  } else if (lowWater) {
    statusText = 'Nível baixo · bombas bloqueadas'; statusIcon = 'warning'; statusWarning = true;
  } else if (soil === null) {
    statusText = 'Umidade do substrato sem leitura'; statusIcon = 'warning'; statusWarning = true;
  } else if (soil < config.soilMinPercent || soil > config.soilMaxPercent) {
    statusText = soil < config.soilMinPercent ? 'Umidade abaixo da faixa configurada' : 'Umidade acima da faixa configurada'; statusIcon = 'info'; statusWarning = true;
  }

  return (
    <View style={styles.dashboard}>
      <View style={styles.row}>
        <ReadingCard icon="temperature" label="Temperatura do ar" value={formatReading(telemetry.dhtReliable ? telemetry.airTemperatureC : null, ' °C')} onPress={() => onNavigate('Histórico')} />
        <ReadingCard icon="drop" label="Umidade do substrato" value={formatReading(soil, '%')} onPress={() => onNavigate('Histórico')} />
      </View>
      <View style={styles.row}>
        <ReadingCard icon="reservoir" label="Reservatório" value={lowWater ? 'Baixo' : 'Adequado'} warning={lowWater} badge={lowWater ? 'Nível baixo' : 'Nível OK'} smallValue onPress={() => onNavigate('Alertas')} />
        <ReadingCard icon="settings" label="Modo de operação" value={operation} detail={allAuto ? 'B1 e B2 em AUTO' : 'Ver controles de B1 e B2'} smallValue onPress={() => onNavigate('Controle')} />
      </View>

      <View style={styles.secondaryReadings}>
        <View style={styles.secondaryItem}><Text style={styles.secondaryLabel}>Umidade do ar</Text><Text style={styles.secondaryValue}>{formatReading(telemetry.dhtReliable ? telemetry.airHumidityPercent : null, '%')}</Text></View>
        <View style={styles.secondaryDivider} />
        <View style={styles.secondaryItem}><Text style={styles.secondaryLabel}>Temp. do substrato</Text><Text style={styles.secondaryValue}>{formatReading(telemetry.substrateTemperatureC, ' °C')}</Text></View>
      </View>

      <Text style={styles.sectionTitle} accessibilityRole="header">Equipamentos</Text>
      <View style={styles.row}>
        <EquipmentCard id="B1" snapshot={snapshot} clock={clock} onPress={() => onNavigate('Controle')} />
        <EquipmentCard id="B2" snapshot={snapshot} clock={clock} onPress={() => onNavigate('Controle')} />
      </View>

      <Pressable style={({ pressed }) => [styles.statusBanner, { backgroundColor: statusWarning ? '#fff0f1' : '#e9f3e7' }, pressed && { opacity: 0.8 }]} onPress={() => onNavigate(statusWarning ? 'Alertas' : 'Controle')} accessibilityRole="button">
        <View style={[styles.statusCircle, { backgroundColor: statusWarning ? '#ca273a' : '#2a8b44' }]}><Icon name={statusIcon} color="white" size={24} /></View>
        <Text style={[styles.statusMessage, statusWarning && { color: '#a51f30' }]}>{statusText}</Text>
      </Pressable>

      {snapshot.activeAlerts.length > 0 && <Pressable style={styles.alertLink} onPress={() => onNavigate('Alertas')} accessibilityRole="button"><Icon name="bell" size={17} color={colors.red} /><Text style={styles.alertLinkText}>{snapshot.activeAlerts.length} {snapshot.activeAlerts.length === 1 ? 'alerta ativo' : 'alertas ativos'}</Text><Icon name="chevron" size={14} color={colors.red} /></Pressable>}

      <Pressable onPress={() => onNavigate('Histórico')} accessibilityRole="button" accessibilityLabel="Ver histórico" style={({ pressed }) => [styles.historyButton, pressed && { opacity: 0.8 }]}>
        <LinearGradient colors={['#318f49', '#258342']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.historyFill}>
          <View style={styles.historyLabel}><Icon name="chart" size={25} color="white" /><Text style={styles.historyText}>Ver histórico</Text></View>
          <Icon name="chevron" size={19} color="white" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dashboard: { gap: 13 },
  row: { flexDirection: 'row', gap: 12 },
  reading: { flex: 1, minWidth: 0, borderRadius: 15, ...cardShadow },
  readingFill: { flex: 1, borderRadius: 15, padding: 16, minHeight: 151 },
  readingLabel: { color: colors.ink, fontSize: 13, lineHeight: 18, marginTop: 10, minHeight: 19 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
  value: { color: colors.ink, fontSize: 34, fontWeight: '800', letterSpacing: -1.3, flex: 1 },
  smallValue: { fontSize: 24, letterSpacing: -0.8, lineHeight: 32 },
  detail: { color: '#587164', fontSize: 10, marginTop: 5 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 7 },
  badgeText: { fontSize: 10, fontWeight: '600' },
  secondaryReadings: { flexDirection: 'row', paddingVertical: 9, gap: 14, paddingHorizontal: 2 },
  secondaryItem: { flex: 1, gap: 3 },
  secondaryLabel: { color: colors.muted, fontSize: 11 },
  secondaryValue: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  secondaryDivider: { width: 1, backgroundColor: colors.line },
  sectionTitle: { color: colors.ink, fontSize: 23, fontWeight: '700', letterSpacing: -0.6, marginTop: 2, marginBottom: 0 },
  equipment: { flex: 1, minWidth: 0, backgroundColor: '#fffefd', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 18, ...cardShadow },
  equipmentRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  equipmentChevron: { position: 'absolute', right: 12, top: 56 },
  equipmentDetails: { flex: 1, minWidth: 0 },
  equipmentTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 9 },
  indicatorTrack: { width: 46, height: 25, borderRadius: 14, backgroundColor: '#cbcbcb', padding: 2 },
  indicatorThumb: { width: 21, height: 21, borderRadius: 11, backgroundColor: 'white' },
  equipmentState: { backgroundColor: '#f0eeed', borderRadius: 18, alignSelf: 'center', paddingVertical: 5, paddingHorizontal: 10, marginTop: 12 },
  stateText: { color: '#676969', fontSize: 11, fontWeight: '500' },
  countdown: { color: '#647869', textAlign: 'center', fontSize: 10, marginTop: 7 },
  statusBanner: { borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 1 },
  statusCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  statusMessage: { flex: 1, fontSize: 13, color: colors.ink, fontWeight: '600', lineHeight: 19 },
  alertLink: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 38 },
  alertLinkText: { fontSize: 12, color: colors.red, fontWeight: '600' },
  historyButton: { borderRadius: 12, overflow: 'hidden', marginTop: 0 },
  historyFill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 20 },
  historyLabel: { flex: 1, flexDirection: 'row', gap: 13, justifyContent: 'center', alignItems: 'center' },
  historyText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
