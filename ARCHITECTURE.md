# Especificação Arquitetural e Plano de Implementação — MoniBot

## 1. Visão Geral do Projeto
O **MoniBot** é um sistema de monitoria acadêmica virtual inteligente projetado para operar dentro de salas de videoconferência federadas baseadas em **MatrixRTC (MSC4143 / MSC4195)** e **LiveKit SFU**[cite: 1, 2, 7].
O agente ingressa na chamada como um participante ativo em tempo real, escuta as dúvidas dos estudantes de **Fundamentos de Programação** por voz, consulta uma base de conhecimento vetorizada (**RAG**) composta por notas de aula, listas de exercícios e provas anteriores, e responde em áudio em tempo real com suporte a um avatar visual sincronizado[cite: 1, 2, 3, 4, 5]. Além disso, a plataforma coleta métricas quantitativas de latência de cada etapa do pipeline e aplica questionários qualitativos baseados nas escalas **SUS (System Usability Scale)** e **TAM (Technology Acceptance Model)**[cite: 1, 5, 7].

---

## 2. Arquitetura do Monolito Modular (Bun + Hono + Next.js)

O projeto utiliza uma arquitetura de **Monolito Modular em Monorepo** gerenciada por **Bun Workspaces** e **Turborepo**:

- **Root (`/`)**
  - `package.json`: Configuração dos workspaces (`apps/*`, `packages/*`) e scripts globais.
  - `turbo.json`: Pipeline de execução (`dev`, `build`, `typecheck`, `lint`, `db:migrate`).
  - `biome.json`: Configuração unificada de formatação e linting.
  - `CLAUDE.md` & `.claude/`: Diretrizes de arquitetura e slash commands para o Claude Code.
- **Pacotes Internos Compartilhados (`/packages`)**
  - `packages/tsconfig` (`@monibot/tsconfig`): Configurações base de TypeScript (`base.json`, `nextjs.json`, `bun.json`).
  - `packages/logger` (`@monibot/logger`): Logger estruturado com níveis, timestamp e contexto de módulo.
  - `packages/types` (`@monibot/types`): Contratos Zod compartilhados (DTOs de RAG, sessões, telemetria, SUS/TAM e eventos de sala).
  - `packages/db` (`@monibot/db`): Cliente Drizzle ORM (`postgres-js`), schemas relacionais e vetoriais (`pgvector`) e migrations[cite: 4].
  - `packages/auth` (`@monibot/auth`): Configuração centralizada do Better Auth integrada ao Drizzle ORM.
- **Aplicações (`/apps`)**
  - `apps/api`: **Monolito Backend em Bun + Hono**. Expõe rotas REST/RPC tipadas (`AppType`) para o frontend e endpoints internos para o worker de voz. Gerencia ingestão e busca vetorial (RAG), orquestração MatrixRTC/LiveKit (`lk-jwt-service`), sessões experimentais e análise de métricas[cite: 4, 5, 7].
  - `apps/web`: **Frontend em Next.js (App Router)**. Inclui o Estúdio de Base de Conhecimento (upload e playground RAG), a Sala de Monitoria Síncrona (com Avatar reativo à voz do agente e transcrição em tempo real), o Formulário Pós-Sessão (SUS/TAM) e o Painel Científico do Pesquisador[cite: 1, 3, 4, 5].
  - `apps/agent-worker`: **Worker LiveKit Agents SDK**. Conecta-se à sala LiveKit como participante ativo, executando o pipeline local: `Silero VAD -> Whisper (STT) -> Hono RAG API -> Ollama Llama 3 (LLM) -> PiperTTS/CoquiTTS (TTS)` e reportando telemetria fim-a-fim[cite: 1, 2, 3, 5, 7].
- **Infraestrutura Auto-Hospedada (`/docker`)**
  - `docker/docker-compose.yml`: Orquestração local contendo PostgreSQL 16 (`pgvector`), Matrix Synapse, LiveKit SFU Server, `lk-jwt-service`, Element Call e Ollama[cite: 3, 4, 5, 7].

---

## 3. Modelagem de Dados (`@monibot/db` — Drizzle ORM + `pgvector`)

Implementar os schemas em `packages/db/src/schema/`:

### 3.1. `knowledge.ts` (Base de Conhecimento RAG)[cite: 1, 4]
- **`knowledge_documents`**:
  - `id` (UUID, PK), `title` (Text), `category` (`'lecture_slides' | 'exercise_list' | 'past_exam' | 'code_reference'`), `course` (Text, default `'Fundamentos de Programação'`), `rawText` (Text), `status` (`'processing' | 'indexed' | 'failed'`), `chunkCount` (Integer), `createdAt` (Timestamp)[cite: 1, 4].
