import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { VirtualESP } from '../src/virtual/esp.js';
import { virtualNvs } from '../src/virtual/nvs.js';

if(existsSync('.env'))process.loadEnvFile('.env');
const deviceId=process.env.DEVICE_ID ?? 'bancada-01';
if(!process.env.MQTT_URL || !process.env.MQTT_ESP_PASSWORD)throw new Error('Configure MQTT_URL e MQTT_ESP_PASSWORD.');
const nvs=virtualNvs(process.env.ESP_NVS_PATH ?? fileURLToPath(new URL('../../tmp/esp-virtual/nvs.json',import.meta.url)));
const esp=new VirtualESP({deviceId,broker:{url:process.env.MQTT_URL,username:process.env.MQTT_ESP_USERNAME ?? deviceId,password:process.env.MQTT_ESP_PASSWORD,clientId:`pievi-esp-${deviceId}`},nvs:nvs.value,saveNvs:nvs.save});
await esp.start();
console.log('ESP virtual iniciado. Digite um cenário e Enter: normal, dry_soil, low_water, heat, dht_failure, offline, stale.');
const terminal=createInterface({input:process.stdin,output:process.stdout});
terminal.on('line',line=>{void esp.setScenario(line.trim()).then(()=>console.log(`Cenário: ${esp.scenario()}`)).catch(()=>console.log('Cenário inválido.'));});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{terminal.close();void esp.stop().then(()=>process.exit(0));});
