// Monta a demonstração do portfólio: a página, a saída da verificação e os arquivos de verdade da
// pilha (inclusive os Dockerfiles, que ficam no repositório de cada sistema, ao lado deste).
//
//   node scripts/preparar-demonstracao.mjs ../Portfolio/public/demos/servidor-docker
import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const destino = process.argv[2];
if (!destino) {
  console.error('Uso: node scripts/preparar-demonstracao.mjs <pasta de destino>');
  process.exit(1);
}
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const pasta = resolve(destino);
const arquivos = {
  'compose.yaml': join(RAIZ, 'compose.yaml'),
  Caddyfile: join(RAIZ, 'caddy', 'Caddyfile'),
  'backup.py': join(RAIZ, 'backup', 'backup.py'),
  'verificar.mjs': join(RAIZ, 'testes', 'verificar.mjs'),
  'Dockerfile.jaqueira': join(RAIZ, '..', 'jaqueira-comandas-node', 'Dockerfile'),
  'Dockerfile.conferencia': join(RAIZ, '..', 'conferencia-maquininhas-python', 'Dockerfile'),
};

await rm(pasta, { recursive: true, force: true });
await mkdir(join(pasta, 'arquivos'), { recursive: true });
for (const [nome, origem] of Object.entries(arquivos)) await cp(origem, join(pasta, 'arquivos', nome));
for (const nome of ['index.html', 'demo.js', 'verificacao.txt']) await cp(join(RAIZ, 'demo', nome), join(pasta, nome));
console.log(`Demonstração em ${pasta}`);
