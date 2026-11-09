import assert from 'node:assert/strict';
import {test} from 'node:test';
import {waitForCommand} from '../src/commandPolling.ts';

test('pedido pendente/enviado não é confirmação de atuação',async()=>{
  const statuses=['pending','sent','accepted'];let count=0;
  const result=await waitForCommand(async()=>({status:statuses[count++]}),'accepted');
  assert.equal(count,3);assert.equal(result.status,'accepted');
});
test('configuração exige conclusão, aceite isolado mantém espera',async()=>{
  let count=0;
  const result=await waitForCommand(async()=>({status:++count===1 ? 'accepted' : 'completed'}),'completed');
  assert.equal(count,2);assert.equal(result.status,'completed');
});
test('recusa e falta de confirmação não são sucesso',async()=>{
  await assert.rejects(()=>waitForCommand(async()=>({status:'rejected',reason:'Sem água'}),'accepted'),/Sem água/);
  await assert.rejects(()=>waitForCommand(async()=>({status:'pending'}),'accepted',0),/não foi possível/i);
});
