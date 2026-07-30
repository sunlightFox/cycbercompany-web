# Spring Agent Studio Web

The conversation-first frontend for Spring Agent Studio. It connects to the local Spring Boot backend, keeps execution steps inline with assistant messages, and progressively reveals citations and configuration.

## Run

```powershell
npm install
npm run dev
```

The development server proxies `/api` to `http://localhost:8080`. Set `VITE_API_BASE_URL` when the backend is hosted elsewhere.

## Product rules

Read [docs/frontend-ui-spec.md](docs/frontend-ui-spec.md) before changing the interface. The rules are intentionally strict: the default surface is a quiet conversation workspace, while execution details, sources, and management controls appear only when needed.
