# Spring Agent Studio Web

The conversation-first frontend for Spring Agent Studio. It connects to the local Spring Boot backend, keeps execution steps inline with assistant messages, and progressively reveals citations and configuration.

## Run

```powershell
npm install
npm run dev
```

## Run with Docker

Start the frontend, Spring Boot backend, and SearXNG search service from the
frontend project root:

```powershell
docker compose up -d --build
```

Open `http://localhost:5173` after the backend becomes healthy. The frontend and
backend source directories are mounted into their respective containers, so code
changes are picked up without rebuilding. Node and Gradle dependencies are kept
in Docker volumes rather than written to the host.

On subsequent starts, only start the existing service:

```powershell
docker compose start
```

Stop it with `docker compose stop`. To rebuild dependencies after changing
`package-lock.json`, run `docker compose up -d --build`.

The frontend proxies `/api` to a loopback-only backend in the same Docker
network namespace, and the backend uses the `searxng` service internally. Supply the model key through the shell before
starting the stack:

```powershell
$env:EDGEFN_API_KEY = 'sk-...'
docker compose up -d --build
```

The development server proxies `/api` to `http://localhost:8080`. Set `VITE_DEV_PROXY_TARGET` for another local backend port. Set `VITE_API_BASE_URL` to the deployed backend API root when the frontend and backend are hosted on different origins.

## Product rules

Read [docs/frontend-ui-spec.md](docs/frontend-ui-spec.md) before changing the interface. The rules are intentionally strict: the default surface is a quiet conversation workspace, while execution details, sources, and management controls appear only when needed.
