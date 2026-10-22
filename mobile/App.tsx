import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert as NativeAlert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type {
  Alert,
  CommandAction,
  Config,
  DeviceEvent,
  PumpId,
  Snapshot,
  Telemetry,
} from '../api/src/contracts';
import { ApiError, api } from './src/api';
import { sessionStore } from './src/sessionStore';
import { googleUnavailableReason, signInWithGoogle } from './src/googleSignIn';
import { Dashboard } from './src/ui/Dashboard';
import { StrawberryLogo } from './src/ui/Illustrations';
import { LoginScreen } from './src/ui/LoginScreen';
import { BottomNavigation, PageHeader, type Tab } from './src/ui/Navigation';
import { colors } from './src/ui/theme';

type Draft = Record<'soilMinPercent' | 'soilMaxPercent' | 'fogTemperatureOnC' | 'fogHumidityMinPercent', string>;

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

function remaining(value: string | null, now: number) {
  if (!value) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function metric(value: number | null, suffix: string) {
  return value === null ? 'Sem leitura' : `${value.toFixed(1)}${suffix}`;
}

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

function AppContent() {
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('Painel');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const scrollView = useRef<ScrollView>(null);

  function navigate(nextTab: Tab) {
    setTab(nextTab);
    scrollView.current?.scrollTo({ y: 0, animated: false });
  }

  useEffect(() => {
    sessionStore.get()
      .then(setToken)
      .catch(() => setError('Não foi possível recuperar a sessão.'))
      .finally(() => setRestoring(false));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(async (activeToken: string) => {
    try {
      const [nextSnapshot, readings, nextEvents, nextAlerts] = await Promise.all([
        api.snapshot(activeToken), api.telemetry(activeToken), api.events(activeToken), api.alerts(activeToken),
      ]);
      setSnapshot(nextSnapshot);
      setTelemetry(readings.items);
      setEvents(nextEvents.items);
      setAlerts(nextAlerts.items);
      setConnected(true);
      setDraft((current) => current ?? {
        soilMinPercent: String(nextSnapshot.config.soilMinPercent),
        soilMaxPercent: String(nextSnapshot.config.soilMaxPercent),
        fogTemperatureOnC: String(nextSnapshot.config.fogTemperatureOnC),
        fogHumidityMinPercent: String(nextSnapshot.config.fogHumidityMinPercent),
      });
      setError('');
    } catch (caught) {
      setConnected(false);
      if (caught instanceof ApiError && caught.status === 401) {
        await sessionStore.clear();
        setToken(null);
        setSnapshot(null);
      }
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar dados.');
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void refresh(token);
    const timer = setInterval(() => { void refresh(token); }, 5000);
    return () => clearInterval(timer);
  }, [token, refresh]);

  async function login() {
    if (!username.trim() || !password) {
      setError('Informe seu usuário ou e-mail e sua senha.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const session = await api.login(username.trim(), password);
      await sessionStore.set(session.token);
      setToken(session.token);
      setPassword('');
      setNotice('');
      navigate('Painel');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha no login.');
    } finally { setBusy(false); }
  }

  async function googleLogin() {
    const unavailable=googleUnavailableReason();
    if(unavailable) {setError(unavailable);return;}
    setBusy(true);setError('');
    try {
      const challenge=await api.googleChallenge();
      const idToken=await signInWithGoogle(challenge.nonce);if(!idToken) return;
      const result=await api.googleLogin(challenge.challengeId,idToken,password);
      if(result.status==='authenticated') {
        await sessionStore.set(result.session.token);setToken(result.session.token);setPassword('');setNotice('');navigate('Painel');
      } else if(result.status==='not_registered') {
        const confirmed=await new Promise<boolean>(resolve=>NativeAlert.alert('Solicitar cadastro',
          'Sua conta Google ainda não tem acesso ao PIEVI. Deseja enviar seu nome e e-mail para análise? A solicitação ficará pendente, sem acesso à bancada.',
          [{text:'Cancelar',style:'cancel',onPress:()=>resolve(false)},{text:'Enviar solicitação',onPress:()=>resolve(true)}],
          {cancelable:true,onDismiss:()=>resolve(false)}));
        if(confirmed) {await api.requestGoogleAccess(result.requestTicket);setError('Solicitação enviada. Aguarde a análise do responsável.');}
      } else if(result.status==='pending') {
        setError('Sua solicitação já está registrada e aguarda análise do responsável.');
      } else if(result.status==='link_required') {
        setError('Para vincular esta conta Google, preencha sua senha atual no campo Senha e toque em Continuar com Google novamente.');
      } else {setError('Esta conta não está autorizada para entrar.');}
    } catch(caught) {setError(caught instanceof Error?caught.message:'Não foi possível entrar com Google.');}
    finally {setBusy(false);}
  }

  async function logout() {
    if (token) await api.logout(token).catch(() => undefined);
    await sessionStore.clear();
    setToken(null);
    setSnapshot(null);
    setDraft(null);
  }

  async function sendCommand(pumpId: PumpId, action: CommandAction) {
    if (!token) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const duration = action === 'MANUAL_ON' ? (pumpId === 'B1' ? 120 : 30) : undefined;
      const result = await api.command(token, pumpId, action, duration);
      setNotice(`Comando ${result.status === 'accepted' ? 'confirmado' : result.status} para ${pumpId}.`);
      await refresh(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Comando não executado.');
    } finally { setBusy(false); }
  }

  async function saveConfig() {
    if (!token || !draft) return;
    const values = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)])) as Partial<Config>;
    if (Object.values(values).some((value) => !Number.isFinite(value))) {
      setError('Informe números válidos para os limites.');
      return;
    }
    setBusy(true);
    try {
      await api.updateConfig(token, values);
      setNotice('Configuração simulada atualizada.');
      await refresh(token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar configuração.');
    } finally { setBusy(false); }
  }

  async function acknowledge(id: string) {
    if (!token) return;
    try {
      await api.acknowledge(token, id);
      await refresh(token);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao reconhecer alerta.'); }
  }

  if (restoring) return <View style={styles.center}><StrawberryLogo size={82} /><ActivityIndicator color={colors.green} size="large" /><StatusBar style="dark" /></View>;

  if (!token) return (
    <LoginScreen username={username} password={password} busy={busy} error={error} onUsernameChange={setUsername} onPasswordChange={setPassword} onSubmit={login} onGoogleLogin={googleLogin} />
  );

  return (
    <View style={styles.root}>
      <PageHeader tab={tab} snapshot={snapshot} connected={connected} onLogout={logout} />
      <ScrollView ref={scrollView} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.green} onRefresh={async () => {
        setRefreshing(true);
        try { await refresh(token); } finally { setRefreshing(false); }
      }} />}>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!snapshot && <View style={styles.loading}><ActivityIndicator size="large" color={colors.green} /><Text style={styles.helper}>Carregando sua estufa…</Text>{!!error && <Action label="Tentar novamente" onPress={() => { void refresh(token); }} />}</View>}
        {snapshot && tab === 'Painel' && <Dashboard snapshot={snapshot} connected={connected} clock={clock} onNavigate={navigate} />}
        {snapshot && tab === 'Histórico' && <>
          <Text style={styles.sectionTitle}>Acionamentos e eventos</Text>
          {events.length === 0 && <Text>Nenhum evento.</Text>}
          {events.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.description}</Text><Text style={styles.helper}>{formatTime(item.occurredAt)} · {item.origin}</Text></View>)}
          <Text style={styles.sectionTitle}>Leituras recentes</Text>
          {telemetry.slice(0, 20).map((item) => <View key={item.id} style={styles.card}><Text>Ar {metric(item.airTemperatureC, ' °C')} · UR {metric(item.airHumidityPercent, '%')}</Text><Text>Solo {metric(item.soilMoisturePercent, '%')} · Substrato {metric(item.substrateTemperatureC, ' °C')}</Text><Text style={styles.helper}>{formatTime(item.occurredAt)}</Text></View>)}
        </>}
        {snapshot && tab === 'Alertas' && <>
          <Text style={styles.sectionTitle}>Alertas</Text>
          {alerts.length === 0 && <Text>Nenhum alerta.</Text>}
          {alerts.map((item) => <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title} · {item.severity.toUpperCase()}</Text>
            <Text>{item.code} · {item.endedAt ? 'Resolvido' : 'Ativo'}</Text>
            <Text style={styles.helper}>Início: {formatTime(item.startedAt)}</Text>
            <Text>Ação sugerida: {item.suggestedAction}</Text>
            {!item.acknowledgedAt && <Action label="Reconhecer" onPress={() => acknowledge(item.id)} />}
          </View>)}
        </>}
        {snapshot && tab === 'Controle' && <>
          <Text style={styles.sectionTitle}>Controle manual</Text>
          <Text style={styles.helper}>Pedidos são confirmados pelo simulador. Modos manuais expiram automaticamente e respeitam os limites do ESP32.</Text>
          {(['B1', 'B2'] as PumpId[]).map((id) => <View key={id} style={styles.card}>
            <Text style={styles.cardTitle}>{id} · {id === 'B1' ? 'Irrigação' : 'Névoa'}</Text>
            <Text>Modo: {snapshot.pumps[id].mode} · {snapshot.pumps[id].isOn ? 'LIGADA' : 'DESLIGADA'}</Text>
            {snapshot.pumps[id].expiresAt && <Text>Expira em: {remaining(snapshot.pumps[id].expiresAt, clock)}</Text>}
            <View style={styles.actions}>
              <Action label="AUTO" onPress={() => sendCommand(id, 'AUTO')} disabled={busy} />
              <Action label={`Ligar ${id === 'B1' ? '120' : '30'} s`} onPress={() => sendCommand(id, 'MANUAL_ON')} disabled={busy} primary />
              <Action label="Desligar 1 h" onPress={() => sendCommand(id, 'MANUAL_OFF')} disabled={busy} />
              <Action label="Testar 10 s" onPress={() => sendCommand(id, 'TEST')} disabled={busy} />
            </View>
          </View>)}
          <Text style={styles.sectionTitle}>Limites provisórios</Text>
          {draft && <View style={styles.card}>
            <ConfigField label="Solo mínimo (%)" value={draft.soilMinPercent} onChange={(value) => setDraft({ ...draft, soilMinPercent: value })} />
            <ConfigField label="Solo máximo (%)" value={draft.soilMaxPercent} onChange={(value) => setDraft({ ...draft, soilMaxPercent: value })} />
            <ConfigField label="Névoa a partir de (°C)" value={draft.fogTemperatureOnC} onChange={(value) => setDraft({ ...draft, fogTemperatureOnC: value })} />
            <ConfigField label="UR mínima para névoa (%)" value={draft.fogHumidityMinPercent} onChange={(value) => setDraft({ ...draft, fogHumidityMinPercent: value })} />
            <Action label="Salvar limites" onPress={saveConfig} disabled={busy} primary />
          </View>}
        </>}
      </ScrollView>
      <BottomNavigation current={tab} onChange={navigate} alertCount={snapshot?.activeAlerts.length ?? 0} />
      <StatusBar style="light" />
    </View>
  );
}

function Action({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, primary && styles.buttonPrimary, disabled && styles.buttonDisabled]}><Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text></Pressable>;
}

function ConfigField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.field}><Text>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, backgroundColor: colors.background },
  loading: { alignItems: 'center', gap: 16, paddingVertical: 50 },
  content: { padding: 18, paddingBottom: 24, gap: 12 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#174b32', marginTop: 12 },
  card: { backgroundColor: 'white', borderRadius: 12, padding: 15, gap: 7 },
  cardTitle: { fontWeight: '700', color: '#174b32', fontSize: 16 },
  helper: { color: '#607169', fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  button: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#e0ebe3', alignSelf: 'flex-start' },
  buttonPrimary: { backgroundColor: '#25734b' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#174b32', fontWeight: '600' },
  buttonTextPrimary: { color: 'white' },
  input: { borderWidth: 1, borderColor: '#bfcec3', borderRadius: 8, padding: 11, backgroundColor: 'white', minWidth: 100 },
  field: { gap: 4, marginBottom: 8 },
  error: { color: '#a52424', backgroundColor: '#ffe9e9', padding: 10, borderRadius: 8 },
  notice: { color: '#174b32', backgroundColor: '#dff1e3', padding: 10, borderRadius: 8 },
});
