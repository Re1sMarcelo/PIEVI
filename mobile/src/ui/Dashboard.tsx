import { useEffect, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';
import type { CommandAction, PumpId, Snapshot, Telemetry } from '../../../api/src/contracts';
import { dashboardStatus, hasRecentState, pumpControlBlock, readingAge } from '../dashboardModel';
import { Icon, type IconName } from './Icon';
import type { Tab } from './Navigation';
import { cardShadow, colors } from './theme';

interface Props {
  snapshot: Snapshot; connected: boolean; clock: number; telemetry: Telemetry[]; busy: boolean; feedback: string;
  onNavigate: (tab: Tab) => void;
  onCommand: (id: PumpId, action: CommandAction) => Promise<boolean>;
  onAcknowledge: (id: string) => Promise<void>;
}
type Detail = 'air' | 'soil' | 'water' | 'mode' | 'humidity' | 'root' | PumpId;
const formatReading = (value: number | null, unit: string) => value === null ? 'Sem leitura' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`;
const modeLabel = { AUTO: 'Automático', MANUAL_ON: 'Manual ligado', MANUAL_OFF: 'Manual desligado' };

function ReadingCard({ icon, label, value, detail, warning, onPress }: {
  icon: IconName; label: string; value: string; detail: string; warning?: boolean; onPress: () => void;
}) {
  const compact = useWindowDimensions().width < 360;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}. ${detail}`} onPress={onPress} style={({ pressed }) => [styles.reading, pressed && styles.pressed]}>
    <LinearGradient colors={warning ? ['#fff2f3', '#fff0f2'] : ['#edf5ec', '#edf5eb']} style={styles.readingFill}>
      <Icon name={icon} size={30} color={warning ? colors.red : colors.greenDark} />
      <Text style={styles.readingLabel}>{label}</Text>
      <View style={styles.valueRow}><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.value, { fontSize: value.length > 8 ? 19 : compact ? 26 : 31 }, warning && { color: colors.red }]}>{value}</Text><Icon name="chevron" size={14} /></View>
      <Text style={styles.detail}>{detail}</Text>
    </LinearGradient>
  </Pressable>;
}

function Trend({ values }: { values: number[] }) {
  if (values.length < 2) return <Text style={styles.helper}>A tendência aparece após duas medições válidas.</Text>;
  const min = Math.min(...values) - 1, max = Math.max(...values) + 1;
  const points = values.map((v, i) => `${i * 280 / (values.length - 1)},${52 - (v - min) * 45 / (max - min)}`).join(' ');
  return <View accessible accessibilityLabel={`Tendência de ${values.length} medições de umidade do solo, de ${values[0]} a ${values[values.length - 1]} por cento`}>
    <Svg width="100%" height={65} viewBox="0 0 280 60"><Polyline points={points} fill="none" stroke={colors.green} strokeWidth={2.5} /></Svg>
    <Text style={styles.helper}>Mais antiga: {formatReading(values[0], '%')} · mais recente: {formatReading(values[values.length - 1], '%')}</Text>
  </View>;
}

function ActiveIndicator({ active, label }: { active: boolean; label: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { opacity.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, opacity]);
  return <View style={[styles.statePill, active && styles.statePillOn]} accessibilityRole="text" accessibilityLabel={label}>
    <Animated.View style={[styles.stateDot, active && styles.stateDotOn, { opacity: active ? opacity : 1 }]} />
    <Text style={[styles.stateText, active && styles.stateTextOn]}>{label}</Text>
  </View>;
}

