import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Snapshot } from '../../../api/src/contracts';
import { alertDetails, dateLabel, severityLabel, sortedActiveAlerts } from '../activityModel';
import { hasRecentState } from '../dashboardModel';
import { EmptyActivity, RecordSheet, activityStyles as s } from './ActivityComponents';
import { Icon } from './Icon';
import { colors } from './theme';

interface Props { snapshot: Snapshot; connected: boolean; clock: number; busy: boolean; feedback: string; onAcknowledge: (id: string) => Promise<void> }
export function AlertsScreen({ snapshot, connected, clock, busy, feedback, onAcknowledge }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const alerts = sortedActiveAlerts(snapshot.activeAlerts);
  const selected = alerts.find(a => a.id === selectedId);
  const fresh = hasRecentState(snapshot, connected, clock);
  const critical = alerts.filter(a => a.severity === 'critical').length;
  return <View style={s.screen}>
    {!fresh && <Text style={s.warning}>Sem dados recentes. Os alertas abaixo refletem a última atualização; novas condições podem não ter sido recebidas.</Text>}
    {alerts.length > 0 && <Text style={s.helper}>{alerts.length} alerta(s) ativo(s){critical ? ` · ${critical} crítico(s)` : ''} · prioridade mais alta primeiro</Text>}
    {alerts.length === 0 && <EmptyActivity icon={fresh ? 'check' : 'info'} title={fresh ? 'Nenhum alerta ativo' : 'Sem alertas na última atualização'} text={fresh ? 'As condições monitoradas estão sem alertas no momento.' : 'Aguarde a reconexão para conferir as condições atuais.'} />}
    {alerts.map(alert => {
      const color = alert.severity === 'critical' ? colors.red : alert.severity === 'warning' ? '#98651a' : colors.greenDark;
      return <Pressable key={alert.id} accessibilityRole="button" accessibilityLabel={`${severityLabel[alert.severity]}. ${alert.title}. ${alert.acknowledgedAt ? 'Reconhecido' : 'Não reconhecido'}. Ver orientação.`} onPress={() => setSelectedId(alert.id)} style={[s.card, { borderLeftWidth: 4, borderLeftColor: color }]}>
        <View style={s.row}><Icon name={alert.severity === 'info' ? 'info' : 'warning'} color={color} size={19} /><Text style={[styles.priority, { color }]}>{severityLabel[alert.severity]}</Text><Text style={[s.helper, { flex: 1, textAlign: 'right' }]}>{alert.acknowledgedAt ? 'Reconhecido' : 'Novo'}</Text></View>
        <Text style={styles.alertTitle}>{alert.title}</Text><Text style={s.helper} numberOfLines={2}>{alert.suggestedAction}</Text>
        <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={s.helper}>Desde {dateLabel(alert.startedAt, snapshot.timeZone)}</Text><Text style={s.link}>Ver orientação ›</Text></View>
      </Pressable>;
    })}
    {selected && <RecordSheet title={selected.title} fields={alertDetails(selected, snapshot.timeZone)} onClose={() => setSelectedId(null)}>
      <Text style={s.helper}>Reconhecer registra que você viu o alerta. Ele sai desta tela quando a condição é resolvida.</Text>
      {!selected.acknowledgedAt && <Pressable accessibilityRole="button" disabled={busy || !connected} onPress={() => { void onAcknowledge(selected.id); }} style={[s.button, (busy || !connected) && s.disabled]}>{busy ? <ActivityIndicator color="white" /> : <Text style={s.buttonText}>Reconhecer alerta</Text>}</Pressable>}
      {!!feedback && <Text style={s.helper} accessibilityRole="alert">{feedback}</Text>}
    </RecordSheet>}
  </View>;
}
const styles = StyleSheet.create({
  alertTitle: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '700' }, priority: { fontSize: 12, fontWeight: '700' },
});
