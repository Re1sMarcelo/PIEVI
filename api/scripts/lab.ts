import { resolve } from 'node:path';
import { openSync, readFileSync, closeSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startLab } from '../src/lab/index.js';

const folder=resolve(fileURLToPath(new URL('../../tmp/integrated-lab/',import.meta.url)));
mkdirSync(folder,{recursive:true});const lock=`${folder}/lab.lock`;
try {const owner=Number(readFileSync(lock,'utf8'));if(owner){try{process.kill(owner,0);throw new Error('O laboratório já está em execução. Encerre a outra instância.');}catch(error){if((error as any).code!=='ESRCH')throw error;unlinkSync(lock);}}}catch(error){if((error as any).code!=='ENOENT')throw error;}
const descriptor=openSync(lock,'wx');writeFileSync(descriptor,String(process.pid));closeSync(descriptor);
let lab:Awaited<ReturnType<typeof startLab>>|undefined;
const cleanup=()=>{try{unlinkSync(lock);}catch{}};
try {
  lab=await startLab({dataDir:folder,apiPort:Number(process.env.LAB_API_PORT ?? 3000),brokerPort:Number(process.env.LAB_MQTT_PORT ?? 1883)});
  console.log(`Laboratório MQTT pronto: ${lab.url}\nLogin: ${lab.credentials.username}\nSenha local de desenvolvimento: ${lab.credentials.password}\nDados PostgreSQL/PGlite: ${folder}\nAbra o app no Expo. Use Controle > Testar sem a estufa para trocar cenários. Ctrl+C encerra os serviços.`);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void lab!.stop().finally(()=>{cleanup();process.exit(0);});});
}catch(error){cleanup();process.stderr.write(`${error instanceof Error ? error.message : 'Falha ao iniciar laboratório.'}\n`);process.exitCode=1;}
