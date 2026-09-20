# ToProt

The protocol is the source of truth. A structured protocol form drives every downstream
research artifact: data dictionary, data collection form, Stata skeleton, table shells,
methods paragraph, ethics package, and consent form.

## Structure

- `frontend/` — Next.js (App Router, TypeScript, Tailwind) app. Auth, database, and storage via Supabase.
- `service/` — Python (FastAPI) microservice for document generation and sample-size calculations.

## Local development

### Frontend

```
cd frontend
cp .env.local.example .env.local   # fill in Supabase + Resend keys
npm run dev
```

Runs on http://localhost:3000.

### Document service

The venv lives outside this OneDrive-synced folder (`%LOCALAPPDATA%\ToProt-venv\service`) —
OneDrive's Files-On-Demand placeholders corrupt a venv's `pip` install if it's created inside
a synced directory. Create it once with:

```
python -m venv %LOCALAPPDATA%\ToProt-venv\service
%LOCALAPPDATA%\ToProt-venv\service\Scripts\python.exe -m pip install -r service\requirements.txt
```

Then run it (from the `service/` directory, so `app.main:app` resolves):

```
cd service
%LOCALAPPDATA%\ToProt-venv\service\Scripts\python.exe -m uvicorn app.main:app --reload --port 8001
```

Runs on http://localhost:8001. Health check: `GET /health`.
