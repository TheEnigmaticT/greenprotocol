FROM python:3.14-slim

WORKDIR /app

# Install system deps for rdkit
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxrender1 libxext6 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python solvent_evidence_import.py \
    --raw data/solvent-evidence/raw \
    --manifests data/solvent-evidence/manifests \
    --output data/solvent-evidence/solvent-evidence.sqlite

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
