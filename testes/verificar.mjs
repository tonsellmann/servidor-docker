// Sobe a pilha inteira com o .env de teste e confere, de fora, o que importa num servidor de
// verdade. Só usa o que vem no Node.
//
//   node testes/verificar.mjs            sobe, confere e derruba (apagando os volumes de teste)
//   node testes/verificar.mjs --manter   deixa no ar para olhar no navegador
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as requestHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PROJETO = 'servidor-teste';
const COMPOSE = ['compose', '-p', PROJETO, '--env-file', join(RAIZ, 'testes', 'teste.env'), '-f', join(RAIZ, 'compose.yaml')];
const PORTA = 8443;
const manter = process.argv.includes('--manter');

const docker = (...args) => execFileSync('docker', [...COMPOSE, ...args], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const resultados = [];
function conferir(nome, condicao, detalhe = '') {
  resultados.push({ nome, ok: Boolean(condicao) });
  console.log(`${condicao ? 'ok  ' : 'FALHOU'} ${nome}${detalhe && !condicao ? ` (${detalhe})` : ''}`);
}

/** HTTPS no 127.0.0.1 com o nome do site no SNI; o certificado é da autoridade interna do Caddy. */
function https(host, caminho, { metodo = 'GET', corpo, cabecalhos = {} } = {}) {
  return new Promise((resolver, rejeitar) => {
    const pedido = request({ host: '127.0.0.1', port: PORTA, servername: host, path: caminho, method: metodo, rejectUnauthorized: false, headers: { Host: host, ...cabecalhos } }, (resposta) => {
      let texto = '';
      resposta.setEncoding('utf8');
      resposta.on('data', (parte) => (texto += parte));
      resposta.on('end', () => resolver({ status: resposta.statusCode, cabecalhos: resposta.headers, texto }));
    });
    pedido.on('error', rejeitar);
    if (corpo) pedido.write(corpo);
    pedido.end();
  });
}

/** Abre o SSE e resolve no primeiro evento do tipo pedido, para medir que ele atravessa o proxy na hora. */
function esperarEvento(host, tipo, prazo = 3000) {
  return new Promise((resolver) => {
    const pedido = request({ host: '127.0.0.1', port: PORTA, servername: host, path: '/api/eventos?desde=999999', rejectUnauthorized: false, headers: { Host: host } }, (resposta) => {
      let buffer = '';
      resposta.setEncoding('utf8');
      resposta.on('data', (parte) => {
        buffer += parte;
        if (buffer.includes(`"tipo":"${tipo}"`)) {
          clearTimeout(relogio);
          pedido.destroy();
          resolver(true);
        }
      });
    });
    const relogio = setTimeout(() => {
      pedido.destroy();
      resolver(false);
    }, prazo);
    pedido.on('error', () => {});
    pedido.end();
    esperarEvento.aberto = new Promise((r) => pedido.on('socket', () => setTimeout(r, 300)));
  });
}

const comando = (pedido, id = `teste-${randomBytes(6).toString('hex')}`) =>
  https('jaqueira.localhost', '/api/comandos', { metodo: 'POST', corpo: JSON.stringify({ id, pedido }), cabecalhos: { 'Content-Type': 'application/json' } });

// ---- sobe ------------------------------------------------------------------------------------
const segredo = join(RAIZ, 'segredos', 'conferencia.txt');
if (!existsSync(segredo)) writeFileSync(segredo, randomBytes(40).toString('base64url'));
rmSync(join(RAIZ, 'testes', 'backups'), { recursive: true, force: true });
mkdirSync(join(RAIZ, 'testes', 'backups'), { recursive: true });
console.log('Construindo e subindo a pilha de teste (a primeira vez baixa as imagens base)…');
const subida = spawnSync('docker', [...COMPOSE, 'up', '-d', '--build', '--wait', '--wait-timeout', '180'], { cwd: RAIZ, stdio: 'inherit' });
conferir('a pilha sobe e todos os serviços ficam saudáveis', subida.status === 0);
if (subida.status !== 0) {
  spawnSync('docker', [...COMPOSE, 'ps'], { cwd: RAIZ, stdio: 'inherit' });
  spawnSync('docker', [...COMPOSE, 'logs', '--tail', '30'], { cwd: RAIZ, stdio: 'inherit' });
  if (!manter) spawnSync('docker', [...COMPOSE, 'down', '-v'], { cwd: RAIZ, stdio: 'ignore' });
  process.exit(1);
}

try {
  // ---- HTTPS e cabeçalhos -----------------------------------------------------------------
  const redirecionado = await new Promise((resolver) => {
    requestHttp({ host: '127.0.0.1', port: 8080, path: '/garcom', headers: { Host: 'jaqueira.localhost' } }, (r) => resolver(r)).end();
  });
  conferir('HTTP redireciona para HTTPS', redirecionado.statusCode === 308 && String(redirecionado.headers.location).startsWith('https://jaqueira.localhost'), `${redirecionado.statusCode} ${redirecionado.headers.location}`);

  const garcom = await https('jaqueira.localhost', '/garcom');
  conferir('a tela do garçom abre por HTTPS', garcom.status === 200 && garcom.texto.includes('Garçom'), String(garcom.status));
  conferir('HSTS e nosniff no cabeçalho', String(garcom.cabecalhos['strict-transport-security']).includes('max-age=31536000') && garcom.cabecalhos['x-content-type-options'] === 'nosniff');
  conferir('o servidor não se anuncia', !garcom.cabecalhos.server, String(garcom.cabecalhos.server));

  // ---- tempo real e idempotência através do proxy -------------------------------------------
  const chegou = esperarEvento('jaqueira.localhost', 'mesa-aberta');
  await esperarEvento.aberto;
  const inicio = Date.now();
  const abrir = { tipo: 'abrir-mesa', mesa: 7, pessoas: 2, garcom: 'Teste' };
  const primeira = JSON.parse((await comando(abrir, 'teste-mesa-sete-01')).texto);
  conferir('o evento chega pelo SSE em menos de 3 segundos, através do Caddy', await chegou, `${Date.now() - inicio} ms`);
  const segunda = JSON.parse((await comando(abrir, 'teste-mesa-sete-01')).texto);
  conferir('o mesmo comando duas vezes executa uma vez só', primeira.ok && segunda.repetido === true, JSON.stringify(segunda));
  const saudeAntes = JSON.parse((await https('jaqueira.localhost', '/saude')).texto);

  // ---- Django atrás do proxy ------------------------------------------------------------------
  const saude = await https('conferencia.localhost', '/saude');
  conferir('o painel responde ao /saude', saude.status === 200 && saude.texto.includes('"ok": true'), `${saude.status} ${saude.texto}`);
  const raiz = await https('conferencia.localhost', '/');
  conferir('o painel pede login', raiz.status === 302 && String(raiz.cabecalhos.location).includes('/admin/login/'), `${raiz.status} ${raiz.cabecalhos.location}`);
  const login = await https('conferencia.localhost', '/admin/login/');
  conferir('a página de login abre, com cookie de sessão seguro', login.status === 200 && String(login.cabecalhos['set-cookie'] ?? '').includes('Secure'), String(login.status));
  const css = await https('conferencia.localhost', '/static/painel/painel.css');
  conferir('os estáticos saem do Caddy', css.status === 200 && css.texto.includes('--tinta'), String(css.status));
  const testesDoPainel = spawnSync('docker', [...COMPOSE, 'exec', '-T', 'conferencia', 'python', 'manage.py', 'test', 'painel', '--noinput'], { cwd: RAIZ, encoding: 'utf8' });
  conferir('os testes do painel passam dentro da imagem', testesDoPainel.status === 0, testesDoPainel.stderr.split('\n').slice(-4).join(' '));

  // ---- endurecimento ---------------------------------------------------------------------------
  for (const servico of ['jaqueira', 'conferencia', 'backup']) {
    const uid = docker('exec', '-T', servico, 'id', '-u').trim();
    conferir(`${servico} não roda como root`, uid !== '0', `uid ${uid}`);
  }
  const escrita = spawnSync('docker', [...COMPOSE, 'exec', '-T', 'jaqueira', 'touch', '/app/invasor'], { cwd: RAIZ, encoding: 'utf8' });
  conferir('o sistema de arquivos do contêiner é somente leitura', escrita.status !== 0);

  // ---- backup ----------------------------------------------------------------------------------
  const rodada = spawnSync('docker', [...COMPOSE, 'exec', '-T', 'backup', 'python', '/backup.py', 'agora'], { cwd: RAIZ, encoding: 'utf8' });
  conferir('o backup roda sem erro com os sistemas no ar', rodada.status === 0, rodada.stdout + rodada.stderr);
  const pasta = join(RAIZ, 'testes', 'backups', 'jaqueira');
  const copias = existsSync(pasta) ? readdirSync(pasta).filter((n) => n.endsWith('.db.gz')).sort() : [];
  let eventosNaCopia = 0;
  if (copias.length) {
    const temporario = join(tmpdir(), `salao-${Date.now()}.db`);
    writeFileSync(temporario, gunzipSync(readFileSync(join(pasta, copias.at(-1)))));
    const banco = new DatabaseSync(temporario, { readOnly: true });
    eventosNaCopia = banco.prepare('SELECT count(*) AS n FROM eventos').get().n;
    banco.close();
    rmSync(temporario, { force: true });
  }
  conferir('a cópia do banco das comandas abre e tem a mesa aberta', eventosNaCopia >= 1, `${copias.length} cópias, ${eventosNaCopia} eventos`);
  conferir('o painel também tem cópia', existsSync(join(RAIZ, 'testes', 'backups', 'conferencia')) && readdirSync(join(RAIZ, 'testes', 'backups', 'conferencia')).some((n) => n.endsWith('.db.gz')));

  // ---- os dados sobrevivem a um reinício -----------------------------------------------------
  docker('restart', 'jaqueira');
  spawnSync('docker', [...COMPOSE, 'up', '-d', '--wait', '--wait-timeout', '60'], { cwd: RAIZ });
  const saudeDepois = JSON.parse((await https('jaqueira.localhost', '/saude')).texto);
  conferir('depois de reiniciar, o salão continua no mesmo evento', saudeDepois.seq === saudeAntes.seq && saudeDepois.seq >= 1, `${saudeAntes.seq} → ${saudeDepois.seq}`);
} catch (erro) {
  conferir('a verificação terminou sem exceção', false, erro.stack);
} finally {
  if (manter) {
    console.log('\nNo ar: https://jaqueira.localhost:8443/garcom e https://conferencia.localhost:8443/ (certificado interno do Caddy).');
  } else {
    spawnSync('docker', [...COMPOSE, 'down', '-v'], { cwd: RAIZ, stdio: 'ignore' });
  }
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas} de ${resultados.length} conferências passaram.`);
process.exit(falhas ? 1 : 0);
