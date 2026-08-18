# CycberCompany Web

[中文](README.zh-CN.md) | [English](README.md)

CycberCompany Web is the conversation-first workspace for CycberCompany. It combines durable conversations, streamed execution progress, citations, and on-demand management for agents, Skills, MCP connections, knowledge bases, models, and local execution capabilities.

## Links

- [Backend repository](https://github.com/sunlightFox/spring-agent-studio-backend)
- [Technical documentation](https://cycbercompany.chat/docs)

## Highlights

- **Conversation-first workspace** — Keep the task, assistant response, and execution progress in one readable message flow.
- **Live run updates** — Receive backend Run events through SSE, including progress, approval, completion, cancellation, and error states.
- **Progressive disclosure** — Show execution details and citations only when useful; keep management functions out of the default workspace.
- **Agent operations** — Configure agents, Skills, MCP connections, knowledge bases, models, and execution nodes from a dedicated management workspace.
- **Bilingual interface** — Support instant Simplified Chinese and English switching, with the preference persisted locally.
- **Accessible and responsive** — Support keyboard operation, light and dark themes, and desktop, tablet, and mobile layouts.

## Technology

| Area | Choice |
| --- | --- |
| Framework | React 19, TypeScript, Vite |
| Server state | TanStack Query |
| Forms | React Hook Form, Zod |
| UI primitives | Radix UI, Lucide icons |
| Markdown | react-markdown, remark-gfm |
| Streaming | EventSource parser |
| Internationalization | i18next, react-i18next |

## Prerequisites

- Node.js 20 or newer
- npm
- A running CycberCompany backend (the development default is `http://localhost:8080`)

## Quick start

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). In development, Vite proxies `/api` requests to `http://localhost:8080` by default.

Build a production bundle and run static checks:

```powershell
npm run build
npm run lint
```

Preview the production build locally:

```powershell
npm run preview
```

## Configuration

Copy `.env.example` to `.env` when you need local overrides. Do not commit `.env` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | Browser-facing API root. Use the deployed backend API root when frontend and backend use different origins. |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:8080` | Backend target for the Vite development proxy. |
| `VITE_NODE_SERVER_URL` | empty | Direct loopback backend address for the local executor launch command. |

## Run with Docker

From the frontend repository root, start the frontend, Spring Boot backend, and SearXNG search service together:

```powershell
$env:EDGEFN_API_KEY = 'sk-...'
docker compose up -d --build
```

Then open [http://localhost:5173](http://localhost:5173). The backend is published only to the host loopback interface on port `8083`; the frontend connects through its same-network proxy, while the backend uses SearXNG internally.

```powershell
docker compose start
docker compose stop
```

Source folders are mounted into the containers for development. Node modules, Gradle caches, and backend build output stay in Docker volumes rather than being written to the host workspace.

## Project structure

```text
src/
├── components/   Reusable workspace and management UI
├── lib/          API client, i18n, streaming, and utility code
├── App.tsx       Application composition and user flows
├── App.css       Semantic visual tokens and responsive styles
└── types.ts      Frontend domain types
```

## Product conventions

Read [the frontend UI specification](docs/frontend-ui-spec.md) before changing the interface. It defines mandatory conventions for the conversation-first layout, progressive disclosure, themes, bilingual support, responsiveness, and accessibility.
