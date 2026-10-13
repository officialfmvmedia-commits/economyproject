// Public wallets panel. Fallback addresses (from engine wallets.json) so it works even when the engine is offline.
(function(){
 const FALLBACK=[['bank','Central Bank · Treasury','🏦','#e2a93b','7VUDJaUsaNGfZySS9mwKJZg47SYu3RhdKP78wb5KbVUw'],
  ['openai','OpenAI','O','#2fb89a','JCLUmpYTXp3nieFw5SXm7fYBi9ttzHNHiLLb2pbeDMd7'],
  ['grok','Grok','X','#5a6270','C7LFKEYkNxuHQ9rShNmxtWFAEjvDEYuLridb93UYUzPn'],
  ['anthropic','Anthropic','A','#e2774f','62tgPkAAC4jhuzXicjBb31y9AkmPMYpyqGc1cFscojJy'],
  ['google','Google','G','#4a8af4','6gkYVBe6xBY5oqqe2G2u8uZBL4YM8PBSnRmHenYdrzDh'],
  ['qwen','Qwen','Q','#8f6cf0','7H79UyFUxeihMtDxP7cBTpia6TmqxNBS5oKbWeoUv4Yg']];
 const $=(id)=>document.getElementById(id),modal=$('wallets'),list=$('wlist');
 const short=(a)=>a.slice(0,4)+'…'+a.slice(-4);
 function render(){const s=window.__AIE_STATE;const rows=FALLBACK.map(([id,name,ic,c,addr])=>{let bal=null;
   if(s){if(id==='bank'){addr=s.bank.pubkey||addr;bal=s.bank.balance_sol}else{const a=(s.agents||[]).find(x=>x.id===id);if(a){addr=a.pubkey||addr;bal=a.balance_sol}}}
   return `<div class="wrow"><span class="crest" style="background:${c}">${ic}</span><div class="wnm"><b>${name}</b><code title="${addr}">${short(addr)}</code></div><span class="wbal">${bal==null?'—':(+bal).toFixed(4)+' SOL'}</span><button class="wcp" data-a="${addr}" title="Copy address">📋</button><a class="wsol" href="https://solscan.io/account/${addr}" target="_blank" rel="noopener">Solscan ↗</a></div>`}).join('');
  list.innerHTML=rows+(s?'':'<div class="wnote">Live balances appear when the engine is online.</div>');
  list.querySelectorAll('.wcp').forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(b.dataset.a);b.textContent='✅';setTimeout(()=>b.textContent='📋',1200)})}
 $('walletsBtn').onclick=()=>{render();modal.hidden=false};
 modal.querySelector('.wclose').onclick=()=>modal.hidden=true;
 modal.onclick=(e)=>{if(e.target===modal)modal.hidden=true};
 addEventListener('keydown',e=>{if(e.key==='Escape')modal.hidden=true});
 addEventListener('aie-state',()=>{if(!modal.hidden)render()});
})();
