import { existsSync } from 'node:fs';
import { emitKeypressEvents, type Key } from 'node:readline';
import { createInterface as createQuestions } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createDatabasePool } from '../src/database.js';
import { hashPassword, isPasswordHash } from '../src/auth/password.js';
import { DEVICE_ID } from '../src/simulator.js';

if (existsSync('.env')) process.loadEnvFile('.env');

function hiddenQuestion(prompt: string): Promise<string> {
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  const previousRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text: string, key: Key) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('Provisionamento cancelado.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') {
        if (value.length) { value = Array.from(value).slice(0, -1).join(''); stdout.write('\b \b'); }
      } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        value += text; stdout.write('*');
      }
    };
    stdin.on('keypress', onKey);
  });
}

async function credentials() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--from-env') || args.length > 1) {
    throw new Error('Use sem argumentos ou --from-env.');
  }
  if (args.includes('--from-env')) {
    const username = process.env.OPERATOR_USERNAME?.trim() ?? '';
    const passwordHash = process.env.OPERATOR_PASSWORD_HASH ?? '';
    if (!isPasswordHash(passwordHash)) throw new Error('Configure OPERATOR_PASSWORD_HASH com o hash gerado pelo backend.');
    return { username, name: process.env.OPERATOR_NAME?.trim() || username, email: process.env.OPERATOR_EMAIL?.trim().toLowerCase() || null, passwordHash };
  }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Execute em terminal interativo ou configure as credenciais e use --from-env.');
  const questions = createQuestions({ input: stdin, output: stdout });
  let username: string;
  let name: string;
  let email: string | null;
  try {
    username = (await questions.question('Usuário do operador: ')).trim();
    name = (await questions.question('Nome (Enter para usar o usuário): ')).trim() || username;
    email = (await questions.question('E-mail para login (opcional): ')).trim().toLowerCase() || null;
  } finally { questions.close(); }
  const password = await hiddenQuestion('Senha (mínimo 12 caracteres): ');
  const confirmation = await hiddenQuestion('Confirme a senha: ');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Use uma senha de pelo menos 12 caracteres e no máximo 1024 bytes.');
  if (password !== confirmation) throw new Error('As senhas não conferem.');
  return { username, name, email, passwordHash: await hashPassword(password) };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL em api/.env.');
  const input = await credentials();
  if (input.username.length < 3 || input.username.length > 100) throw new Error('O usuário deve ter entre 3 e 100 caracteres.');
  if (input.email && (input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) {
    throw new Error('Informe um e-mail válido ou deixe o campo vazio.');
  }
  const pool = createDatabasePool(process.env.DATABASE_URL);
  pool.on('error', () => process.stderr.write('Conexão com PostgreSQL interrompida.\n'));
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serializa o provisionamento para não criar dois operadores ativos.
      await client.query('LOCK TABLE public.usuarios IN SHARE ROW EXCLUSIVE MODE');
      const existing = await client.query('SELECT 1 FROM public.usuarios WHERE ativo LIMIT 1');
      if (existing.rows.length) throw new Error('Já existe um operador ativo. Nenhuma credencial foi alterada.');
      const users = await client.query<{ id: string }>(`INSERT INTO public.usuarios (usuario, nome, senha_hash, email)
        VALUES ($1, $2, $3, $4) RETURNING id`, [input.username, input.name, input.passwordHash, input.email]);
      const chipId = `simulator:${DEVICE_ID}`;
      await client.query(`INSERT INTO public.dispositivos (identificador, nome, chip_id, fw_versao)
        VALUES ($1, 'Bancada simulada', $2, 'simulator') ON CONFLICT (identificador) DO NOTHING`, [DEVICE_ID, chipId]);
      const devices = await client.query<{ id: string; chip_id: string }>(
        'SELECT id, chip_id FROM public.dispositivos WHERE identificador = $1 FOR UPDATE', [DEVICE_ID]);
      if (devices.rows[0]?.chip_id !== chipId) throw new Error('O identificador da bancada já pertence a outro dispositivo. Revise o vínculo antes de continuar.');
      await client.query('INSERT INTO public.dispositivo_usuarios (dispositivo_id, usuario_id) VALUES ($1, $2)',
        [devices.rows[0].id, users.rows[0].id]);
      await client.query('COMMIT');
      stdout.write(`Operador ${input.username} cadastrado e vinculado à bancada simulada ${DEVICE_ID}.\n`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

main().catch((error: Error & { code?: string }) => {
  process.stderr.write(error.code ? `Falha no provisionamento PostgreSQL (${error.code}). Nenhuma alteração foi confirmada.\n` : `${error.message}\n`);
  process.exitCode = 1;
});
