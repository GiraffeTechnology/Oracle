export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Giraffe Oracle Admin</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:64rem;margin:3rem auto;padding:0 1rem}
    header,section{border:1px solid #8885;border-radius:.75rem;padding:1rem;margin-bottom:1rem}.ok{color:#16803a}.warn{color:#b15c00}
    code{overflow-wrap:anywhere}button{padding:.55rem .9rem}dl{display:grid;grid-template-columns:12rem 1fr;gap:.5rem}
  </style>
</head>
<body>
  <header><h1>Giraffe RWA Oracle</h1><p>Read-only operational dashboard</p></header>
  <section aria-labelledby="runtime-title"><h2 id="runtime-title">Runtime</h2><dl id="runtime"><dt>Status</dt><dd>Loading</dd></dl><button id="refresh" type="button">Refresh</button></section>
  <section><h2>Safety boundary</h2><p class="warn">This dashboard cannot sign transactions, move funds, issue NFTs or override authoritative evidence.</p></section>
  <script>
    const runtime=document.querySelector('#runtime');
    async function refresh(){
      try{const r=await fetch('/readyz',{cache:'no-store'});const x=await r.json();runtime.innerHTML='<dt>Status</dt><dd class="ok">Ready</dd><dt>Environment</dt><dd>'+x.environment+'</dd><dt>External writes</dt><dd>'+x.externalWritesEnabled+'</dd><dt>Sources</dt><dd>'+x.registeredSources+'</dd>'}
      catch{runtime.innerHTML='<dt>Status</dt><dd class="warn">Unavailable</dd>'}
    }
    document.querySelector('#refresh').addEventListener('click',refresh);refresh();
  </script>
</body>
</html>`;

const ESCAPE = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });
function html(value) {
  return String(value ?? "—").replace(/[&<>"']/g, (character) => ESCAPE[character]);
}

export function renderAssetDetailHtml({ asset, certificate, warehouse, status, settlement }) {
  const phase = settlement?.status === "PENDING" ? "登记处理中" : settlement?.status === "FINALIZED" ? "交割完成" : settlement?.status === "DISPUTED" || settlement?.status === "CANCELLED" || settlement?.status === "TIMED_OUT" ? "交割失败/争议" : status === "TRANSFER_PENDING" ? "成交锁定" : "未进入交割";
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Giraffe RWA Oracle · ${html(asset.assetId)}</title><style>:root{font-family:system-ui,sans-serif;color:#171717;background:#f7f6f2}body{max-width:68rem;margin:auto;padding:2rem}header,section{background:#fff;border:1px solid #ddd8cf;border-radius:1rem;padding:1.25rem;margin-bottom:1rem}dl{display:grid;grid-template-columns:minmax(10rem,14rem) 1fr;gap:.65rem}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}.phase{font-size:1.15rem;font-weight:700}.notice{border-left:.35rem solid #8a6d1d;padding-left:1rem}</style></head><body><header><h1>Giraffe RWA Oracle</h1><p>一物一证一 NFT · 资产事实验证</p></header><section><h2>资产详情</h2><dl><dt>资产 ID</dt><dd>${html(asset.assetId)}</dd><dt>文保链登记</dt><dd>${html(asset.wenbaoRegistryRef)}</dd><dt>证书哈希</dt><dd>${html(certificate?.certificateHash)}</dd><dt>证书版本</dt><dd>${html(certificate?.certificateVersion)}</dd><dt>仓单哈希</dt><dd>${html(warehouse?.warehouseReceiptHash)}</dd><dt>仓储状态</dt><dd>${html(warehouse?.warehouseStatus)}</dd><dt>Oracle 状态</dt><dd>${html(status)}</dd><dt>允许交易/提货</dt><dd>${status === "VALID" ? "是" : "否"}</dd><dt>数据来源</dt><dd>${html(asset.sourceAuthority ?? "approved-authority")}</dd><dt>观察时间</dt><dd>${html(warehouse?.observedAt ?? asset.updatedAt)}</dd><dt>证明到期</dt><dd>${html(asset.attestationExpiresAt)}</dd></dl></section><section><h2>交割进度</h2><p class="phase">${phase}</p><dl><dt>T+0 快照</dt><dd>${html(settlement?.startedAt)}</dd><dt>T+3 截止</dt><dd>${html(settlement?.deadlineAt)}</dd><dt>完成时间</dt><dd>${html(settlement?.finalizedAt)}</dd></dl></section><section class="notice"><strong>边界声明</strong><p>Giraffe 仅提供资产来源、仓储与交割事实证明，不提供或参与 NFT 金融化。</p></section></body></html>`;
}
