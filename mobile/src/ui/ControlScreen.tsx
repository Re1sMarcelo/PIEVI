import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CommandAction, Config, PumpId, SimulationScenario, Snapshot } from '../../../api/src/contracts';
import { CONFIG_FIELDS, inIrrigationWindow, localTimeParts } from '../../../api/src/controlConfig';
import { controlBlock, createControlDraft, nextMinuteTime, parseControlDraft, parseNumber, type ControlDraft } from '../controlModel';
import { hasRecentState } from '../dashboardModel';
import { Icon } from './Icon';
import { colors } from './theme';

interface Props {
  snapshot: Snapshot; connected: boolean; clock: number; busy: boolean; active: boolean; feedback: string;
  onCommand: (id: PumpId, action: CommandAction, duration?: number, supervision?: boolean) => Promise<boolean>;
  onSave: (config: Config, expectedVersion: number) => Promise<boolean>;
  onScenario: (scenario: SimulationScenario) => Promise<void>;
  onAdvance: (seconds: number) => Promise<void>;
}
type Confirmation = { kind: 'save'; config: Config } | { kind: 'reload' } | { kind: 'command'; pump: PumpId; action: CommandAction; duration?: number };
const modes = { AUTO: 'Automático', MANUAL_ON: 'Manual ligado', MANUAL_OFF: 'Manual desligado' };

function Button({ label, onPress, disabled, primary, danger }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} style={[styles.button, primary && styles.primaryButton, danger && styles.dangerButton, disabled && styles.disabled]}><Text style={[styles.buttonText, (primary || danger) && { color: 'white' }]}>{label}</Text></Pressable>;
}
function Field({ label, value, onChange, hint, integer, time, disabled }: { label: string; value: string; onChange: (text: string) => void; hint?: string; integer?: boolean; time?: boolean; disabled?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} style={[styles.input, disabled && styles.disabled]} value={value} onChangeText={onChange} editable={!disabled} keyboardType={time ? 'default' : integer ? 'number-pad' : 'decimal-pad'} autoCorrect={false} autoCapitalize="none" placeholder={time ? 'HH:mm' : undefined} maxLength={time ? 5 : 12} />{!!hint && <Text style={styles.helper}>{hint}</Text>}</View>;
}
function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <View style={styles.row}><Text style={[styles.label, { flex: 1 }]}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: '#bac8be', true: colors.green }} /></View>;
}

function StatusBadge({ active, label, mode }: { active: boolean; label: string; mode: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { opacity.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: .35, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, opacity]);
  return <View style={[styles.stateBadge, active && styles.stateBadgeOn, label === 'Estado desconhecido' && styles.stateBadgeUnknown]} accessibilityRole="text" accessibilityLabel={`${label}, ${mode}`}>
    <Animated.View style={[styles.stateDot, active && styles.stateDotOn, { opacity: active ? opacity : 1 }]} />
    <Text style={[styles.title, active && styles.stateTextOn]}>{label}</Text><Text style={styles.helper}>· {mode}</Text>
  </View>;
}

