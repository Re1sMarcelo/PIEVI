import { Aedes } from 'aedes';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mqttTopicParts, MQTT_MAX_PAYLOAD_BYTES } from '../mqtt/protocol.js';
import type { BrokerSettings } from '../integrated/worker.js';

export async function startLocalBroker(deviceId:string,port=1883,options:{host?:string;apiPassword?:string;espPassword?:string}={}) {
  const apiPassword=options.apiPassword ?? randomBytes(24).toString('hex');const espPassword=options.espPassword ?? randomBytes(24).toString('hex');
  const apiId='pievi-api-local';const espId=`pievi-esp-${deviceId}`;
  const incoming=['telemetry','state','events','acks','presence']; const outgoing=['commands','sync','receipts'];
  const aedes=await Aedes.createBroker({
    authenticate(client,username,password,done) {
      done(null,client.id===apiId && username==='api-local' && password?.toString()===apiPassword || client.id===espId && username===deviceId && password?.toString()===espPassword);
    },
    authorizePublish(client,packet,done) {
      if(!client){done(null);return;}
      const parts=mqttTopicParts(packet.topic); const channels=client.id===apiId ? outgoing : incoming;
      done(parts?.deviceId===deviceId && channels.includes(parts.channel) && packet.payload.length<=MQTT_MAX_PAYLOAD_BYTES && (!packet.retain || parts.channel==='presence') ? null : new Error('Publicação não autorizada.'));
    },
    authorizeSubscribe(client,subscription,done) {
      const parts=mqttTopicParts(subscription.topic);const channels=client.id===apiId ? incoming : outgoing;
      done(null,parts?.deviceId===deviceId && channels.includes(parts.channel) ? subscription : null);
    },
  });
  aedes.on('clientError',()=>undefined);aedes.on('connectionError',()=>undefined);
  const server=createServer(aedes.handle);
  try {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,options.host ?? '127.0.0.1',()=>{server.off('error',reject);resolve();});});}
  catch(error){await new Promise<void>(resolve=>aedes.close(resolve));throw error;}
  const actual=(server.address() as {port:number}).port;const url=`mqtt://127.0.0.1:${actual}`;
  return {api:{url,username:'api-local',password:apiPassword,clientId:apiId} satisfies BrokerSettings,
    esp:{url,username:deviceId,password:espPassword,clientId:espId} satisfies BrokerSettings,
    close:async()=>{await new Promise<void>(resolve=>aedes.close(resolve));await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
