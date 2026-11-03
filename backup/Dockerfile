# Backup dos bancos SQLite: Python com a biblioteca padrão, nada mais.
FROM python:3.14-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backup.py /backup.py
# Roda como o usuário 10001, dono das pastas de backup; os volumes dos sistemas aceitam a leitura.
RUN adduser -D -u 10001 backup && mkdir -p /backups && chown backup /backups
USER backup
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s CMD python /backup.py saude
CMD ["python", "/backup.py"]