export function ControlScreen({ snapshot, connected, clock, busy, active, feedback, onCommand, onSave, onScenario, onAdvance }: Props) {
  const [section, setSection] = useState<'manual' | 'sensors' | 'schedule'>('manual');
  const [draft, setDraft] = useState<ControlDraft>(() => createControlDraft(snapshot.config));
  const [baseVersion, setBaseVersion] = useState(snapshot.configVersion);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [supervised, setSupervised] = useState(false);
  const [duration, setDuration] = useState({ B1: String(snapshot.config.manualIrrigationSeconds), B2: String(snapshot.config.manualFogSeconds) });
  const [showBench, setShowBench] = useState(false);
  const [showAppliedDetails, setShowAppliedDetails] = useState(false);
  const [showProtections, setShowProtections] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState<Partial<Record<PumpId, boolean>>>({});
  const insets = useSafeAreaInsets();
  const fresh = hasRecentState(snapshot, connected, clock);
  const local = localTimeParts(clock, snapshot.timeZone);
  const conflict = dirty && baseVersion !== snapshot.configVersion;

  useEffect(() => {
    if (!dirty) { setDraft(createControlDraft(snapshot.config)); setBaseVersion(snapshot.configVersion); }
  }, [snapshot.configVersion, dirty]);
  useEffect(() => { if (!active) setConfirmation(null); }, [active]);
  function edit(update: Partial<ControlDraft>) { setDraft(current => ({ ...current, ...update })); setDirty(true); setError(''); }
  function loadApplied() {
    setDraft(createControlDraft(snapshot.config)); setBaseVersion(snapshot.configVersion); setDirty(false); setError('');
    setDuration({ B1: String(snapshot.config.manualIrrigationSeconds), B2: String(snapshot.config.manualFogSeconds) }); setConfirmation(null);
  }
  function prepareSave() {
    setError('');
    if (!fresh) { setError('Aguarde uma conexão com dados recentes antes de aplicar a configuração.'); return; }
    if (conflict) { setError('Outra sessão alterou a configuração. Recarregue a versão aplicada para evitar sobrescrever alterações.'); return; }
    const parsed = parseControlDraft(draft, snapshot.config);
    if (parsed.error || !parsed.config) { setError(parsed.error ?? 'Confira os parâmetros.'); return; }
    setConfirmation({ kind: 'save', config: parsed.config });
  }
  function prepareCommand(pump: PumpId, action: CommandAction) {
    setError(''); setSupervised(false);
    const block = controlBlock(snapshot, pump, action, connected, clock);
    if (block) { setError(block); return; }
    const seconds = action === 'MANUAL_ON' || action === 'IGNORE_FLOAT' ? parseNumber(duration[pump]) : action === 'TEST' ? 10 : undefined;
    const max = action === 'IGNORE_FLOAT' ? pump === 'B1' ? 120 : 60 : pump === 'B1' ? 300 : 60;
    if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 1 || seconds > max)) { setError(`${pump}: informe uma duração inteira de 1 a ${max} segundos para este comando.`); return; }
    setConfirmation({ kind: 'command', pump, action, duration: seconds });
  }
  async function confirm() {
    if (!confirmation || busy) return;
    if (confirmation.kind === 'reload') { loadApplied(); return; }
    if (confirmation.kind === 'save') {
      if (await onSave(confirmation.config, baseVersion)) { setDirty(false); setConfirmation(null); }
      return;
    }
    const block = controlBlock(snapshot, confirmation.pump, confirmation.action, connected, clock);
    if (block) { setError(block); return; }
    if (confirmation.action === 'IGNORE_FLOAT' && !supervised) { setError('Confirme a supervisão presencial para testar ignorando a boia.'); return; }
    if (await onCommand(confirmation.pump, confirmation.action, confirmation.duration, confirmation.action === 'IGNORE_FLOAT' ? supervised : undefined)) setConfirmation(null);
  }
  function addSchedule(time = '') {
    if (time && draft.schedule.some(row => row.time === time)) { setError('Esse horário já está na agenda.'); return; }
    edit({ schedule: [...draft.schedule, { key: `${Date.now()}-${Math.random()}`, time, duration: '60', enabled: true }] });
  }
  const pendingDescription = confirmation?.kind === 'save'
    ? 'Os parâmetros e a agenda serão validados juntos. A configuração só será exibida como aplicada após a confirmação do dispositivo. Alterar limites pode iniciar ou interromper ciclos em AUTO.'
    : confirmation?.kind === 'reload' ? 'As alterações ainda não salvas serão descartadas e a versão aplicada será carregada.'
      : confirmation?.kind === 'command' ? confirmation.action === 'IGNORE_FLOAT'
        ? `Teste supervisionado de ${confirmation.pump} por ${confirmation.duration} s, ignorando somente a boia. A outra bomba precisa estar desligada. As demais proteções continuam ativas.`
        : confirmation.action === 'MANUAL_OFF' ? `${confirmation.pump} ficará em MANUAL_OFF por uma hora. Depois, retorna para AUTO.`
          : confirmation.action === 'AUTO' ? `${confirmation.pump} voltará a decidir pelos sensores e horários aplicados, podendo iniciar imediatamente.`
            : confirmation.action === 'RESET_FAULT' ? `Após conferir bomba, fiação e sensores, o rearme de ${confirmation.pump} libera o automático e pode iniciar um ciclo imediatamente. Não corrige uma falha física.`
              : `${confirmation.pump} será acionada por ${confirmation.duration} s. O manual ignora a demanda dos sensores, mas respeita os bloqueios locais. Depois retorna para AUTO.` : '';

  return <View style={styles.screen}>
    <View style={styles.applied}>
      <View style={styles.row}><Icon name="check" /><Text style={styles.title}>{snapshot.configApplied === false ? 'Configuração ainda não confirmada' : `Configuração aplicada · v${snapshot.configVersion}`}</Text></View>
      <Text style={[styles.helper, !snapshot.telemetry.clockReliable && styles.clockError]}>{snapshot.telemetry.clockReliable ? `Agenda ativa · ${local.time} · ${snapshot.irrigationCyclesToday}/${snapshot.config.irrigationMaxCyclesPerDay} ciclos hoje` : 'Hora inválida · agenda suspensa'}</Text>
      <Pressable onPress={() => setShowAppliedDetails(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: showAppliedDetails }}><Text style={styles.link}>{showAppliedDetails ? 'Ocultar detalhes' : 'Detalhes da configuração'} ›</Text></Pressable>
      {showAppliedDetails && <Text style={styles.helper}>{snapshot.configAppliedAt ? `Confirmada em ${new Date(snapshot.configAppliedAt).toLocaleString('pt-BR', { timeZone: snapshot.timeZone })}` : 'Aguardando primeira confirmação do ESP'} · {local.date} · {snapshot.timeZone}</Text>}
    </View>
    {!fresh && <Text style={styles.warning}>Sem dados recentes: o estado atual é desconhecido. Aguarde reconexão para enviar comandos e configurações.</Text>}
    {dirty && <View style={styles.card}><Text style={styles.title}>Alterações ainda não aplicadas</Text><Text style={styles.helper}>{conflict ? 'Uma versão mais recente foi aplicada em outra sessão. Recarregue antes de editar novamente.' : 'O dispositivo continua usando a versão aplicada acima. Seu rascunho é preservado ao trocar as abas.'}</Text><View style={styles.actions}><Button label="Revisar e aplicar" onPress={prepareSave} primary disabled={busy || !fresh || conflict} /><Button label="Recarregar aplicada" onPress={() => setConfirmation({ kind: 'reload' })} disabled={busy} /></View></View>}
    {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    <View style={styles.tabs}>{([['manual', 'Manual'], ['sensors', 'Sensores'], ['schedule', 'Horários']] as const).map(([id, label]) => <Pressable key={id} onPress={() => setSection(id)} accessibilityRole="tab" accessibilityState={{ selected: section === id }} style={[styles.tab, section === id && styles.selectedTab]}><Text style={[styles.tabText, section === id && { color: 'white' }]}>{label}</Text></Pressable>)}</View>

    {section === 'manual' && <>
      <Text style={styles.helper}>O estado é confirmado pelo dispositivo. Acionamentos são temporizados.</Text>
      {(['B1', 'B2'] as const).map(id => {
        const pump = snapshot.pumps[id];
        const remaining = pump.expiresAt ? Math.max(0, Math.ceil((Date.parse(pump.expiresAt) - clock) / 1000)) : null;
        const blocked = controlBlock(snapshot, id, 'MANUAL_ON', connected, clock);
        return <View style={styles.card} key={id}>
          <View style={styles.row}><Icon name={id === 'B1' ? 'plant' : 'sprinkler'} size={30} /><Text style={styles.sectionTitle}>{id} · {id === 'B1' ? 'Irrigação' : 'Névoa'}</Text></View>
          <StatusBadge active={fresh && pump.isOn} label={fresh ? pump.isOn ? 'ACIONADA · EM FUNCIONAMENTO' : 'Desligada' : 'Estado desconhecido'} mode={modes[pump.mode]} />
          {remaining !== null && <Text style={styles.helper}>{remaining > 0 ? `Retorno ao AUTO em ${Math.floor(remaining / 60)}m ${String(remaining % 60).padStart(2, '0')}s` : 'Aguardando atualização do modo'}</Text>}
          {!!pump.faultCode && <Text style={styles.error}>{pump.faultCode}: automático suspenso. Teste e rearme após verificar a causa.</Text>}
          {!!pump.floatOverrideUntil && <Text style={styles.warning}>Exceção supervisionada da boia ativa. Acompanhe presencialmente.</Text>}
          {!!blocked && <Text style={styles.helper}>{blocked}</Text>}
          <Field label={`Duração manual de ${id} (s)`} value={duration[id]} onChange={value => setDuration(current => ({ ...current, [id]: value }))} integer hint={`1 a ${id === 'B1' ? 300 : 60} s. Exceção da boia: até ${id === 'B1' ? 120 : 60} s.`} disabled={busy} />
          <View style={styles.actions}>
            <Button label={`Ligar ${duration[id]} s`} onPress={() => prepareCommand(id, 'MANUAL_ON')} primary disabled={busy || !!blocked} />
            <Button label="Desligar" onPress={() => prepareCommand(id, 'MANUAL_OFF')} danger disabled={busy || !!controlBlock(snapshot, id, 'MANUAL_OFF', connected, clock)} />
          </View>
          <Pressable onPress={() => setShowAdvanced(value => ({ ...value, [id]: !value[id] }))} accessibilityRole="button" accessibilityState={{ expanded: !!showAdvanced[id] }}><Text style={styles.link}>{showAdvanced[id] ? 'Ocultar opções avançadas' : 'Mais opções'} ›</Text></Pressable>
          {showAdvanced[id] && <View style={styles.advanced}>
            <View style={styles.actions}><Button label="Voltar ao automático" onPress={() => prepareCommand(id, 'AUTO')} disabled={busy || !!controlBlock(snapshot, id, 'AUTO', connected, clock)} /><Button label="Teste 10 s" onPress={() => prepareCommand(id, 'TEST')} disabled={busy || !!controlBlock(snapshot, id, 'TEST', connected, clock)} />{pump.faultCode && <Button label="Rearmar falha" onPress={() => prepareCommand(id, 'RESET_FAULT')} disabled={busy || !!controlBlock(snapshot, id, 'RESET_FAULT', connected, clock)} />}</View>
            <Button label="Teste supervisionado: ignorar boia" onPress={() => prepareCommand(id, 'IGNORE_FLOAT')} danger disabled={busy || !!controlBlock(snapshot, id, 'IGNORE_FLOAT', connected, clock)} />
          </View>}
        </View>;
      })}
      <View style={styles.card}><Text style={styles.title}>Durações manuais padrão</Text><Text style={styles.helper}>Usadas nos atalhos do Painel. Alterar estes padrões não inicia uma bomba.</Text>{CONFIG_FIELDS.filter(f => f.group === 'manual').map(field => <Field key={field.key} label={field.label} value={draft.numbers[field.key]} integer hint={`${field.min} a ${field.max} ${field.unit}`} disabled={busy} onChange={value => edit({ numbers: { ...draft.numbers, [field.key]: value } })} />)}</View>
    </>}

    {section === 'sensors' && <>
      {(['irrigation', 'fog', 'root'] as const).map(group => <View key={group} style={styles.card}>
        <Text style={styles.sectionTitle}>{group === 'irrigation' ? 'B1 · Irrigação pelo solo' : group === 'fog' ? 'B2 · Névoa pelo ambiente' : 'Temperatura do substrato'}</Text>
        <Text style={styles.helper}>{group === 'irrigation' ? 'Inicia abaixo do mínimo, para no máximo ou no tempo limite e respeita pausa, janela e contagem diária.' : group === 'fog' ? 'Inicia por temperatura alta OU UR baixa. Para quando temperatura e UR se recuperam, no limite do pulso ou por bloqueio de segurança.' : 'Somente gera alerta. A temperatura do substrato não liga bombas; o alerta limpa com redução de 2 °C.'}</Text>
        {CONFIG_FIELDS.filter(f => f.group === group).map(field => <Field key={field.key} label={field.label} value={draft.numbers[field.key]} integer={field.integer} hint={`${field.min} a ${field.max} ${field.unit}`} disabled={busy} onChange={value => edit({ numbers: { ...draft.numbers, [field.key]: value } })} />)}
      </View>)}
      <Pressable onPress={() => setShowProtections(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: showProtections }}><Text style={styles.link}>{showProtections ? 'Ocultar proteções fixas' : 'Ver proteções fixas'} ›</Text></Pressable>
      {showProtections && <Text style={styles.warning}>Água obrigatória; B1 até 300 s; B2 até 60 s; emergência corta névoa em UR ≥95%; falha do DHT22 bloqueia B2 até três leituras válidas.</Text>}
    </>}

    {section === 'schedule' && <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Janela da irrigação automática</Text>
        <Text style={styles.helper}>Limita o horário em que B1 pode irrigar por sensor ou agenda de reserva. O fim é exclusivo. Uma janela 22:00–06:00 atravessa a meia-noite. O manual não depende desta janela.</Text>
        <Toggle label="Restringir irrigação a uma janela" value={draft.windowEnabled} onChange={value => edit({ windowEnabled: value })} disabled={busy} />
        <Field label="Início da janela" value={draft.windowStart} time onChange={value => edit({ windowStart: value })} disabled={busy} />
        <Field label="Fim da janela" value={draft.windowEnd} time onChange={value => edit({ windowEnd: value })} disabled={busy} />
        <Text style={styles.helper}>Versão aplicada: {snapshot.config.irrigationWindowEnabled ? `${snapshot.config.irrigationWindowStart}–${snapshot.config.irrigationWindowEnd} · ${inIrrigationWindow(local.time, snapshot.config) ? 'dentro da janela' : 'fora da janela'}` : 'janela desativada, irrigação por sensor em qualquer horário'}.</Text>
        <Text style={styles.helper}>Sem hora confiável, a janela é ignorada para a irrigação por sensor; a agenda de reserva fica suspensa.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Horários de reserva de B1</Text>
        <Text style={styles.helper}>Conforme o documento, esta agenda só é usada quando o sensor de solo está inválido há mais de 60 s. Não é uma irrigação extra com o sensor saudável. Todos os dias, no fuso {snapshot.timeZone}.</Text>
        {draft.schedule.length === 0 && <Text style={styles.warning}>Sem horários cadastrados, não haverá irrigação de reserva.</Text>}
        {draft.schedule.map((row, index) => <View key={row.key} style={styles.scheduleRow}>
          <Toggle label={`Habilitar horário ${index + 1}`} value={row.enabled} onChange={value => edit({ schedule: draft.schedule.map(r => r.key === row.key ? { ...r, enabled: value } : r) })} disabled={busy} />
          <Field label={`Horário ${index + 1} (HH:mm)`} value={row.time} time onChange={value => edit({ schedule: draft.schedule.map(r => r.key === row.key ? { ...r, time: value } : r) })} disabled={busy} />
          <Field label={`Duração do horário ${index + 1} (s)`} value={row.duration} integer hint="1 a 300 s; o tempo máximo de B1 também se aplica." onChange={value => edit({ schedule: draft.schedule.map(r => r.key === row.key ? { ...r, duration: value } : r) })} disabled={busy} />
          <Button label={`Remover horário ${index + 1}`} onPress={() => edit({ schedule: draft.schedule.filter(r => r.key !== row.key) })} disabled={busy} />
        </View>)}
        <View style={styles.actions}><Button label="Adicionar horário" onPress={() => addSchedule()} disabled={busy} /><Button label="Adicionar próximo minuto" onPress={() => addSchedule(nextMinuteTime(clock, snapshot.timeZone))} disabled={busy || !snapshot.scenarioControlsEnabled} /></View>
        <Text style={styles.helper}>Horários perdidos não são executados depois. Não há repetição no mesmo minuto, mesmo após recarregar ou salvar a agenda. Água, pausa, janela e limite diário continuam valendo.</Text>
      </View>
    </>}
    <View style={styles.card}><Text style={styles.title}>Aplicar as alterações</Text><Text style={styles.helper}>Sensores, janela, agenda e padrões manuais são enviados juntos. A configuração anterior continua ativa até a confirmação. No modo MQTT, as alterações e confirmações ficam gravadas no banco.</Text><View style={styles.actions}><Button label={busy ? 'Aguarde…' : 'Revisar e aplicar configuração'} onPress={prepareSave} primary disabled={busy || (!dirty && snapshot.configApplied !== false) || !fresh || conflict} /><Button label="Recarregar aplicada" onPress={() => dirty ? setConfirmation({ kind: 'reload' }) : loadApplied()} disabled={busy} /></View></View>

    {snapshot.scenarioControlsEnabled && <View style={styles.bench}>
      <Button label={showBench ? 'Recolher testes simulados' : 'Testar sem a estufa'} onPress={() => setShowBench(!showBench)} />
      {showBench && <><Text style={styles.title}>Bancada simulada</Text><Text style={styles.helper}>Os cenários alteram sensores do ambiente virtual. No modo MQTT, comandos e leituras percorrem o broker e usam tempo real. Trocar o cenário retorna B1/B2 para AUTO.</Text><View style={styles.actions}>{([
        ['normal', 'Normal'], ['dry_soil', 'Solo seco'], ['soil_failure', 'Falha no solo'], ['low_water', 'Nível baixo'], ['dht_failure', 'Falha DHT22'], ['clock_failure', 'Hora inválida'], ['soil_clock_failure', 'Solo + hora inválidos'], ['irrigation_failure', 'Falha B1'], ['fog_failure', 'Falha B2'], ['heat', 'Calor extremo'], ['heat_humid', 'Calor + UR 95%'], ['offline', 'Offline'],
      ] as [SimulationScenario, string][]).map(([scenario, label]) => <Button key={scenario} label={label} onPress={() => { void onScenario(scenario); }} disabled={busy || !connected} />)}</View>{(!snapshot.mode || snapshot.mode === 'simulator') && <View style={styles.actions}><Button label="Avançar 10 s" onPress={() => { void onAdvance(10); }} disabled={busy || !connected} /><Button label="Avançar 1 min" onPress={() => { void onAdvance(60); }} disabled={busy || !connected} /><Button label="Avançar 10 min" onPress={() => { void onAdvance(600); }} disabled={busy || !connected} /><Button label="Avançar 1 h" onPress={() => { void onAdvance(3600); }} disabled={busy || !connected} /></View>}<Text style={styles.helper}>Teste da agenda: adicione o próximo minuto, aplique, escolha Falha no solo e aguarde o horário (ou avance 1 min na simulação local). Verifique também bloqueios por água e hora inválida. A contagem diária é mantida ao trocar de cenário.</Text></>}
    </View>}
    <Modal visible={active && confirmation !== null} transparent animationType="slide" onRequestClose={() => { if (!busy) setConfirmation(null); }}>
      <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) setConfirmation(null); }} accessibilityLabel="Cancelar confirmação" accessibilityRole="button" /><View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}><ScrollView contentContainerStyle={{ gap: 14 }}><Text style={styles.sectionTitle}>{confirmation?.kind === 'save' ? 'Aplicar configuração?' : confirmation?.kind === 'reload' ? 'Descartar rascunho?' : 'Confirmar comando?'}</Text><Text style={styles.body}>{pendingDescription}</Text>{confirmation?.kind === 'command' && confirmation.action === 'IGNORE_FLOAT' && <Toggle label="Estou presente e confirmo a supervisão deste teste" value={supervised} onChange={setSupervised} disabled={busy} />}{!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}{!!feedback && <Text style={styles.helper} accessibilityRole="alert">{feedback}</Text>}{busy && <ActivityIndicator color={colors.green} />}<Button label={busy ? 'Aguardando confirmação…' : 'Confirmar'} onPress={() => { void confirm(); }} primary disabled={busy || (confirmation?.kind === 'command' && confirmation.action === 'IGNORE_FLOAT' && !supervised)} /><Button label="Cancelar" onPress={() => setConfirmation(null)} disabled={busy} /></ScrollView></View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { gap: 12 }, applied: { backgroundColor: '#eaf4ec', padding: 13, borderRadius: 14, gap: 6 },
  card: { backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, padding: 15, borderRadius: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, advanced: { paddingTop: 5, gap: 9 },
  stateBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, backgroundColor: '#eef0ed', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 }, stateBadgeOn: { backgroundColor: '#e3f5e8' }, stateBadgeUnknown: { backgroundColor: '#fff1dc' }, stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7d8981' }, stateDotOn: { backgroundColor: '#16a34a' }, stateTextOn: { color: '#087332' }, clockError: { color: '#a51f30' },
  link: { color: colors.greenDark, fontSize: 12, fontWeight: '700', paddingVertical: 4 },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, flexShrink: 1 }, sectionTitle: { fontSize: 19, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink }, helper: { fontSize: 11, lineHeight: 17, color: colors.muted },
  field: { gap: 5 }, input: { borderWidth: 1, borderColor: '#b8cdbf', backgroundColor: '#fffefd', borderRadius: 9, padding: 12, fontSize: 16, color: colors.ink, minHeight: 46 },
  button: { backgroundColor: '#e7f0e9', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 9, alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.green }, dangerButton: { backgroundColor: '#ac2635' }, buttonText: { color: colors.greenDark, fontSize: 12, fontWeight: '700' }, disabled: { opacity: .45 },
  tabs: { flexDirection: 'row', gap: 8 }, tab: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: '#e7efe9', alignItems: 'center' }, selectedTab: { backgroundColor: colors.greenDark }, tabText: { color: colors.greenDark, fontSize: 13, fontWeight: '700' },
  warning: { backgroundColor: '#fff1dc', color: '#77501c', padding: 12, borderRadius: 9, fontSize: 12, lineHeight: 18 }, error: { color: '#a51f30', backgroundColor: '#fff0f1', padding: 10, borderRadius: 8, fontSize: 12, lineHeight: 18 },
  scheduleRow: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 13, gap: 10 }, bench: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#8cae96', borderRadius: 14, padding: 15, gap: 12 },
  overlay: { flex: 1, backgroundColor: '#00000070', justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.background, padding: 22, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '85%' }, body: { fontSize: 14, color: colors.ink, lineHeight: 22 },
});
