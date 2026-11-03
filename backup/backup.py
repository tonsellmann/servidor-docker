"""Backup dos bancos SQLite com os sistemas rodando.

Copiar o arquivo .db com o sistema no ar pode pegar o banco no meio de uma gravação (e, no modo WAL,
o que foi gravado por último ainda está no arquivo -wal). A cópia aqui usa a API de backup do
próprio SQLite, que gera uma fotografia consistente. Cada cópia é conferida (PRAGMA
integrity_check), comprimida e guardada com a data; as mais velhas que MANTER_DIAS são apagadas.

Roda uma vez ao subir e depois a cada INTERVALO_HORAS. O arquivo /backups/ultimo.json diz quando
foi o último backup bom; o healthcheck do contêiner olha a idade dele.
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

FONTES = Path(os.environ.get("FONTES", "/fontes"))
DESTINO = Path(os.environ.get("DESTINO", "/backups"))
TEMPORARIO = Path(os.environ.get("TEMPORARIO", "/tmp"))
INTERVALO_HORAS = float(os.environ.get("INTERVALO_HORAS", "6"))
MANTER_DIAS = int(os.environ.get("MANTER_DIAS", "14"))
EXTENSOES = {".db", ".sqlite3", ".sqlite"}


def bancos() -> list[Path]:
    return sorted(p for p in FONTES.glob("*/*") if p.suffix in EXTENSOES and p.is_file())


def copiar(banco: Path, agora: datetime) -> Path:
    sistema = banco.parent.name
    copia = TEMPORARIO / f"{sistema}-{banco.stem}.db"
    copia.unlink(missing_ok=True)
    origem = sqlite3.connect(f"file:{banco}?mode=ro", uri=True, timeout=30)
    destino = sqlite3.connect(copia)
    try:
        origem.backup(destino)
    finally:
        origem.close()
    try:
        resultado = destino.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        destino.close()
    if resultado != "ok":
        raise RuntimeError(f"cópia de {banco} não passou na conferência: {resultado}")

    pasta = DESTINO / sistema
    pasta.mkdir(parents=True, exist_ok=True)
    final = pasta / f"{banco.stem}-{agora:%Y%m%d-%H%M}.db.gz"
    with copia.open("rb") as entrada, gzip.open(final, "wb", compresslevel=6) as saida:
        shutil.copyfileobj(entrada, saida)
    copia.unlink()
    return final


def limpar(agora: datetime) -> int:
    limite = agora - timedelta(days=MANTER_DIAS)
    apagados = 0
    for arquivo in DESTINO.glob("*/*.db.gz"):
        if datetime.fromtimestamp(arquivo.stat().st_mtime, timezone.utc) < limite:
            arquivo.unlink()
            apagados += 1
    return apagados


def rodada() -> dict:
    agora = datetime.now(timezone.utc)
    feitos, erros = [], []
    for banco in bancos():
        try:
            feitos.append(str(copiar(banco, agora).relative_to(DESTINO)))
        except Exception as erro:  # um banco com problema não impede o backup dos outros
            erros.append(f"{banco}: {erro}")
    registro = {"em": agora.isoformat(), "copias": feitos, "erros": erros, "apagados": limpar(agora)}
    if feitos and not erros:
        (DESTINO / "ultimo.json").write_text(json.dumps(registro, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(registro, ensure_ascii=False), flush=True)
    return registro


def saudavel() -> bool:
    """Para o healthcheck: houve um backup bom há menos de duas vezes o intervalo?"""
    try:
        ultimo = json.loads((DESTINO / "ultimo.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    idade = datetime.now(timezone.utc) - datetime.fromisoformat(ultimo["em"])
    return idade < timedelta(hours=2 * INTERVALO_HORAS)


if __name__ == "__main__":
    if sys.argv[1:] == ["saude"]:
        sys.exit(0 if saudavel() else 1)
    if sys.argv[1:] == ["agora"]:
        sys.exit(0 if not rodada()["erros"] else 1)
    while True:
        rodada()
        time.sleep(INTERVALO_HORAS * 3600)
