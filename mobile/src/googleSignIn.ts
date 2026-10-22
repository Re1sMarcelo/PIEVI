import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

export function googleUnavailableReason(): string | null {
  if(Constants.executionEnvironment===ExecutionEnvironment.StoreClient) return 'O login Google requer a versão de desenvolvimento do PIEVI. No Expo Go, use o login demo ou usuário e senha.';
  if(Platform.OS!=='android') return 'O login Google desta entrega está preparado para teste na versão de desenvolvimento Android.';
  if(!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim()) return 'Configure EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID antes de testar o Google. Consulte o guia Android.';
  return null;
}

export async function signInWithGoogle(nonce:string):Promise<string|null> {
  const unavailable=googleUnavailableReason(); if(unavailable) throw new Error(unavailable);
  // Só avaliar o módulo nativo após conferir o ambiente: preserva o modo Expo Go.
  let native:typeof import('react-native-nitro-google-signin');
  try { native=require('react-native-nitro-google-signin'); }
  catch { throw new Error('A versão instalada não contém o módulo Google. Gere e instale novamente a development build Android.'); }
  try {
    native.GoogleOneTapSignIn.configure({webClientId:process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!.trim(),nonce,offlineAccess:false});
    await native.GoogleOneTapSignIn.checkPlayServices();
    const result=await native.GoogleOneTapSignIn.presentExplicitSignIn();
    if(native.isSuccessResponse(result)) return result.data.idToken;
    if(native.isCancelledResponse(result)) return null;
    throw new Error('Nenhuma conta Google selecionada.');
  } catch(error) {
    const code=(error as {code?:string}).code;
    if(code==='SIGN_IN_CANCELLED') return null;
    if(code==='DEVELOPER_ERROR') throw new Error('Configuração Google inválida. Confira o cliente Web, o package Android e o SHA-1 do APK no guia.');
    if(code==='PLAY_SERVICES_NOT_AVAILABLE') throw new Error('Atualize ou habilite o Google Play Services neste Android.');
    throw new Error('Não foi possível entrar com Google. Confira as credenciais, a conexão e a development build instalada.');
  }
}
