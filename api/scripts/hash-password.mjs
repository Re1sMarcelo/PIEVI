import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin, output: process.stdout });
const password = await new Promise((resolve) => input.question('Senha do operador: ', resolve));
input.close();
if (password.length < 12) {
  process.stderr.write('Use uma senha com pelo menos 12 caracteres.\n');
  process.exit(1);
}
const salt = randomBytes(16);
process.stdout.write(`${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}\n`);
