import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Snapshot } from '../../../api/src/contracts';
import { BotanicalArt } from './Illustrations';
import { Icon, type IconName } from './Icon';
import { colors } from './theme';
import { hasRecentState } from '../dashboardModel';

export type Tab = 'Painel' | 'Histórico' | 'Alertas' | 'Controle';
const tabs: { label: Tab; icon: IconName }[] = [
  { label: 'Painel', icon: 'home' }, { label: 'Controle', icon: 'controls' },
  { label: 'Histórico', icon: 'history' }, { label: 'Alertas', icon: 'bell' },
];
const titles: Record<Tab, string> = { Painel: 'Painel da estufa', Controle: 'Controle', Histórico: 'Histórico', Alertas: 'Alertas' };

export function PageHeader({ tab, snapshot, connected, onLogout }: { tab: Tab; snapshot: Snapshot | null; connected: boolean; onLogout: () => void }) {
  const insets = useSafeAreaInsets();
  const online = !!snapshot && hasRecentState(snapshot, connected, Date.now() + snapshot.simulationClockOffsetMs);
  const updated = snapshot ? new Date(snapshot.telemetry.occurredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <LinearGradient colors={['#c52039', '#d11e35']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 9 }]}>
      <View style={[styles.botanical, { top: insets.top - 10 }]} pointerEvents="none"><BotanicalArt width={210} height={210} opacity={0.27} /></View>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">{titles[tab]}</Text>
        <Pressable style={({ pressed }) => [styles.logout, pressed && { backgroundColor: '#ffffff30' }]} onPress={onLogout} accessibilityRole="button" accessibilityLabel="Sair da conta"><Icon name="logout" size={20} color="white" /></Pressable>
      </View>
      <Text style={styles.subtitle}>Cultivo de morangos · {snapshot?.mode==='mqtt-virtual' ? 'ESP virtual via MQTT' : snapshot?.mode==='mqtt' ? 'estufa conectada' : 'simulação local'}</Text>
      {tab === 'Painel' && <View style={styles.statusRow}>
        <View style={styles.statusBadge}>
          <View style={[styles.dot, { backgroundColor: online ? '#299c43' : '#b6434b' }]} />
          <Text style={styles.statusText}>{!connected ? 'API sem conexão' : !snapshot ? 'Conectando…' : !snapshot.online ? 'Dispositivo offline' : online ? snapshot.mode && snapshot.mode!=='simulator' ? 'ESP online · MQTT' : 'Simulador online' : 'Dados desatualizados'}</Text>
        </View>
        <Text style={styles.updated}>Atualizado às {updated}</Text>
      </View>}
    </LinearGradient>
  );
}

export function BottomNavigation({ current, onChange, alertCount }: { current: Tab; onChange: (tab: Tab) => void; alertCount: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.navigation, { paddingBottom: Math.max(insets.bottom, 9) }]}>
      {tabs.map(({ label, icon }) => {
        const selected = current === label;
        const color = selected ? colors.red : '#6c7275';
        return <Pressable key={label} style={styles.navItem} onPress={() => onChange(label)} accessibilityRole="tab" accessibilityLabel={label === 'Alertas' && alertCount ? `Alertas, ${alertCount} ativos` : label} accessibilityState={{ selected }}>
          <View><Icon name={icon} size={24} color={color} />{label === 'Alertas' && alertCount > 0 && <View style={styles.alertBadge}><Text style={styles.alertBadgeText}>{alertCount > 9 ? '9+' : alertCount}</Text></View>}</View>
          <Text style={[styles.navLabel, { color }, selected && { fontWeight: '600' }]}>{label}</Text>
          <View style={[styles.activeLine, selected && { backgroundColor: colors.red }]} />
        </Pressable>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 14, overflow: 'hidden' },
  botanical: { position: 'absolute', right: -24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 27, lineHeight: 34, fontWeight: '700', color: 'white', letterSpacing: -0.7, flex: 1 },
  logout: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#ffffff16' },
  subtitle: { fontSize: 16, color: '#ffe5e4', marginTop: 3 },
  statusRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f9d8d4', borderRadius: 24, paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { color: colors.ink, fontWeight: '600', fontSize: 12 },
  updated: { color: '#fff4f2', fontSize: 11 },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e8e5e2', backgroundColor: '#fffdfa', paddingTop: 7 },
  navItem: { flex: 1, minHeight: 54, alignItems: 'center', gap: 4, paddingTop: 2 },
  navLabel: { fontSize: 11 },
  activeLine: { height: 3, width: 55, borderRadius: 3, marginTop: 3, backgroundColor: 'transparent' },
  alertBadge: { position: 'absolute', right: -9, top: -3, backgroundColor: colors.red, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#fffdfa' },
  alertBadgeText: { fontSize: 9, color: 'white', fontWeight: '700' },
});
