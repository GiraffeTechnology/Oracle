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

