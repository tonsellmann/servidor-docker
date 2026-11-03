// Mostra a saída real da verificação e os arquivos de verdade do repositório (copiados para
// arquivos/ por scripts/preparar-demonstracao.mjs).

const ARQUIVOS = [
  ['compose.yaml', 'compose.yaml'],
  ['Caddyfile', 'Caddyfile'],
  ['backup.py', 'backup.py'],
  ['Dockerfile (comandas)', 'Dockerfile.jaqueira'],
  ['Dockerfile (painel)', 'Dockerfile.conferencia'],
  ['verificar.mjs', 'verificar.mjs'],
];

const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function verificacao() {
  const texto = await (await fetch('verificacao.txt')).text();
  const linhas = texto.trim().split('\n').map((l) => {
    if (l.startsWith('ok')) return `<span class="ok">${esc(l)}</span>`;
    if (l.startsWith('FALHOU')) return `<span class="falhou">${esc(l)}</span>`;
    return `<span class="resumo">${esc(l)}</span>`;
  });
  document.querySelector('[data-verificacao]').innerHTML = `<span class="comando">$ node testes/verificar.mjs</span>\n${linhas.join('\n')}`;
}

async function mostrar(indice) {
  const [, arquivo] = ARQUIVOS[indice];
  for (const [i, aba] of document.querySelectorAll('[data-aba]').entries()) aba.setAttribute('aria-selected', String(i === indice));
  const texto = await (await fetch(`arquivos/${arquivo}`)).text();
  document.querySelector('[data-arquivo]').innerHTML = texto
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => (/^\s*(#|\/\/)/.test(l) ? `<span class="comentario">${esc(l) || ' '}</span>` : `<span>${esc(l) || ' '}</span>`))
    .join('');
}

const abas = document.querySelector('[data-abas]');
abas.innerHTML = ARQUIVOS.map(([nome], i) => `<button type="button" role="tab" data-aba="${i}" aria-selected="false">${esc(nome)}</button>`).join('');
abas.addEventListener('click', (e) => {
  const aba = e.target.closest('[data-aba]');
  if (aba) mostrar(Number(aba.dataset.aba));
});
abas.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const atual = [...abas.children].findIndex((a) => a.getAttribute('aria-selected') === 'true');
  const proxima = (atual + (e.key === 'ArrowRight' ? 1 : ARQUIVOS.length - 1)) % ARQUIVOS.length;
  mostrar(proxima);
  abas.children[proxima].focus();
});

await Promise.all([verificacao(), mostrar(0)]);
document.documentElement.classList.add('pronto');