- **`knowledge_chunks`**:
  - `id` (UUID, PK), `documentId` (UUID, FK cascade), `chunkIndex` (Integer), `content` (Text), `metadata` (JSONB: página, linguagem, seção), `embedding` (`vector(768)` para `nomic-embed-text` via Ollama), `createdAt` (Timestamp)[cite: 4, 5].
  - Índice HNSW em `embedding` com `vector_cosine_ops`.

### 3.2. `sessions.ts` (Sessões de Monitoria e Telemetria Quantitativa)[cite: 1, 3, 5]
- **`tutoring_sessions`**:
  - `id` (UUID, PK), `title` (Text), `matrixRoomId` (Text, nullable), `livekitRoomName` (Text, unique), `ragEnabled` (Boolean, default `true`), `avatarEnabled` (Boolean, default `true`), `llmModel` (Text, default `'llama3.1:8b'`), `status` (`'scheduled' | 'active' | 'ended'`), `startedAt` (Timestamp), `endedAt` (Timestamp)[cite: 1, 2, 3, 5].
- **`interaction_logs`**:
  - `id` (UUID, PK), `sessionId` (UUID, FK cascade), `studentTranscript` (Text), `retrievedChunks` (JSONB: array de `{ chunkId, score, excerpt }`), `agentResponse` (Text), `sttLatencyMs` (Integer), `ragLatencyMs` (Integer), `llmTtftMs` (Integer), `llmTotalLatencyMs` (Integer), `ttsLatencyMs` (Integer), `totalE2eLatencyMs` (Integer), `createdAt` (Timestamp)[cite: 1, 3, 4, 5, 7].

### 3.3. `evaluations.ts` (Avaliação Experimental SUS e TAM)[cite: 5, 7]
- **`user_evaluations`**:
  - `id` (UUID, PK), `sessionId` (UUID, FK cascade), `userId` (Text, nullable), `susAnswers` (JSONB: 10 perguntas Likert 1-5), `susCalculatedScore` (Real: 0 a 100), `tamPerceivedUsefulness` (Real: 1 a 5), `tamPerceivedEaseOfUse` (Real: 1 a 5), `avatarNaturalnessScore` (Real: 1 a 5, nullable), `comments` (Text), `createdAt` (Timestamp)[cite: 3, 5, 7].

---

## 4. Especificação dos Módulos da API (`apps/api` — Bun + Hono)

1. **`/api/auth/*`**: Montagem do handler do `@monibot/auth` (Better Auth).
2. **`/api/knowledge` (`knowledge.routes.ts` + `rag.service.ts`)**:
   - `POST /documents`: Recebe texto/markdown/código ou arquivo, executa *chunking* semântico preservando blocos de código, gera embeddings em lote no Ollama (`POST /api/embed`) e salva na tabela `knowledge_chunks`[cite: 1, 4, 5].
   - `GET /documents`: Lista os documentos indexados da disciplina e contagem de chunks[cite: 4].
   - `DELETE /documents/:id`: Remove um documento e seus vetores.
   - `POST /retrieve`: Recebe `{ query, topK = 4, minScore = 0.65 }`, gera o embedding da dúvida, realiza busca por similaridade de cosseno no `pgvector` e retorna os trechos relevantes + `ragLatencyMs`[cite: 4, 5].
3. **`/api/sessions` (`sessions.routes.ts` + `livekit.service.ts` + `matrix.service.ts`)**:
   - `POST /`: Cria uma nova sessão de monitoria definindo os parâmetros do experimento (`ragEnabled`, `avatarEnabled`, `matrixRoomId`)[cite: 1, 2, 3, 5].
   - `GET /`: Lista sessões ativas e históricas.
   - `POST /:id/token`: Gera token de acesso LiveKit para o estudante/monitor e garante que o `agent-worker` seja despachado para a sala[cite: 2, 4].
   - `POST /matrix-webhook`: Recebe eventos de chamada MatrixRTC (`m.call.member` / MSC4143) para disparar automaticamente o ingresso do MoniBot na sala[cite: 2, 4, 7].
4. **`/api/telemetry` (`telemetry.routes.ts`)**:
   - `POST /logs`: Endpoint protegido por `x-agent-secret` consumido pelo `agent-worker` a cada turno de fala para gravar transcrição, chunks recuperados e tempos de `STT`, `RAG`, `LLM`, `TTS` e `E2E`[cite: 1, 3, 4, 5, 7].
   - `GET /analytics`: Agrega métricas comparativas (Média, Mediana/p50, p95, Desvio Padrão) agrupadas por `ragEnabled` (Com RAG vs. Sem RAG) e `avatarEnabled` (Com Avatar vs. Sem Avatar)[cite: 1, 3, 5, 7].
