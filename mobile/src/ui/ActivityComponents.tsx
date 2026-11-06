import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DetailField } from '../activityModel';
import { Icon, type IconName } from './Icon';
import { colors } from './theme';

export function EmptyActivity({ title, text, icon = 'history' }: { title: string; text: string; icon?: IconName }) {
  return <View style={activityStyles.empty}><Icon name={icon} size={34} /><Text style={activityStyles.title}>{title}</Text><Text style={[activityStyles.helper, { textAlign: 'center' }]}>{text}</Text></View>;
}
export function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[activityStyles.chip, selected && activityStyles.selectedChip]}><Text style={[activityStyles.chipText, selected && { color: 'white' }]}>{label}</Text></Pressable>;
}
export function RecordSheet({ title, fields, onClose, children }: { title: string; fields: DetailField[]; onClose: () => void; children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <Modal transparent visible animationType="slide" onRequestClose={onClose}>
    <View style={activityStyles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar detalhes" />
      <View style={[activityStyles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 17 }}>
        <View style={activityStyles.row}><Text style={[activityStyles.title, { flex: 1 }]} accessibilityRole="header">{title}</Text><Pressable onPress={onClose} accessibilityRole="button" style={activityStyles.close}><Text style={activityStyles.link}>Fechar</Text></Pressable></View>
        {fields.map(field => <View key={field.label} style={{ gap: 4 }}><Text style={activityStyles.helper}>{field.label}</Text><Text style={activityStyles.body}>{field.value}</Text></View>)}
        {children}
      </ScrollView></View>
    </View>
  </Modal>;
}
export const activityStyles = StyleSheet.create({
  screen: { gap: 14 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '700' }, body: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 }, link: { color: colors.greenDark, fontWeight: '700', fontSize: 13 },
  chip: { paddingHorizontal: 14, minHeight: 42, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: 'white', justifyContent: 'center' }, selectedChip: { backgroundColor: colors.greenDark, borderColor: colors.greenDark }, chipText: { color: colors.greenDark, fontSize: 12, fontWeight: '600' },
  card: { padding: 16, borderRadius: 16, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20, gap: 12 },
  overlay: { flex: 1, backgroundColor: '#00000070', justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.background, padding: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  close: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  button: { minHeight: 48, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenDark }, buttonText: { color: 'white', fontSize: 14, fontWeight: '700' },
  warning: { backgroundColor: '#fff1dc', color: '#77501c', padding: 12, borderRadius: 12, fontSize: 12, lineHeight: 18 }, disabled: { opacity: .5 },
});
