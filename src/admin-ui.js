export const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Giraffe Oracle · Admin & Audit</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#17201c;background:#f4f5f2}body{max-width:78rem;margin:2rem auto;padding:0 1rem}
    header,section{background:#fff;border:1px solid #d8ddd7;border-radius:.9rem;padding:1rem;margin-bottom:1rem}.ok{color:#16803a}.warn{color:#9a5200}.muted{color:#66706a}
    code{overflow-wrap:anywhere}button{padding:.55rem .9rem;border:1px solid #87938b;border-radius:.45rem;background:#f8faf8;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}
    dl{display:grid;grid-template-columns:12rem 1fr;gap:.5rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.55rem;border-bottom:1px solid #e7ebe7;vertical-align:top}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}label{display:grid;gap:.25rem;margin:.5rem 0}input,select{padding:.55rem;border:1px solid #aeb7b0;border-radius:.4rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f3;padding:.75rem;border-radius:.5rem}
    @media(max-width:760px){.grid,.controls{grid-template-columns:1fr}dl{grid-template-columns:1fr}body{margin:1rem auto}table{display:block;overflow-x:auto}}
  </style>
</head>
<body>
  <header><h1>Giraffe RWA Oracle</h1><p>Authenticated Admin & Audit dashboard</p><p class="warn">默认失败关闭；页面不持有密钥，不能移动资金、发行 NFT 或覆盖权威证据。</p></header>
  <section aria-labelledby="runtime-title"><h2 id="runtime-title">运行状态</h2><dl id="runtime"><dt>状态</dt><dd>载入中</dd></dl><button id="refresh" type="button">刷新全部</button></section>
  <div class="grid">
    <section><h2>来源状态</h2><table><thead><tr><th>ID</th><th>类型</th><th>Schema</th><th>状态</th></tr></thead><tbody id="sources"></tbody></table></section>
    <section><h2>冲突/人工复核队列</h2><table><thead><tr><th>复核 ID</th><th>主体</th><th>发现</th><th>状态</th></tr></thead><tbody id="reviews"></tbody></table></section>
    <section><h2>签名人集合</h2><dl id="signers"></dl></section>
    <section><h2>审计与对账</h2><dl id="audit"></dl><button id="export" type="button">导出脱敏审计包</button></section>
  </div>
  <section><h2>高风险双人复核操作</h2><p class="muted">操作分为 request → 独立 approver → execute；外部写入未获部署授权时服务端一律拒绝。</p><div class="controls">
    <form id="source-form"><h3>停用来源</h3><label>Action ID<input name="actionId" required></label><label>Source ID<input name="sourceId" required></label><label>Reason SHA-256<input name="reasonHash" pattern="[a-fA-F0-9]{64}" required></label><button name="phase" value="request">请求</button><button name="phase" value="execute">执行</button></form>
    <form id="rotation-form"><h3>签名人轮换</h3><label>Action ID<input name="actionId" required></label><label>旧集合 ID<input name="fromSignerSetId" required></label><label>新集合 ID<input name="toSignerSetId" required></label><label>Rotation digest<input name="rotationDigest" pattern="[a-fA-F0-9]{64}" required></label><button name="phase" value="request">请求</button><button name="phase" value="execute">执行</button></form>
  </div><pre id="operation-result" aria-live="polite">尚未执行操作</pre></section>
  <script>
    const runtime=document.querySelector('#runtime'),sources=document.querySelector('#sources'),reviews=document.querySelector('#reviews'),signers=document.querySelector('#signers'),audit=document.querySelector('#audit'),result=document.querySelector('#operation-result');
    const text=(value)=>String(value??'—');
    const safe=(value)=>text(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const cells=(values)=>'<tr>'+values.map((value)=>'<td>'+safe(value)+'</td>').join('')+'</tr>';
    async function refresh(){
      try{const [readyResponse,dashboardResponse]=await Promise.all([fetch('/readyz',{cache:'no-store'}),fetch('/v1/rwa/admin/dashboard',{cache:'no-store'})]);const ready=await readyResponse.json(),body=await dashboardResponse.json();if(!dashboardResponse.ok)throw new Error(body.errorCode);const x=body.result;runtime.innerHTML='<dt>状态</dt><dd class="ok">Ready</dd><dt>环境</dt><dd>'+safe(ready.environment)+'</dd><dt>外部写入</dt><dd>'+safe(ready.externalWritesEnabled)+'</dd><dt>生成时间</dt><dd>'+safe(x.generatedAt)+'</dd>';sources.innerHTML=x.sources.map((s)=>cells([s.id,s.kind,s.schemaVersions.join(', '),s.active?'ACTIVE':'DISABLED'])).join('')||cells(['—','—','—','无来源']);reviews.innerHTML=x.reviewQueue.map((r)=>cells([r.reviewId,r.subjectId,r.findingCodes.join(', '),r.status])).join('')||cells(['—','—','—','无待复核项']);signers.innerHTML='<dt>集合 ID</dt><dd>'+safe(x.signerSet.signerSetId)+'</dd><dt>状态</dt><dd>'+safe(x.signerSet.status)+'</dd><dt>包含私密材料</dt><dd>'+safe(x.signerSet.privateMaterialIncluded)+'</dd>';audit.innerHTML='<dt>记录数</dt><dd>'+safe(x.audit.recordCount)+'</dd><dt>审计头</dt><dd><code>'+safe(x.audit.headHash)+'</code></dd><dt>哈希链</dt><dd>'+safe(x.audit.chainVerified)+'</dd><dt>Outbox 积压</dt><dd>'+safe(x.operations.pendingOutbox)+'</dd>'}
      catch(error){runtime.innerHTML='<dt>状态</dt><dd class="warn">Unavailable: '+safe(error.message)+'</dd>'}
    }
    async function post(path,body){const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-requested-with':'GiraffeOracleAdmin'},body:JSON.stringify(body)}),payload=await response.json();result.textContent=JSON.stringify(payload,null,2);if(!response.ok)throw new Error(payload.errorCode);await refresh()}
    for(const [id,base] of [['source-form','/v1/rwa/admin/sources/disable/'],['rotation-form','/v1/rwa/admin/signers/rotate/']])document.querySelector('#'+id).addEventListener('submit',async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget)),phase=event.submitter.value;delete data.phase;try{await post(base+phase,data)}catch(error){result.textContent='Rejected: '+error.message}});
    document.querySelector('#export').addEventListener('click',async()=>{try{const response=await fetch('/v1/rwa/admin/audit-export?purpose=regulatory-audit',{cache:'no-store'}),body=await response.json();result.textContent=JSON.stringify(body,null,2)}catch(error){result.textContent='Rejected: '+error.message}});
    document.querySelector('#refresh').addEventListener('click',refresh);refresh();
  </script>
</body>
</html>`;

const ESCAPE = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });
function html(value) {
  return String(value ?? "—").replace(/[&<>"']/g, (character) => ESCAPE[character]);
}

function timeHtml(value) {
  if (!value) return "—";
  const utc = new Date(value).toISOString();
  return `<time datetime="${html(utc)}" data-utc="${html(utc)}" data-display-time-zone="browser-local">${html(utc)}</time>`;
}

export function renderAssetDetailHtml({ asset, certificate, warehouse, status, settlement, scriptNonce = "" }) {
  const phase = settlement?.status === "PENDING" ? "登记处理中" : settlement?.status === "FINALIZED" ? "交割完成" : settlement?.status === "DISPUTED" || settlement?.status === "CANCELLED" || settlement?.status === "TIMED_OUT" ? "交割失败/争议" : status === "TRANSFER_PENDING" ? "成交锁定" : "未进入交割";
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Giraffe RWA Oracle · ${html(asset.assetId)}</title><style>:root{font-family:system-ui,sans-serif;color:#171717;background:#f7f6f2}body{max-width:68rem;margin:auto;padding:2rem}header,section{background:#fff;border:1px solid #ddd8cf;border-radius:1rem;padding:1.25rem;margin-bottom:1rem}dl{display:grid;grid-template-columns:minmax(10rem,14rem) 1fr;gap:.65rem}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}.phase{font-size:1.15rem;font-weight:700}.notice{border-left:.35rem solid #8a6d1d;padding-left:1rem}</style></head><body><header><h1>Giraffe RWA Oracle</h1><p>一物一证一 NFT · 资产事实验证</p></header><section><h2>资产详情</h2><dl><dt>资产 ID</dt><dd>${html(asset.assetId)}</dd><dt>文保链登记</dt><dd>${html(asset.wenbaoRegistryRef)}</dd><dt>证书哈希</dt><dd>${html(certificate?.certificateHash)}</dd><dt>证书版本</dt><dd>${html(certificate?.certificateVersion)}</dd><dt>仓单哈希</dt><dd>${html(warehouse?.warehouseReceiptHash)}</dd><dt>仓储状态</dt><dd>${html(warehouse?.warehouseStatus)}</dd><dt>Oracle 状态</dt><dd>${html(status)}</dd><dt>允许交易/提货</dt><dd>${status === "VALID" ? "是" : "否"}</dd><dt>数据来源</dt><dd>${html(asset.sourceAuthority ?? "approved-authority")}</dd><dt>观察时间</dt><dd>${timeHtml(warehouse?.observedAt ?? asset.updatedAt)}</dd><dt>证明到期</dt><dd>${timeHtml(asset.attestationExpiresAt)}</dd></dl></section><section><h2>交割进度</h2><p class="phase">${phase}</p><dl><dt>T+0 快照</dt><dd>${timeHtml(settlement?.startedAt)}</dd><dt>T+3 截止</dt><dd>${timeHtml(settlement?.deadlineAt)}</dd><dt>日历版本</dt><dd>${html(settlement?.businessCalendarRef)}</dd><dt>完成时间</dt><dd>${timeHtml(settlement?.finalizedAt)}</dd></dl></section><section class="notice"><strong>边界声明</strong><p>Giraffe 仅提供资产来源、仓储与交割事实证明，不提供或参与 NFT 金融化。</p></section><script nonce="${html(scriptNonce)}">for(const node of document.querySelectorAll('time[data-utc]')){const value=new Date(node.dataset.utc);if(!Number.isNaN(value.getTime()))node.textContent=value.toLocaleString(undefined,{timeZoneName:'short'})}</script></body></html>`;
}
