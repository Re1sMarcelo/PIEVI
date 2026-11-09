import { mkdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startLab,waitFor } from '../src/lab/index.js';
import { validateIntegratedLab } from '../src/lab/validate.js';

const reports=fileURLToPath(new URL('../../tmp/integrated-validation/',import.meta.url));mkdirSync(reports,{recursive:true});
const folder=join(reports,`run-${Date.now()}`);
let lab:Awaited<ReturnType<typeof startLab>>|undefined;
try {
  lab=await startLab({dataDir:folder,apiPort:0,brokerPort:0,host:'127.0.0.1'});
  const report=await validateIntegratedLab(lab,message=>console.log(message));
  const version=(await lab.runtime.snapshot()).configVersion;
  const previousToken=lab.token;
  await lab.stop();lab=undefined;
  lab=await startLab({dataDir:folder,apiPort:0,brokerPort:0,host:'127.0.0.1'});
  await waitFor(()=>lab!.runtime.snapshot(),s=>s.online && s.configVersion===version && !!s.configApplied);
  const history=await lab.runtime.reader.history();
  const resumed=await fetch(`${lab.url}/v1/devices/bancada-01/snapshot`,{headers:{Authorization:`Bearer ${previousToken}`}});
  if(!resumed.ok)throw new Error('A sessão do operador não permaneceu válida após reinício.');
  if(!history.events.some(e=>e.commandId===report.commandId))throw new Error('O comando anterior não permaneceu no histórico após reinício.');
  report.checks.push('Reinício preserva histórico, configuração e sessão, com nova sincronização MQTT');
  console.log('OK · Reinício preserva histórico, configuração e sessão');
  writeFileSync(join(reports,'latest.json'),JSON.stringify(report,null,2),'utf8');
  console.log(`VALIDAÇÃO CONCLUÍDA · ${report.checks.length} verificações\nRelatório: ${join(reports,'latest.json')}\nBanco isolado da validação: ${folder}`);
}catch(error){console.error(error instanceof Error ? error.message : 'Falha na validação integrada.');process.exitCode=1;}
finally{await lab?.stop();}
