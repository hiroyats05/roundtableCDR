# Sala de Reuniões

Aplicação privada de comunicação com chat em tempo real, canais de voz e compartilhamento de tela.

## Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js + Fastify + TypeScript
- **Realtime:** WebSocket (@fastify/websocket)
- **Banco:** PostgreSQL + Drizzle ORM
- **Áudio/Screen Share:** LiveKit

## Pré-requisitos

- Node.js 20+
- Docker e Docker Compose

## Setup

### 1. Infraestrutura (PostgreSQL + LiveKit)

```bash
docker compose up -d
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

### 4. Banco de dados

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### 5. Rodar a aplicação

Em terminais separados:

```bash
npm run dev:server
npm run dev:web
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- Health check: http://localhost:3000/health

## Cadastro

O cadastro requer um código de convite configurado em `REGISTER_INVITE_CODE` (padrão: `invite123`).

## Canais (seed)

| Tipo  | Nome     |
|-------|----------|
| TEXT  | geral    |
| TEXT  | jogos    |
| VOICE | Lobby    |
| VOICE | Jogando  |

## Arquitetura

```
HTTP     → auth, channels, messages, voice tokens
WebSocket → chat e presence
PostgreSQL → estado persistente
LiveKit  → áudio e screen share
```

## Estrutura

```
apps/
  web/      → React frontend
  server/   → Fastify backend
packages/
  shared/   → tipos e eventos compartilhados
```
