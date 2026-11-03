# Servidor dos sistemas

Os sistemas do portfólio que têm servidor, juntos numa máquina só, com Docker Compose: as comandas da Jaqueira (Node.js) e o painel de conferência das maquininhas (Django). Na frente fica o Caddy, com HTTPS automático, e ao lado roda o backup dos bancos.

**Projeto conceito.** Os sistemas e os domínios do exemplo são fictícios. O script de verificação sobe a pilha inteira e confere, de fora, o que importa num servidor de verdade.

- Portfólio: https://luisantoniodev.tech/projetos/servidor-docker/

## O problema

Pôr um sistema no ar não é só copiar o código para um servidor. É preciso:

- HTTPS, com certificado renovado sem ninguém lembrar;
- o tempo real das comandas funcionando atrás do proxy, sem os eventos ficarem presos num buffer;
- backup de um banco SQLite que está sendo gravado naquele instante;
- saber se cada sistema está de pé;
- e, se um deles for invadido, não entregar a máquina inteira.

## O que a pilha faz

```
internet ──► Caddy :80 :443 ──┬──► jaqueira:3000      (Node, SSE)      ── volume jaqueira-dados
             HTTPS automático  └──► conferencia:8000   (Django, gunicorn) ── volume conferencia-dados
             estáticos do Django ◄─── volume estaticos
                                     backup ── copia os dois bancos ──► ./backups
```

- **HTTPS sem cuidar.** O Caddy pede e renova os certificados na Let's Encrypt e manda o HTTP para o HTTPS. Os cabeçalhos HSTS e nosniff são postos, e o cabeçalho `Server` é retirado.
- **Tempo real atrás do proxy.** O `/api/eventos` das comandas passa com `flush_interval -1`: cada evento sai na hora. A verificação abre o SSE pelo Caddy e mede.
- **Backup consistente com o sistema no ar.** Copiar o arquivo `.db` durante uma gravação pode dar um banco corrompido, e no modo WAL o que foi gravado por último ainda está no `-wal`. O serviço de backup usa a API de backup do próprio SQLite, confere a cópia com `PRAGMA integrity_check`, comprime e guarda por 14 dias. O healthcheck dele fica vermelho se o último backup bom tiver passado do dobro do intervalo.
- **Cada um sabe se está de pé.** Os dois sistemas têm `/saude`, que consulta o banco de verdade. O Caddy só sobe depois que eles ficam saudáveis.
- **Contêiner que não entrega a máquina.** Ninguém roda como root nos sistemas nem no backup. O sistema de arquivos é somente leitura (só os volumes de dados e o `/tmp` aceitam escrita), todas as capabilities são retiradas e `no-new-privileges` está ligado. Cada serviço tem limite de memória e log com rotação.
- **O segredo fora do git.** O segredo do Django é um Docker secret, lido de arquivo (`SEGREDO_ARQUIVO`) e gerado no servidor por `segredos/criar.sh`.

## Por que Docker

- **O servidor fica descrito num arquivo.** Versão do Node, do Python, das bibliotecas, as portas, os volumes, os limites: tudo está no `compose.yaml` e nos Dockerfiles. Trocar de servidor é copiar a pasta e subir.
- **Cada sistema na sua caixa.** O Node 24 das comandas e o Python 3.14 do painel não se misturam, e uma atualização de um não quebra o outro.
- **O que roda no teste é o que roda no servidor.** A verificação sobe as mesmas imagens, com o mesmo compose, só trocando o domínio e o certificado.

### O que ficou de fora

- **Kubernetes.** Para dois sistemas numa máquina, seria muita peça para manter.
- **Instalar direto no servidor (systemd).** Funciona, mas a versão de cada coisa fica espalhada pela máquina, e reproduzir em outro servidor vira arqueologia.
- **Nginx com Certbot.** Faz o mesmo, mas com dois programas e um agendamento para renovar o certificado. O Caddy faz tudo sozinho.

## Rodar

O código de cada sistema vem do repositório dele, numa pasta ao lado desta:

```
jaqueira-comandas-node/
conferencia-maquininhas-python/
servidor-docker/          ← esta
```

No servidor, com os domínios apontados para o IP dele:

```bash
cp .env.exemplo .env          # ajuste os domínios e o e-mail
sh segredos/criar.sh
docker compose up -d --build
docker compose exec conferencia python manage.py createsuperuser
docker compose exec conferencia python manage.py carregar_exemplo   # opcional: as taxas do exemplo
```

Os backups ficam em `./backups/<sistema>/`. Para restaurar o banco das comandas:

```bash
docker compose stop jaqueira
gunzip -c backups/jaqueira/salao-AAAAMMDD-HHMM.db.gz > salao.db
docker compose cp salao.db jaqueira:/dados/salao.db
docker compose start jaqueira
```

## Verificar

Precisa do Docker e do Node 22 ou mais novo.

```bash
node testes/verificar.mjs
```

O script sobe a pilha com portas altas (8080 e 8443) e o certificado interno do Caddy, faz 20 conferências e derruba tudo no fim. Com `--manter`, deixa no ar para abrir no navegador.
