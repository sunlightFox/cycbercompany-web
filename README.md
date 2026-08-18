# CycberCompany Web

[中文](README.md) | [English](README.en.md)

CycberCompany Web 是 CycberCompany 的对话优先工作台。它将持久化会话、任务流式进度、引用来源，以及 Agent、Skill、MCP、知识库、模型和本机执行能力的按需管理整合在同一套前端中。

## 项目链接

- [后端代码仓库](https://github.com/sunlightFox/spring-agent-studio-backend)
- [技术文档](https://cycbercompany.chat/docs)

## 主要能力

- **对话优先工作台**：在同一条消息流中呈现用户任务、助手回答和执行过程。
- **实时任务进度**：通过 SSE 接收后端 Run 事件，覆盖执行进度、审批、完成、取消和错误状态。
- **渐进披露**：仅在需要时展示执行细节与引用来源，默认工作台保持专注。
- **Agent 管理**：在独立管理工作区中配置 Agent、Skill、MCP、知识库、模型和执行节点。
- **本机执行支持**：引导用户连接受管本机执行器或兼容节点，并清晰呈现执行边界。
- **中英文界面**：支持简体中文与英文即时切换，并在本地保存语言偏好。
- **可访问与响应式**：支持键盘操作、浅色与深色主题，以及桌面、平板和移动端布局。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 框架 | React 19、TypeScript、Vite |
| 服务端状态 | TanStack Query |
| 表单 | React Hook Form、Zod |
| UI 基础组件 | Radix UI、Lucide 图标 |
| Markdown | react-markdown、remark-gfm |
| 流式事件 | EventSource parser |
| 国际化 | i18next、react-i18next |

## 环境要求

- Node.js 20 或更高版本
- npm
- 正在运行的 CycberCompany 后端；开发环境默认连接 `http://localhost:8080`

## 快速开始

```powershell
npm install
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)。开发环境中，Vite 默认将 `/api` 请求代理到 `http://localhost:8080`。

构建生产包并执行静态检查：

```powershell
npm run build
npm run lint
```

本地预览生产构建：

```powershell
npm run preview
```

## 配置

需要本地覆盖配置时，将 `.env.example` 复制为 `.env`。请勿提交 `.env` 文件。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | 浏览器访问的 API 根路径。前后端部署在不同域名时，填写已部署后端的 API 根路径。 |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:8080` | Vite 开发代理的后端地址。 |
| `VITE_NODE_SERVER_URL` | 空 | 本机执行器启动命令使用的直接回环后端地址。 |

## 使用 Docker 启动

在前端仓库根目录同时启动前端、Spring Boot 后端和 SearXNG 搜索服务：

```powershell
$env:EDGEFN_API_KEY = 'sk-...'
docker compose up -d --build
```

随后打开 [http://localhost:5173](http://localhost:5173)。后端只会通过主机回环地址暴露在 `8083` 端口；前端经由同网络中的代理访问后端，后端则在内部使用 SearXNG 搜索服务。

```powershell
docker compose start
docker compose stop
```

开发模式会将源码目录挂载进容器；Node 依赖、Gradle 缓存和后端构建产物保存在 Docker volume 中，不会写入主机工作区。

## 项目结构

```text
src/
├── components/   工作台与管理功能的可复用界面
├── lib/          API 客户端、国际化、流式处理和工具代码
├── App.tsx       应用组合与主要用户流程
├── App.css       语义化视觉令牌与响应式样式
└── types.ts      前端领域类型
```

## 产品规范

修改界面前，请阅读 [前端界面规范](docs/frontend-ui-spec.md)。该规范定义了对话优先布局、渐进披露、主题、中英文支持、响应式和无障碍的强制要求。
