import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type {
  CommandAction,
  Config,
  DeviceHistory,
  PumpId,
  Snapshot,
  SimulationScenario,
} from '../api/src/contracts';
import { ApiError, api } from './src/api';
import { sessionStore } from './src/sessionStore';
import { Dashboard } from './src/ui/Dashboard';
import { ControlScreen } from './src/ui/ControlScreen';
import { HistoryScreen } from './src/ui/HistoryScreen';
import { AlertsScreen } from './src/ui/AlertsScreen';
import { StrawberryLogo } from './src/ui/Illustrations';
import { LoginScreen } from './src/ui/LoginScreen';
import { BottomNavigation, PageHeader, type Tab } from './src/ui/Navigation';
import { colors } from './src/ui/theme';

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
  const [history, setHistory] = useState<DeviceHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const scrollView = useRef<ScrollViewInstance>(null);
  const activeSession = useRef<string | null>(null);
  const refreshInFlight = useRef(false);
  const refreshRevision = useRef(0);
  const mutationInFlight = useRef(false);
  const deviceClock = clock + (snapshot?.simulationClockOffsetMs ?? 0);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  function navigate(nextTab: Tab) {
    setTab(nextTab);
    scrollView.current?.scrollTo({ y: 0, animated: false });
  }

  useEffect(() => {
    let cancelled = false;
    sessionStore.get()
      .then(async (savedToken) => {
        if (!savedToken) return;
        const initialSnapshot = await api.snapshot(savedToken);
        if (cancelled) return;
        activeSession.current = savedToken;
        setSnapshot(initialSnapshot);
        setToken(savedToken);
      })
      .catch(async (caught) => {
        if (caught instanceof ApiError && caught.status === 401) await sessionStore.clear().catch(() => undefined);
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Não foi possível recuperar a sessão.');
      })
      .finally(() => { if (!cancelled) setRestoring(false); });
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const refresh = useCallback(async (activeToken: string) => {
    if (refreshInFlight.current || activeSession.current !== activeToken) return;
    refreshInFlight.current = true;
    const revision = refreshRevision.current;
    try {
      const [nextSnapshot, nextHistory] = await Promise.all([
        api.snapshot(activeToken), api.history(activeToken),
      ]);
      if (activeSession.current !== activeToken || revision !== refreshRevision.current) return;
      setSnapshot(nextSnapshot);
      setHistory(nextHistory);
      setConnected(true);
      setError('');
    } catch (caught) {
      if (activeSession.current !== activeToken || revision !== refreshRevision.current) return;
      setConnected(false);
      if (caught instanceof ApiError && caught.status === 401) {
        activeSession.current = null;
        setToken(null);
        setSnapshot(null);
        setHistory(null);
        await sessionStore.clear().catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar dados.');
    } finally {
      refreshInFlight.current = false;
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
      activeSession.current = session.token;
      setToken(session.token);
      setPassword('');
      setNotice('');
      navigate('Painel');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha no login.');
    } finally { setBusy(false); }
  }

  async function logout() {
    const previousToken = activeSession.current;
    activeSession.current = null;
    setToken(null);
    setSnapshot(null);
    setHistory(null);
    setError('');
    setNotice('');
    await sessionStore.clear();
    if (previousToken) void api.logout(previousToken).catch(() => undefined);
  }

  async function sendCommand(pumpId: PumpId, action: CommandAction, requestedDuration?: number, supervisionConfirmed?: boolean) {
    if (!token || mutationInFlight.current) return false;
    mutationInFlight.current = true;
    refreshRevision.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const duration = requestedDuration ?? (action === 'MANUAL_ON' ? (pumpId === 'B1' ? snapshot?.config.manualIrrigationSeconds ?? 120 : snapshot?.config.manualFogSeconds ?? 30) : undefined);
      const result=await api.command(token, pumpId, action, duration, supervisionConfirmed, snapshot?.simulationClockOffsetMs ?? 0);
      if (activeSession.current !== token) return false;
      refreshRevision.current++;
      const observed = await api.snapshot(token);
      if (activeSession.current !== token) return false;
      setSnapshot(observed);
      // The live actuator card is the command feedback; avoid leaving a stale global toast on screen.
      setNotice(observed.mode && observed.mode!=='simulator' && result.status==='accepted' ? 'Comando aceito pelo ESP. O estado da saída será atualizado após a confirmação.' : '');
      await refresh(token);
      return true;
    } catch (caught) {
      if (activeSession.current === token) setError(caught instanceof Error ? caught.message : 'Comando não executado.');
      return false;
    } finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function changeScenario(scenario: SimulationScenario) {
    if (!token || mutationInFlight.current) return;
    mutationInFlight.current = true;
    refreshRevision.current++;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await api.simulation(token, scenario);
      if (activeSession.current !== token) return;
      refreshRevision.current++;
      setSnapshot(next);
      setNotice(next.mode==='mqtt-virtual' ? 'Cenário enviado ao ESP virtual. Aguarde as novas leituras pelo MQTT.' : 'Cenário aplicado à bancada simulada. B1 e B2 retornaram para AUTO.');
      await refresh(token);
    } catch (caught) {
      if (activeSession.current === token) setError(caught instanceof Error ? caught.message : 'Não foi possível aplicar o cenário.');
    } finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function advanceSimulation(seconds: number) {
    if (!token || mutationInFlight.current) return;
    mutationInFlight.current = true; refreshRevision.current++;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await api.advanceSimulation(token, seconds);
      if (activeSession.current !== token) return;
      refreshRevision.current++; setSnapshot(next);
      setNotice(`Relógio da simulação avançado em ${seconds} s. Confira os estados e eventos.`);
      await refresh(token);
    } catch (caught) {
      if (activeSession.current === token) setError(caught instanceof Error ? caught.message : 'Falha ao avançar simulação.');
    } finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function saveConfig(config: Config, expectedVersion: number) {
    if (!token || mutationInFlight.current) return false;
    mutationInFlight.current = true; refreshRevision.current++;
    setBusy(true); setError(''); setNotice('');
    let applied = false;
    try {
      await api.updateConfig(token, config, expectedVersion);
      applied = true;
      if (activeSession.current !== token) return false;
      refreshRevision.current++;
      const observed = await api.snapshot(token);
      if (activeSession.current !== token) return false;
      setSnapshot(observed);
      setNotice(`Configuração v${observed.configVersion} confirmada e aplicada pelo ${observed.mode && observed.mode!=='simulator' ? 'ESP' : 'simulador'}.`);
      await refresh(token);
      return true;
    } catch (caught) {
      if (activeSession.current === token) {
        if (caught instanceof ApiError && caught.status === 409) {
          try { const latest = await api.snapshot(token); if (activeSession.current === token) setSnapshot(latest); } catch { /* Keep the draft when the server is unavailable. */ }
        }
        setError(applied ? 'O simulador confirmou a configuração, mas a consulta do estado falhou. Atualize para conferir a versão antes de reenviar.' : caught instanceof Error ? caught.message : 'Falha ao salvar configuração.');
      }
      return false;
    } finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function acknowledge(id: string) {
    if (!token || mutationInFlight.current) return;
    mutationInFlight.current = true;
    refreshRevision.current++;
    setBusy(true); setError(''); setNotice('');
    try {
      const acknowledged = await api.acknowledge(token, id);
      if (activeSession.current !== token) return;
      setHistory(current => current && ({ ...current, alerts: current.alerts.map(alert => alert.id === id ? acknowledged : alert) }));
      refreshRevision.current++;
      const observed = await api.snapshot(token);
      if (activeSession.current !== token) return;
      setSnapshot(observed);
      setNotice('Alerta reconhecido. A condição permanece ativa até ser resolvida.');
      await refresh(token);
    } catch (caught) { if (activeSession.current === token) setError(caught instanceof Error ? caught.message : 'Falha ao reconhecer alerta.'); }
    finally { mutationInFlight.current = false; setBusy(false); }
  }

  if (restoring) return <View style={styles.center}><StrawberryLogo size={82} /><ActivityIndicator color={colors.green} size="large" /><StatusBar style="dark" /></View>;

  if (!token) return (
    <LoginScreen username={username} password={password} busy={busy} error={error} onUsernameChange={setUsername} onPasswordChange={setPassword} onSubmit={login} />
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
        {!snapshot && <View style={styles.loading}>{!error && <ActivityIndicator size="large" color={colors.green} />}<Text style={styles.helper}>{error ? 'Não foi possível carregar sua estufa.' : 'Carregando sua estufa…'}</Text>{!!error && <Action label="Tentar novamente" onPress={() => { void refresh(token); }} />}</View>}
        {snapshot && tab === 'Painel' && <Dashboard snapshot={snapshot} connected={connected} clock={deviceClock} telemetry={history?.telemetry ?? []} busy={busy} feedback={error || notice} onNavigate={navigate} onCommand={sendCommand} onAcknowledge={acknowledge} />}
        {snapshot && tab === 'Histórico' && <HistoryScreen data={history} clock={deviceClock} timeZone={snapshot.timeZone} connected={connected} persistent={!!snapshot.mode && snapshot.mode!=='simulator'} />}
        {snapshot && tab === 'Alertas' && <AlertsScreen snapshot={snapshot} connected={connected} clock={deviceClock} busy={busy} feedback={error || notice} onAcknowledge={acknowledge} />}
        {snapshot && <View style={tab === 'Controle' ? undefined : { display: 'none' }}><ControlScreen snapshot={snapshot} connected={connected} clock={deviceClock} busy={busy} active={tab === 'Controle'} feedback={error || notice} onCommand={sendCommand} onSave={saveConfig} onScenario={changeScenario} onAdvance={advanceSimulation} /></View>}
      </ScrollView>
      <BottomNavigation current={tab} onChange={navigate} alertCount={snapshot?.activeAlerts.length ?? 0} />
      <StatusBar style="light" />
    </View>
  );
}

function Action({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, primary && styles.buttonPrimary, disabled && styles.buttonDisabled]}><Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, backgroundColor: colors.background },
  loading: { alignItems: 'center', gap: 16, paddingVertical: 50 },
  content: { padding: 18, paddingBottom: 24, gap: 12 },
  helper: { color: '#607169', fontSize: 12 },
  button: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#e0ebe3', alignSelf: 'flex-start' },
  buttonPrimary: { backgroundColor: '#25734b' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#174b32', fontWeight: '600' },
  buttonTextPrimary: { color: 'white' },
  error: { color: '#a52424', backgroundColor: '#ffe9e9', padding: 10, borderRadius: 8 },
  notice: { color: '#174b32', backgroundColor: '#dff1e3', padding: 10, borderRadius: 8 },
});
