export const ADMIN_HTML = `<!doctype html>
<html lang="en">
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
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.grid>*,.controls>*{min-width:0}label{display:grid;gap:.25rem;margin:.5rem 0}input,select{box-sizing:border-box;max-width:100%;padding:.55rem;border:1px solid #aeb7b0;border-radius:.4rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f3;padding:.75rem;border-radius:.5rem}
    @media(max-width:760px){.grid,.controls{grid-template-columns:1fr}dl{grid-template-columns:1fr}body{margin:1rem auto}table{display:block;overflow-x:auto}}
  </style>
</head>
<body>
  <header><h1>Giraffe RWA Oracle</h1><p>Authenticated Admin & Audit dashboard</p><p class="warn">Fails closed by default. This page holds no keys and cannot move funds, issue NFTs, or override authoritative evidence.</p></header>
  <section aria-labelledby="runtime-title"><h2 id="runtime-title">Runtime status</h2><dl id="runtime"><dt>Status</dt><dd>Loading</dd></dl><button id="refresh" type="button">Refresh all</button></section>
  <div class="grid">
    <section><h2>Source status</h2><table><thead><tr><th>ID</th><th>Kind</th><th>Schema</th><th>Status</th></tr></thead><tbody id="sources"></tbody></table></section>
    <section><h2>Conflict and manual-review queue</h2><table><thead><tr><th>Review ID</th><th>Subject</th><th>Findings</th><th>Status</th></tr></thead><tbody id="reviews"></tbody></table></section>
    <section><h2>Signer set</h2><dl id="signers"></dl></section>
    <section><h2>Audit and reconciliation</h2><dl id="audit"></dl><button id="export" type="button">Export redacted audit bundle</button></section>
    <section><h2>Controlled operation status</h2><table><thead><tr><th>Action ID</th><th>Kind</th><th>Subject</th><th>Status</th><th>Error code</th></tr></thead><tbody id="actions"></tbody></table></section>
  </div>
  <section><h2>High-risk dual-control operations</h2><p class="muted">Each operation runs request &rarr; independent approver &rarr; execute. The server refuses every external write that deployment has not authorized.</p><div class="controls">
    <form id="source-form"><h3>Disable source</h3><label>Action ID<input name="actionId" required></label><label>Source ID<input name="sourceId" required></label><label>Reason SHA-256<input name="reasonHash" pattern="[a-fA-F0-9]{64}" required></label><button name="phase" value="request">Request</button><button name="phase" value="execute">Execute</button></form>
    <form id="rotation-form"><h3>Signer rotation</h3><label>Action ID<input name="actionId" required></label><label>Previous set ID<input name="fromSignerSetId" required></label><label>New set ID<input name="toSignerSetId" required></label><label>Rotation digest<input name="rotationDigest" pattern="[a-fA-F0-9]{64}" required></label><button name="phase" value="request">Request</button><button name="phase" value="execute">Execute</button><button name="phase" value="reconcile">Reconcile</button></form>
    <form id="approval-form"><h3>Independent approval</h3><label>Action ID<input name="actionId" required></label><button type="submit">Approve this exact action</button></form>
  </div><pre id="operation-result" aria-live="polite">No operation run yet</pre></section>
  <script>
    const runtime=document.querySelector('#runtime'),sources=document.querySelector('#sources'),reviews=document.querySelector('#reviews'),signers=document.querySelector('#signers'),audit=document.querySelector('#audit'),actions=document.querySelector('#actions'),result=document.querySelector('#operation-result');
    const text=(value)=>String(value??'—');
    const safe=(value)=>text(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const cells=(values)=>'<tr>'+values.map((value)=>'<td>'+safe(value)+'</td>').join('')+'</tr>';
    async function refresh(){
      try{const [readyResponse,dashboardResponse]=await Promise.all([fetch('/readyz',{cache:'no-store'}),fetch('/v1/rwa/admin/dashboard',{cache:'no-store'})]);const ready=await readyResponse.json(),body=await dashboardResponse.json();if(!dashboardResponse.ok)throw new Error(body.errorCode);const x=body.result;runtime.innerHTML='<dt>Status</dt><dd class="ok">Ready</dd><dt>Environment</dt><dd>'+safe(ready.environment)+'</dd><dt>External writes</dt><dd>'+safe(ready.externalWritesEnabled)+'</dd><dt>Generated at</dt><dd>'+safe(x.generatedAt)+'</dd>';sources.innerHTML=x.sources.map((s)=>cells([s.id,s.kind,s.schemaVersions.join(', '),s.active?'ACTIVE':'DISABLED'])).join('')||cells(['—','—','—','No sources']);reviews.innerHTML=x.reviewQueue.map((r)=>cells([r.reviewId,r.subjectId,r.findingCodes.join(', '),r.status])).join('')||cells(['—','—','—','No items awaiting review']);actions.innerHTML=x.controlledActions.map((a)=>cells([a.actionId,a.actionType,a.subjectId,a.status,a.errorCode])).join('')||cells(['—','—','—','—','No controlled operations']);signers.innerHTML='<dt>Set ID</dt><dd>'+safe(x.signerSet.signerSetId)+'</dd><dt>Status</dt><dd>'+safe(x.signerSet.status)+'</dd><dt>Includes private material</dt><dd>'+safe(x.signerSet.privateMaterialIncluded)+'</dd>';audit.innerHTML='<dt>Record count</dt><dd>'+safe(x.audit.recordCount)+'</dd><dt>Audit head</dt><dd><code>'+safe(x.audit.headHash)+'</code></dd><dt>Hash chain</dt><dd>'+safe(x.audit.chainVerified)+'</dd><dt>Outbox backlog</dt><dd>'+safe(x.operations.pendingOutbox)+'</dd>'}
      catch(error){runtime.innerHTML='<dt>Status</dt><dd class="warn">Unavailable: '+safe(error.message)+'</dd>'}
    }
    async function post(path,body,operationKey=null){const bodyText=JSON.stringify(body),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path+String.fromCharCode(10)+bodyText)),idempotencyKey=operationKey??('admin.'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,48));const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-requested-with':'GiraffeOracleAdmin','idempotency-key':idempotencyKey},body:bodyText}),payload=await response.json();result.textContent=JSON.stringify(payload,null,2);if(!response.ok)throw new Error(payload.errorCode);await refresh()}
    for(const [id,base] of [['source-form','/v1/rwa/admin/sources/disable/'],['rotation-form','/v1/rwa/admin/signers/rotate/']])document.querySelector('#'+id).addEventListener('submit',async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget)),phase=event.submitter.value;delete data.phase;try{await post(base+phase,data)}catch(error){result.textContent='Rejected: '+error.message}});
    document.querySelector('#approval-form').addEventListener('submit',async(event)=>{event.preventDefault();try{await post('/v1/rwa/admin/actions/approve',Object.fromEntries(new FormData(event.currentTarget)))}catch(error){result.textContent='Rejected: '+error.message}});
    document.querySelector('#export').addEventListener('click',async()=>{try{await post('/v1/rwa/admin/audit-export',{purpose:'regulatory-audit'},'admin.export.'+crypto.randomUUID())}catch(error){result.textContent='Rejected: '+error.message}});
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
  const phase = settlement?.status === "PENDING" ? "Registry processing" : settlement?.status === "FINALIZED" ? "Settlement complete" : settlement?.status === "DISPUTED" || settlement?.status === "CANCELLED" || settlement?.status === "TIMED_OUT" ? "Settlement failed or disputed" : status === "TRANSFER_PENDING" ? "Snapshot fixed" : "Settlement not started";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Giraffe RWA Oracle · ${html(asset.assetId)}</title><style>:root{font-family:system-ui,sans-serif;color:#171717;background:#f7f6f2}body{max-width:68rem;margin:auto;padding:2rem}header,section{background:#fff;border:1px solid #ddd8cf;border-radius:1rem;padding:1.25rem;margin-bottom:1rem}dl{display:grid;grid-template-columns:minmax(10rem,14rem) 1fr;gap:.65rem}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}.phase{font-size:1.15rem;font-weight:700}.notice{border-left:.35rem solid #8a6d1d;padding-left:1rem}</style></head><body><header><h1>Giraffe RWA Oracle</h1><p>One asset, one certificate, one NFT &middot; asset fact verification</p></header><section><h2>Asset detail</h2><dl><dt>Asset ID</dt><dd>${html(asset.assetId)}</dd><dt>Register reference</dt><dd>${html(asset.wenbaoRegistryRef)}</dd><dt>Certificate hash</dt><dd>${html(certificate?.certificateHash)}</dd><dt>Certificate version</dt><dd>${html(certificate?.certificateVersion)}</dd><dt>Warehouse receipt hash</dt><dd>${html(warehouse?.warehouseReceiptHash)}</dd><dt>Custody status</dt><dd>${html(warehouse?.warehouseStatus)}</dd><dt>Oracle Status</dt><dd>${html(status)}</dd><dt>Trade or redemption allowed</dt><dd>${status === "VALID" ? "Yes" : "No"}</dd><dt>Data source</dt><dd>${html(asset.sourceAuthority ?? "approved-authority")}</dd><dt>Observed at</dt><dd>${timeHtml(warehouse?.observedAt ?? asset.updatedAt)}</dd><dt>Attestation expires</dt><dd>${timeHtml(asset.attestationExpiresAt)}</dd></dl></section><section><h2>Settlement progress</h2><p class="phase">${phase}</p><dl><dt>T+0 snapshot</dt><dd>${timeHtml(settlement?.startedAt)}</dd><dt>T+3 deadline</dt><dd>${timeHtml(settlement?.deadlineAt)}</dd><dt>Calendar version</dt><dd>${html(settlement?.businessCalendarRef)}</dd><dt>Finalized at</dt><dd>${timeHtml(settlement?.finalizedAt)}</dd></dl></section><section class="notice"><strong>Scope statement</strong><p>Giraffe attests only to asset provenance, custody, and settlement facts. It does not provide or take part in NFT financialization.</p></section><script nonce="${html(scriptNonce)}">for(const node of document.querySelectorAll('time[data-utc]')){const value=new Date(node.dataset.utc);if(!Number.isNaN(value.getTime()))node.textContent=value.toLocaleString(undefined,{timeZoneName:'short'})}</script></body></html>`;
}
