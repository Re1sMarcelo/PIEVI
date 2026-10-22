import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const tokenKey = 'pievi-session-token';
// The browser preview keeps its token in memory; mobile persists in SecureStore.
let browserToken: string | null = null;

export const sessionStore = {
  get: () => Platform.OS === 'web' ? Promise.resolve(browserToken) : SecureStore.getItemAsync(tokenKey),
  set: async (token: string) => {
    if (Platform.OS === 'web') browserToken = token;
    else await SecureStore.setItemAsync(tokenKey, token);
  },
  clear: async () => {
    if (Platform.OS === 'web') browserToken = null;
    else await SecureStore.deleteItemAsync(tokenKey);
  },
};
