#!/bin/sh
# Gera o segredo do Django uma vez. O arquivo fica só no servidor: o .gitignore o deixa fora do git.
set -e
cd "$(dirname "$0")"
if [ -s conferencia.txt ]; then echo "segredos/conferencia.txt já existe."; exit 0; fi
umask 077
python3 -c "import secrets; print(secrets.token_urlsafe(50))" > conferencia.txt
echo "segredos/conferencia.txt criado."
