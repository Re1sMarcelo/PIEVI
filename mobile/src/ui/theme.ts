import { Platform } from 'react-native';

export const colors = {
  ink: '#062e2b',
  green: '#288b46',
  greenDark: '#0b5131',
  red: '#cd2037',
  muted: '#687c7c',
  background: '#fffcfa',
  line: '#e8e9e5',
};

export const cardShadow = Platform.select({
  ios: { shadowColor: '#3b3325', shadowOpacity: 0.065, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12 },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 20px rgba(59, 51, 37, 0.06)' },
});
