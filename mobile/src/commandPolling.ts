import type { CommandResult } from '../../api/src/contracts';

export async function waitForCommand(read:()=>Promise<CommandResult>,goal:'accepted'|'completed',timeoutMs=11000) {
  const deadline=Date.now()+timeoutMs;
  do {
    const command=await read();
    if(command.status==='rejected'||command.status==='expired')throw new Error(command.reason ?? 'O ESP recusou o comando ou o prazo expirou.');
    if(command.status==='completed'||goal==='accepted'&&command.status==='accepted')return command;
    if(Date.now()>=deadline)break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }while(Date.now()<deadline);
  throw new Error('Não foi possível confirmar o comando no prazo. Confira o estado da estufa antes de reenviar.');
}