export function Dashboard({ snapshot, connected, clock, telemetry: history, busy, feedback, onNavigate, onCommand, onAcknowledge }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showMoreReadings, setShowMoreReadings] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [justStopped, setJustStopped] = useState<Partial<Record<PumpId, boolean>>>({});
  const [pendingAction, setPendingAction] = useState<CommandAction | null>(null);
  const previousPumpState = useRef<Partial<Record<PumpId, boolean>>>({});
  const stopTimers = useRef<Partial<Record<PumpId, ReturnType<typeof setTimeout>>>>({});
  const insets = useSafeAreaInsets();
  const { telemetry: t, config, pumps } = snapshot;
  const fresh = hasRecentState(snapshot, connected, clock);
  useEffect(() => {
    (['B1', 'B2'] as const).forEach(id => {
      const prior = previousPumpState.current[id];
      const current = pumps[id].isOn;
      if (fresh && prior === true && current === false) {
        setJustStopped(value => ({ ...value, [id]: true }));
        if (stopTimers.current[id]) clearTimeout(stopTimers.current[id]);
        stopTimers.current[id] = setTimeout(() => setJustStopped(value => ({ ...value, [id]: false })), 3500);
      } else if (current) {
        setJustStopped(value => ({ ...value, [id]: false }));
      }
      previousPumpState.current[id] = current;
    });
  }, [fresh, pumps.B1.isOn, pumps.B2.isOn]);
  useEffect(() => () => { Object.values(stopTimers.current).forEach(timer => timer && clearTimeout(timer)); }, []);
  const status = dashboardStatus(snapshot, connected, clock);
  const lowWater = t.waterLevel === 'LOW';
  const operation = pumps.B1.mode === 'AUTO' && pumps.B2.mode === 'AUTO' ? 'Automático' : pumps.B1.mode !== 'AUTO' && pumps.B2.mode !== 'AUTO' ? 'Manual' : 'Misto';
  const quality = (reliable: boolean) => !fresh ? 'Última leitura conhecida' : reliable ? 'Leitura confiável' : 'Sensor indisponível';
  const selectedPump = detail === 'B1' || detail === 'B2' ? detail : null;
  const controlBlock = selectedPump ? pumpControlBlock(snapshot, selectedPump, connected, clock) : null;
  const importantAlerts = [...snapshot.activeAlerts].sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]));
  const readings: Record<Exclude<Detail, PumpId>, { title: string; value: string; text: string }> = {
    air: { title: 'Temperatura do ar', value: formatReading(t.dhtReliable ? t.airTemperatureC : null, ' °C'), text: `${quality(t.dhtReliable)}. Névoa a partir de ${config.fogTemperatureOnC} °C; emergência a ${config.emergencyTemperatureC} °C. A atuação também depende de umidade, nível de água e proteções.` },
    soil: { title: 'Umidade do substrato', value: formatReading(t.soilReliable ? t.soilMoisturePercent : null, '%'), text: `${quality(t.soilReliable)}. Faixa configurada: ${config.soilMinPercent}% a ${config.soilMaxPercent}%. Em AUTO, B1 inicia abaixo do mínimo e para no máximo ou no teto de tempo, respeitando pausa e proteções.` },
    water: { title: 'Reservatório', value: lowWater ? 'Nível baixo' : 'Nível adequado', text: `${fresh ? 'Indicação da boia de nível.' : 'Indicação antiga; o nível atual é desconhecido.'} Não representa porcentagem do reservatório. Nível baixo ou circuito aberto bloqueia B1 e B2.` },
    mode: { title: 'Modo de operação', value: operation, text: `B1: ${modeLabel[pumps.B1.mode]}. B2: ${modeLabel[pumps.B2.mode]}. Os modos são independentes. Pedidos manuais são temporizados; ao expirar, a bomba volta para AUTO.` },
    humidity: { title: 'Umidade do ar', value: formatReading(t.dhtReliable ? t.airHumidityPercent : null, '%'), text: `${quality(t.dhtReliable)}. Névoa pode iniciar abaixo de ${config.fogHumidityMinPercent}% e é bloqueada em ${config.fogHumidityBlockPercent}% no funcionamento normal. Na emergência, o corte é em 95%.` },
    root: { title: 'Temperatura do substrato', value: formatReading(t.rootReliable ? t.substrateTemperatureC : null, ' °C'), text: `${quality(t.rootReliable)}. O limite de alerta aplicado é ${config.rootAlertTemperatureC} °C. Falha do sensor é exibida sem substituir a medição por zero.` },
  };
  function open(value: Detail) { setPendingAction(null); setDetail(value); }
  function close() { if (!busy) { setDetail(null); setPendingAction(null); } }
  const soilTrend = history.slice(0, 20).reverse().filter(r => r.soilReliable && r.soilMoisturePercent !== null).map(r => r.soilMoisturePercent as number);

  return <View style={styles.dashboard}>
    <View style={styles.updateRow}><Text style={styles.helper}>{fresh ? 'Atualização automática a cada 2 s' : 'Valores antigos · estado atual desconhecido'}</Text><Text style={styles.helper}>{readingAge(snapshot.lastSeenAt, clock)}</Text></View>
    <View style={styles.row}>
      <ReadingCard icon="temperature" label="Temperatura do ar" value={formatReading(t.dhtReliable ? t.airTemperatureC : null, ' °C')} detail={quality(t.dhtReliable)} warning={!fresh || !t.dhtReliable || (t.airTemperatureC ?? 0) >= config.emergencyTemperatureC} onPress={() => open('air')} />
      <ReadingCard icon="drop" label="Umidade do substrato" value={formatReading(t.soilReliable ? t.soilMoisturePercent : null, '%')} detail={`Faixa: ${config.soilMinPercent}% a ${config.soilMaxPercent}%`} warning={!fresh || !t.soilReliable || (t.soilMoisturePercent ?? 0) < config.soilMinPercent || (t.soilMoisturePercent ?? 100) > config.soilMaxPercent} onPress={() => open('soil')} />
    </View>
    <View style={styles.row}>
      <ReadingCard icon="reservoir" label="Reservatório" value={lowWater ? 'Baixo' : 'Adequado'} detail={!fresh ? 'Última indicação da boia' : lowWater ? 'Bombas bloqueadas' : 'Nível OK'} warning={!fresh || lowWater} onPress={() => open('water')} />
      <ReadingCard icon="settings" label="Modo de operação" value={operation} detail={!fresh ? 'Último modo conhecido' : `B1: ${pumps.B1.mode} · B2: ${pumps.B2.mode}`} onPress={() => open('mode')} />
    </View>
    <Pressable style={styles.moreReadings} onPress={() => setShowMoreReadings(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: showMoreReadings }}>
      <Text style={styles.link}>{showMoreReadings ? 'Ocultar outras leituras' : 'Ver outras leituras'} · {formatReading(t.dhtReliable ? t.airHumidityPercent : null, '%')} UR · {formatReading(t.rootReliable ? t.substrateTemperatureC : null, ' °C')} substrato</Text>
    </Pressable>
    {showMoreReadings && <View style={styles.secondaryReadings}>
      <Pressable style={styles.secondaryItem} onPress={() => open('humidity')} accessibilityRole="button" accessibilityLabel="Detalhes da umidade do ar"><Text style={styles.helper}>Umidade do ar</Text><Text style={styles.secondaryValue}>{formatReading(t.dhtReliable ? t.airHumidityPercent : null, '%')}</Text></Pressable>
      <View style={styles.divider} />
      <Pressable style={styles.secondaryItem} onPress={() => open('root')} accessibilityRole="button" accessibilityLabel="Detalhes da temperatura do substrato"><Text style={styles.helper}>Temperatura do substrato</Text><Text style={styles.secondaryValue}>{formatReading(t.rootReliable ? t.substrateTemperatureC : null, ' °C')}</Text></Pressable>
    </View>}
    <Pressable style={[styles.banner, { backgroundColor: status.warning ? '#fff0f1' : '#e9f3e7' }]} onPress={() => onNavigate(status.warning ? 'Alertas' : 'Controle')} accessibilityRole="button">
      <Icon name={status.warning ? 'warning' : 'check'} color={status.warning ? colors.red : colors.green} size={25} /><Text style={[styles.bannerText, status.warning && { color: '#a51f30' }]}>{status.text}</Text>
    </Pressable>
    <Text style={styles.sectionTitle} accessibilityRole="header">Equipamentos</Text>
    <View style={styles.row}>{(['B1', 'B2'] as const).map(id => {
      const pump = pumps[id];
      const seconds = pump.expiresAt ? Math.max(0, Math.ceil((Date.parse(pump.expiresAt) - clock) / 1000)) : null;
      return <Pressable key={id} style={({ pressed }) => [styles.equipment, pressed && styles.pressed]} onPress={() => open(id)} accessibilityRole="button" accessibilityLabel={`Controlar ${id}, ${id === 'B1' ? 'irrigação' : 'névoa'}`}>
        <View style={styles.equipmentHeading}><Icon name={id === 'B1' ? 'plant' : 'sprinkler'} size={27} /><Text style={styles.cardTitle}>{id} · {id === 'B1' ? 'Irrigação' : 'Névoa'}</Text></View>
        <ActiveIndicator active={fresh && pump.isOn} label={!fresh ? 'Estado desconhecido' : pump.isOn ? 'ACIONADA · EM FUNCIONAMENTO' : justStopped[id] ? 'DESLIGADA AGORA' : 'Desligada'} />
        <Text style={styles.helper}>{modeLabel[pump.mode]}{pump.isOn && pump.mode === 'AUTO' ? ' · acionamento automático' : ''}</Text>
        {seconds !== null && <Text style={styles.countdown}>{seconds > 0 ? `Expira em ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : 'Aguardando atualização do modo'}</Text>}
        {!!pump.blockedReason && <Text style={styles.blocked}>{pump.blockedReason}</Text>}
        <Text style={styles.link}>Controlar ›</Text>
      </Pressable>;
    })}</View>
    <Pressable style={styles.moreReadings} onPress={() => setShowTrend(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: showTrend }}><Text style={styles.link}>{showTrend ? 'Ocultar tendência do solo' : 'Ver tendência do solo'} ›</Text></Pressable>
    {showTrend && <View style={styles.panel}><Text style={styles.cardTitle}>Umidade do solo · últimas medições</Text><Trend values={soilTrend} /></View>}
    <View style={styles.sectionRow}><View><Text style={styles.sectionTitle}>Alertas</Text><Text style={styles.helper}>{snapshot.activeAlerts.length === 0 ? fresh ? 'Nenhum alerta ativo' : 'Sem dados recentes' : `${snapshot.activeAlerts.length} ativo(s)`}</Text></View><Pressable accessibilityRole="button" onPress={() => onNavigate('Alertas')}><Text style={styles.link}>Ver alertas ›</Text></Pressable></View>
    {importantAlerts.length > 0 && importantAlerts.slice(0, 1).map(alert => <View key={alert.id} style={styles.panel}>
      <View style={styles.sectionRow}><Icon name={alert.severity === 'info' ? 'info' : 'warning'} color={alert.severity === 'critical' ? colors.red : colors.greenDark} /><Text style={[styles.cardTitle, { flex: 1 }]}>{alert.title}</Text></View>
      <Text style={styles.helper}>{alert.suggestedAction}</Text>
      <Text style={styles.helper}>{alert.acknowledgedAt ? 'Reconhecido · a condição permanece ativa' : 'Ainda não reconhecido'}</Text>
      {!alert.acknowledgedAt && <Pressable disabled={busy || !connected} style={[styles.outlineButton, (busy || !connected) && styles.disabled]} onPress={() => { void onAcknowledge(alert.id); }} accessibilityRole="button"><Text style={styles.link}>Reconhecer alerta</Text></Pressable>}
    </View>)}
    <Text style={[styles.helper, { textAlign: 'center' }]}>Simulação · atualizado {readingAge(snapshot.lastSeenAt, clock)}</Text>

    <Modal visible={detail !== null} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Fechar detalhes" />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
            <View style={styles.sectionRow}><Text style={[styles.sectionTitle, { flex: 1 }]}>{selectedPump ? `${selectedPump} · ${selectedPump === 'B1' ? 'Irrigação' : 'Névoa'}` : detail ? readings[detail as Exclude<Detail, PumpId>].title : ''}</Text><Pressable onPress={close} disabled={busy} accessibilityRole="button" accessibilityLabel="Fechar"><Text style={styles.link}>Fechar</Text></Pressable></View>
            {selectedPump ? <>
              <Text style={styles.secondaryValue}>{fresh ? pumps[selectedPump].isOn ? 'Ligada' : 'Desligada' : 'Estado atual desconhecido'} · {modeLabel[pumps[selectedPump].mode]}</Text>
              {pumps[selectedPump].expiresAt && <Text style={styles.countdown}>Modo manual: {Math.max(0, Math.ceil((Date.parse(pumps[selectedPump].expiresAt!) - clock) / 1000))} s restantes</Text>}
              <Text style={styles.helper}>A saída só muda após o estado confirmado pelo dispositivo. B1 tem teto de 300 s; cada pulso de B2, 60 s.</Text>
              {!!controlBlock && <Text style={styles.blocked}>{controlBlock}</Text>}
              {!!feedback && <Text style={styles.helper} accessibilityRole="alert">{feedback}</Text>}
              <View style={styles.chips}>{([
                ['AUTO', 'Voltar ao automático'], ['MANUAL_ON', `Ligar ${selectedPump === 'B1' ? config.manualIrrigationSeconds : config.manualFogSeconds} s`], ['MANUAL_OFF', 'Desligar por 1 h'], ['TEST', 'Testar por 10 s'],
              ] as [CommandAction, string][]).map(([action, label]) => {
                const disabled = busy || !fresh || ((action === 'MANUAL_ON' || action === 'TEST') && !!controlBlock);
                return <Pressable key={action} disabled={disabled} onPress={() => setPendingAction(action)} accessibilityRole="button" style={[styles.outlineButton, disabled && styles.disabled]}><Text style={styles.link}>{label}</Text></Pressable>;
              })}</View>
              {pendingAction && <View style={styles.panel}><Text style={styles.cardTitle}>Confirmar pedido para {selectedPump}?</Text><Text style={styles.helper}>{pendingAction === 'AUTO' ? 'O simulador voltará a decidir os acionamentos pelos sensores e limites.' : pendingAction === 'MANUAL_OFF' ? 'O modo manual manterá a bomba desligada por até uma hora.' : `Acionamento temporizado de ${pendingAction === 'TEST' ? 10 : selectedPump === 'B1' ? config.manualIrrigationSeconds : config.manualFogSeconds} segundos, sujeito às proteções locais.`}</Text><Pressable disabled={busy || !fresh || ((pendingAction === 'MANUAL_ON' || pendingAction === 'TEST') && !!controlBlock)} onPress={async () => { if (await onCommand(selectedPump, pendingAction)) setPendingAction(null); }} style={[styles.primaryButton, busy && styles.disabled]} accessibilityRole="button">{busy && <ActivityIndicator color="white" />}<Text style={styles.primaryText}>{busy ? 'Enviando…' : 'Confirmar comando'}</Text></Pressable><Pressable disabled={busy} onPress={() => setPendingAction(null)} accessibilityRole="button"><Text style={styles.link}>Cancelar</Text></Pressable></View>}
              <Pressable onPress={() => { close(); onNavigate('Controle'); }} accessibilityRole="button"><Text style={styles.link}>Abrir controle e configurações ›</Text></Pressable>
            </> : detail && <><Text style={styles.value}>{readings[detail as Exclude<Detail, PumpId>].value}</Text><Text style={styles.modalText}>{readings[detail as Exclude<Detail, PumpId>].text}</Text><Text style={styles.helper}>Última comunicação: {new Date(snapshot.lastSeenAt).toLocaleString('pt-BR')} ({readingAge(snapshot.lastSeenAt, clock)}).</Text><Pressable style={styles.outlineButton} onPress={() => { close(); onNavigate(detail === 'mode' ? 'Controle' : detail === 'water' ? 'Alertas' : 'Histórico'); }} accessibilityRole="button"><Text style={styles.link}>{detail === 'mode' ? 'Abrir controles' : detail === 'water' ? 'Ver alertas' : 'Ver histórico'} ›</Text></Pressable></>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  dashboard: { gap: 13 }, row: { flexDirection: 'row', gap: 12 }, pressed: { opacity: .78 }, disabled: { opacity: .45 },
  updateRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 5 },
  reading: { flex: 1, minWidth: 0, borderRadius: 15, ...cardShadow },
  readingFill: { flex: 1, borderRadius: 15, padding: 13, minHeight: 126 },
  readingLabel: { color: colors.ink, fontSize: 13, lineHeight: 18, marginTop: 9 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
  value: { color: colors.ink, fontSize: 30, fontWeight: '800', letterSpacing: -.7, flexShrink: 1 },
  detail: { color: '#587164', fontSize: 10, marginTop: 6, lineHeight: 15 },
  secondaryReadings: { flexDirection: 'row', paddingVertical: 9, gap: 14 }, secondaryItem: { flex: 1, gap: 4 },
  secondaryValue: { color: colors.ink, fontSize: 17, fontWeight: '600' }, divider: { width: 1, backgroundColor: colors.line },
  sectionTitle: { color: colors.ink, fontSize: 21, fontWeight: '700', letterSpacing: -.5 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 9, justifyContent: 'space-between', flexWrap: 'wrap' },
  equipment: { flex: 1, minWidth: 0, backgroundColor: '#fffefd', borderRadius: 15, padding: 13, gap: 8, borderWidth: 1, borderColor: colors.line, ...cardShadow },
  equipmentHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink }, pumpState: { fontSize: 16, fontWeight: '700' },
  statePill: { alignSelf: 'flex-start', minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#eef0ed', borderRadius: 15, paddingHorizontal: 9, paddingVertical: 5 },
  statePillOn: { backgroundColor: '#e4f5e9' }, stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7d8981' }, stateDotOn: { backgroundColor: '#16a34a' },
  stateText: { color: '#5f6f65', fontWeight: '700', fontSize: 10 }, stateTextOn: { color: '#087332', fontSize: 10 },
  countdown: { color: colors.greenDark, fontSize: 11 }, blocked: { color: '#a51f30', fontSize: 12, lineHeight: 18 },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 16 }, link: { color: colors.greenDark, fontSize: 12, fontWeight: '700', paddingVertical: 5 },
  banner: { borderRadius: 14, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, bannerText: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  panel: { backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, gap: 10 },
  moreReadings: { alignSelf: 'flex-start', paddingVertical: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: '#b8d4c0', borderRadius: 22, paddingHorizontal: 12, paddingVertical: 10 },
  selectedChip: { backgroundColor: colors.greenDark, borderColor: colors.greenDark }, chipText: { fontSize: 12, color: colors.greenDark, fontWeight: '600' },
  outlineButton: { borderWidth: 1, borderColor: '#bed7c5', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start' },
  primaryButton: { backgroundColor: colors.green, borderRadius: 12, minHeight: 50, paddingHorizontal: 17, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  primaryText: { color: 'white', fontWeight: '700', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: '#00000070', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, maxHeight: '85%' }, modalText: { color: colors.ink, fontSize: 14, lineHeight: 22 },
});
