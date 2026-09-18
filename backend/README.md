# FastAPI backend

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

The API intentionally does not write statement files, PDFs, signatures, transaction records, or account identifiers to disk or a database. Disable request-body logs in the reverse proxy and hosting provider before processing real financial data.
