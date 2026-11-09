import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DeviceHistory } from '../../../api/src/contracts';
import { dateLabel, historyRows, sensors, type HistoryCategory, type HistoryPeriod, type HistoryRow, type SensorKey } from '../activityModel';
import { EmptyActivity, FilterChip, RecordSheet, activityStyles as s } from './ActivityComponents';
import { Icon, type IconName } from './Icon';
import { colors } from './theme';

const categories: { id: HistoryCategory; label: string; description: string; icon: IconName }[] = [
  { id: 'readings', label: 'Leituras', description: 'Sensores e reservatório', icon: 'temperature' },
  { id: 'B1', label: 'Irrigação · B1', description: 'Acionamentos e comandos', icon: 'plant' },
  { id: 'B2', label: 'Névoa · B2', description: 'Acionamentos e comandos', icon: 'sprinkler' },
  { id: 'alerts', label: 'Alertas', description: 'Ativos e resolvidos', icon: 'bell' },
  { id: 'configuration', label: 'Configurações', description: 'Versões aplicadas', icon: 'settings' },
  { id: 'system', label: 'Sistema', description: 'Cenários e simulação', icon: 'history' },
];
interface Props { data: DeviceHistory | null; clock: number; timeZone: string; connected: boolean; persistent?:boolean }
export function HistoryScreen({ data, clock, timeZone, connected, persistent }: Props) {
  const [category, setCategory] = useState<HistoryCategory | null>(null);
  const [sensor, setSensor] = useState<SensorKey>('airTemperatureC');
  const [period, setPeriod] = useState<HistoryPeriod>('all');
  const [limit, setLimit] = useState(20);
  const [selected, setSelected] = useState<HistoryRow | null>(null);
  const definition = categories.find(c => c.id === category);
  const rows = data && category ? historyRows(data, category, sensor, period, clock, timeZone) : [];
  let previousDate = '';
  return <View style={s.screen}>
    {!connected && <Text style={s.warning}>Sem conexão. Exibindo os últimos registros carregados.</Text>}
    {!category ? <>
      <Text style={s.helper}>Escolha o histórico que deseja consultar.</Text>
      <View style={styles.grid}>{categories.map(item => <Pressable key={item.id} onPress={() => { setCategory(item.id); setLimit(20); }} accessibilityRole="button" style={({ pressed }) => [styles.category, pressed && { opacity: .7 }]}>
        <Icon name={item.icon} size={29} /><Text style={styles.categoryTitle}>{item.label}</Text><Text style={s.helper}>{item.description}</Text>
      </Pressable>)}</View>
    </> : <>
      <Pressable accessibilityRole="button" style={styles.back} onPress={() => { setCategory(null); setSelected(null); }}><Text style={s.link}>‹ Todos os históricos</Text></Pressable>
      <View style={s.row}><Icon name={definition!.icon} /><Text style={s.title} accessibilityRole="header">{definition!.label}</Text></View>
      {category === 'readings' && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>{sensors.map(item => <FilterChip key={item.key} label={item.label} selected={sensor === item.key} onPress={() => { setSensor(item.key); setLimit(20); }} />)}</ScrollView>}
      <View style={styles.filters}>{([['all', 'Tudo'], ['hour', 'Última hora'], ['today', 'Hoje']] as const).map(([id, label]) => <FilterChip key={id} label={label} selected={period === id} onPress={() => { setPeriod(id); setLimit(20); }} />)}</View>
      {category === 'alerts' && <Text style={s.helper}>Inclui alertas ativos durante o período, mesmo que tenham começado antes dele.</Text>}
      {!data ? <ActivityIndicator color={colors.green} /> : <>
        <Text style={s.helper}>{rows.length} registro(s) · mais recentes primeiro</Text>
        {rows.length === 0 && <EmptyActivity title="Nenhum registro neste período" text="Escolha outro período ou gere novos registros na simulação." />}
        {rows.slice(0, limit).map(row => {
          const day = dateLabel(row.time, timeZone, false);
          const showDate = day !== previousDate; previousDate = day;
          return <View key={row.id} style={{ gap: 9 }}>
            {showDate && <Text style={styles.date}>{day}</Text>}
            <Pressable onPress={() => setSelected(row)} accessibilityRole="button" accessibilityLabel={`${row.title}. ${row.summary}. ${dateLabel(row.time, timeZone)}. Ver detalhes.`} style={s.card}>
              <View style={s.row}><Text style={[s.helper, { flex: 1 }]}>{row.summary}{row.state ? ` · ${row.state}` : ''}</Text><Text style={s.helper}>{new Date(row.time).toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text></View>
              <View style={s.row}><Text style={[styles.recordTitle, { flex: 1 }]} numberOfLines={2}>{row.title}</Text><Icon name="chevron" size={15} /></View>
            </Pressable>
          </View>;
        })}
        {rows.length > limit && <Pressable accessibilityRole="button" style={s.button} onPress={() => setLimit(value => value + 20)}><Text style={s.buttonText}>Mostrar mais registros</Text></Pressable>}
      </>}
    </>}
    <Text style={[s.helper, { textAlign: 'center' }]}>{persistent ? 'Histórico persistido · até 500 registros recentes por categoria.' : 'Simulação · histórico temporário. Reiniciar o simulador apaga os registros.'}</Text>
    {selected && <RecordSheet title="Detalhes do registro" fields={selected.details} onClose={() => setSelected(null)} />}
  </View>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  category: { flexBasis: '45%', flexGrow: 1, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 16, gap: 9, minHeight: 142 },
  categoryTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' }, recordTitle: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, back: { minHeight: 38, justifyContent: 'center', alignSelf: 'flex-start' },
  date: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 6 },
});