5. **`/api/evaluations` (`evaluations.routes.ts`)**:
   - `POST /`: Recebe as 10 respostas da escala SUS e os itens do modelo TAM, calcula o score SUS oficial `((soma_impares - 5) + (25 - soma_pares)) * 2.5` e salva a avaliação[cite: 5, 7].
   - `GET /export`: Exporta os dados quantitativos e qualitativos em formato CSV/JSON para análise estatística da Iniciação Científica[cite: 5, 7].

---

## 5. Especificação do Frontend (`apps/web` — Next.js App Router)

1. **Estúdio da Base de Conhecimento (`/dashboard/knowledge`)**:
   - Interface de cadastro de conteúdos de *Fundamentos de Programação* (aulas teóricas, listas de exercícios e provas antigas)[cite: 1, 4].
   - **RAG Playground Comparativo**: Campo onde o pesquisador digita uma dúvida e visualiza lado a lado a resposta gerada pelo LLM Puro vs. LLM + RAG (exibindo os chunks recuperados e o score de similaridade de cosseno)[cite: 1, 2, 3, 4, 5].
2. **Sala de Monitoria Inteligente (`/room/[sessionId]`)**:
   - Conexão WebRTC via `@livekit/components-react` compatível com o backend LiveKit SFU / MatrixRTC[cite: 2, 3, 4].
   - **Componente Visual de Avatar (`<MoniBotAvatar/>`)**: Renderiza o avatar interativo sincronizado em tempo real com o espectro de áudio da track de voz do agente e com os estados transmitidos via DataChannel (`idle`, `listening`, `searching_rag`, `thinking`, `speaking`). Caso `avatarEnabled === false` na sessão, exibe apenas o indicador minimalista de áudio (para controle experimental)[cite: 3, 4, 5].
   - **Painel Lateral de Apoio Didático**: Exibe a transcrição da conversa em tempo real, snippets de código formatados e as fontes do material didático utilizadas pelo RAG na resposta[cite: 1, 4, 5].
3. **Questionário Pós-Monitoria (`/evaluation/[sessionId]`)**:
   - Formulário interativo passo a passo contendo os 10 itens da escala **SUS**, os itens de Utilidade Percebida e Facilidade de Uso do **TAM** e avaliação específica sobre o Avatar[cite: 3, 5, 7].
4. **Dashboard Científico e Telemetria (`/dashboard/analytics`)**:
   - Cards e gráficos comparando a latência de cada etapa (`STT`, `RAG`, `LLM`, `TTS`, `Total E2E`) e os scores SUS/TAM entre os grupos experimentais[cite: 1, 3, 5, 7].
   - Botão de exportação direta de datasets em CSV[cite: 5].

---

## 6. Roteiro de Execução Passo a Passo para o Claude Code

Execute a construção do projeto seguindo exatamente estas 5 fases sequenciais:

- **Fase 1 — Configuração do `.claude/` e Fundação do Monorepo**:
  - Crie os arquivos `.claude/rules/*.md` e `.claude/commands/*.md`.
  - Crie `package.json` raiz, `turbo.json`, `biome.json`, `.gitignore`, `.env.example`.
  - Implemente `packages/tsconfig` e `packages/logger`.
- **Fase 2 — Contratos Tipados e Banco de Dados (`pgvector`)**:
  - Implemente `packages/types` com todos os schemas Zod (Knowledge, Sessions, Telemetry, Evaluations).
  - Implemente `packages/db` com Drizzle ORM, schemas completos com `pgvector`, índice HNSW e utilitários de conexão.
  - Implemente `packages/auth` com Better Auth.
- **Fase 3 — Backend Monolítico em Bun + Hono (`apps/api`)**:
  - Implemente os serviços (`rag.service.ts`, `livekit.service.ts`, `matrix.service.ts`, `analytics.service.ts`).
  - Implemente todas as rotas encadeadas Hono com `zValidator` e exporte `export type AppType = typeof app`.
- **Fase 4 — Frontend em Next.js (`apps/web`)**:
  - Configure o cliente Hono RPC (`src/lib/rpc.ts`), Zustand stores e providers TanStack Query.
  - Construa o Dashboard de Conhecimento (com Playground RAG), o Painel de Sessões, a Sala de Monitoria em Tempo Real com o Avatar reativo ao áudio do LiveKit, a página de Avaliação SUS/TAM e o Dashboard de Métricas.
- **Fase 5 — Agente de Voz (`apps/agent-worker`) e Infraestrutura (`docker/`)**:
  - Implemente o worker do agente de voz integrando LiveKit Agents SDK com o pipeline local (Whisper STT -> Hono RAG -> Ollama Llama 3 -> Piper/Coqui TTS) e envio automático de telemetria[cite: 1, 3, 4, 5, 7].
  - Crie o `docker/docker-compose.yml` completo com PostgreSQL (`pgvector`), Matrix Synapse, LiveKit SFU, `lk-jwt-service`, Element Call e Ollama, além do `README.md` com instruções de execução[cite: 3, 4, 5, 7].
