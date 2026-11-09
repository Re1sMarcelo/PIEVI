import type { MqttClient } from 'mqtt';
export function publishConfirmed(client:MqttClient,topic:string,body:string,retain=false,timeoutMs=3000):Promise<void> {
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);client.off('close',closed);error ? reject(error) : resolve();};
    const closed=()=>finish(new Error('Conexão MQTT encerrada durante publicação.'));
    const timer=setTimeout(()=>finish(new Error('Confirmação MQTT não recebida no prazo.')),timeoutMs);
    client.once('close',closed);
    if(!client.connected){finish(new Error('Broker desconectado.'));return;}
    client.publish(topic,body,{qos:1,retain},error=>finish(error ?? undefined));
  });
}
