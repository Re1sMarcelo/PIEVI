import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, configError } from '../controlConfig.js';
import type { VirtualNvs } from './esp.js';

export function virtualNvs(file?:string) {
  const initial:VirtualNvs=existsSync(file ?? '') ? JSON.parse(readFileSync(file!,'utf8')) : {bootNumber:0,configVersion:0,config:structuredClone(DEFAULT_CONFIG),calibrationId:randomUUID()};
  if(!Number.isInteger(initial.bootNumber)||initial.bootNumber<0||initial.bootNumber>=2147483647||configError(initial.config)||!Number.isInteger(initial.configVersion)||initial.configVersion<0)throw new Error('NVS virtual inválida. Preserve os arquivos e investigue; não zere o contador de boot.');
  const save=(value:VirtualNvs)=>{if(!file)return;mkdirSync(dirname(file),{recursive:true});writeFileSync(`${file}.tmp`,JSON.stringify(value,null,2),'utf8');renameSync(`${file}.tmp`,file);};
  initial.bootNumber++;save(initial);return{value:initial,save};
}
