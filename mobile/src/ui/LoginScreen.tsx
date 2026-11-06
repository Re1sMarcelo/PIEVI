import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { BotanicalArt, LoginWave, StrawberryLogo } from './Illustrations';
import { cardShadow, colors } from './theme';

interface Props {
  username: string;
  password: string;
  busy: boolean;
  error: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function LoginScreen(props: Props) {
  const insets = useSafeAreaInsets();
  const passwordInput = useRef<TextInputInstance>(null);
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState<'username' | 'password' | null>(null);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#c3233b', '#d11f37']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.banner, { height: 90 + insets.top }]}>
          <View style={styles.botanical} pointerEvents="none"><BotanicalArt width={220} height={190} opacity={0.65} /></View>
          <View style={styles.wave}><LoginWave /></View>
        </LinearGradient>

        <View style={styles.brand}>
          <StrawberryLogo size={92} />
          <Text style={styles.brandTitle} accessibilityRole="header">Cultivo Inteligente</Text>
          <Text style={styles.brandSubtitle}>Manejo hídrico de morangos</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading} accessibilityRole="header">Bem-vindo de volta</Text>
          <Text style={styles.subtitle}>Acesse o monitoramento da estufa</Text>

          <Text style={styles.label} nativeID="username-label">Usuário ou e-mail</Text>
          <View style={[styles.inputWrap, focused === 'username' && styles.inputFocused]}>
            <Icon name="mail" size={21} color="#788691" />
            <TextInput
              style={styles.input} value={props.username} onChangeText={props.onUsernameChange}
              placeholder="Seu usuário ou e-mail" placeholderTextColor="#909da8" autoCapitalize="none"
              keyboardType="email-address" maxLength={254}
              autoCorrect={false} autoComplete="username" textContentType="username"
              accessibilityLabel="Usuário ou e-mail" editable={!props.busy} returnKeyType="next"
              onSubmitEditing={() => passwordInput.current?.focus()}
              onFocus={() => setFocused('username')} onBlur={() => setFocused(null)}
            />
          </View>

          <Text style={styles.label} nativeID="password-label">Senha</Text>
          <View style={[styles.inputWrap, focused === 'password' && styles.inputFocused]}>
            <Icon name="lock" size={21} color="#788691" />
            <TextInput
              ref={passwordInput} style={styles.input} value={props.password} onChangeText={props.onPasswordChange}
              placeholder="Sua senha" placeholderTextColor="#909da8" secureTextEntry={!visible}
              autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password"
              accessibilityLabel="Senha" editable={!props.busy} returnKeyType="go" onSubmitEditing={props.onSubmit}
              onFocus={() => setFocused('password')} onBlur={() => setFocused(null)}
            />
            <Pressable style={styles.eye} onPress={() => setVisible(!visible)} accessibilityRole="button" accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'} hitSlop={5}>
              <Icon name={visible ? 'eyeOff' : 'eye'} size={22} color="#788691" />
            </Pressable>
          </View>

          <Pressable style={styles.forgot} accessibilityRole="button" onPress={() => Alert.alert('Recuperar acesso', 'Solicite ao responsável pela estufa a redefinição das suas credenciais.')}>
            <Text style={styles.link}>Esqueceu a senha?</Text>
          </Pressable>

          {!!props.error && <Text style={styles.error} accessibilityRole="alert">{props.error}</Text>}

          <Pressable onPress={props.onSubmit} disabled={props.busy} accessibilityRole="button" accessibilityLabel="Entrar" accessibilityState={{ busy: props.busy, disabled: props.busy }} style={({ pressed }) => [styles.submit, (pressed || props.busy) && { opacity: 0.78 }]}>
            <LinearGradient colors={['#32944e', '#258344']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submitFill}>
              {props.busy && <ActivityIndicator color="white" size="small" />}
              <Text style={styles.submitText}>{props.busy ? 'Entrando…' : 'Entrar'}</Text>
            </LinearGradient>
          </Pressable>

          <View style={styles.signupRow}>
            <View style={styles.rule} />
            <View style={styles.signupTextWrap}>
              <Text style={styles.signupText}>Ainda não tem uma conta? </Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => Alert.alert('Solicitar acesso', 'Este protótipo utiliza um operador com cadastro controlado. Solicite acesso ao responsável pela estufa.')}><Text style={styles.signupLink}>Cadastre-se</Text></Pressable>
            </View>
            <View style={styles.rule} />
          </View>
        </View>

        <Text style={styles.footer}>Sistema IoT · Cultivo semi-hidropônico</Text>
      </ScrollView>
      <StatusBar style="light" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  banner: { overflow: 'hidden', width: '100%' },
  botanical: { position: 'absolute', right: -8, top: 8, transform: [{ rotate: '-12deg' }] },
  wave: { position: 'absolute', bottom: -1, left: 0, right: 0 },
  brand: { alignItems: 'center', paddingTop: 4, paddingBottom: 24, paddingHorizontal: 12 },
  brandTitle: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.9, marginTop: 10 },
  brandSubtitle: { color: '#637d7e', fontSize: 16, marginTop: 4 },
  card: { marginHorizontal: 22, padding: 22, backgroundColor: '#ffffff', borderRadius: 20, ...cardShadow },
  heading: { color: colors.ink, fontSize: 24, letterSpacing: -0.65, fontWeight: '700' },
  subtitle: { color: '#637d7e', fontSize: 14, marginTop: 6, marginBottom: 10, lineHeight: 21 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 17, marginBottom: 7 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d3d8dd', borderRadius: 9, backgroundColor: '#fdfdfd', paddingLeft: 13, minHeight: 47 },
  inputFocused: { borderColor: colors.green, backgroundColor: '#fbfefb' },
  input: { color: colors.ink, fontSize: 16, paddingVertical: 12, paddingLeft: 13, paddingRight: 9, flex: 1, minWidth: 0 },
  eye: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  forgot: { alignSelf: 'flex-end', paddingTop: 10, paddingBottom: 14, minHeight: 44, justifyContent: 'center' },
  link: { color: colors.red, fontSize: 13, textDecorationLine: 'underline', fontWeight: '500' },
  error: { color: '#aa1d32', backgroundColor: '#fff0f2', borderRadius: 8, fontSize: 13, lineHeight: 19, padding: 11, marginBottom: 12 },
  submit: { borderRadius: 10, overflow: 'hidden', marginTop: 4, shadowColor: colors.greenDark, shadowOpacity: 0.12, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8 },
  submitFill: { minHeight: 48, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 9 },
  submitText: { color: 'white', fontSize: 17, fontWeight: '700' },
  signupRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 24, marginBottom: 3 },
  rule: { flex: 1, height: 1, backgroundColor: '#d4dbdc', minWidth: 10 },
  signupTextWrap: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', flexShrink: 1 },
  signupText: { fontSize: 12, color: colors.ink, lineHeight: 20 },
  signupLink: { fontSize: 12, color: colors.red, fontWeight: '600', lineHeight: 20 },
  footer: { textAlign: 'center', color: '#819294', fontSize: 11, paddingTop: 24, paddingBottom: 12 },
});
