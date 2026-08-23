# Ayooda — Local Setup Instructions

These are commands to run in a fresh Claude Code session inside `/Users/nick/Projects/ayooda` to scaffold the full project. Run them in order.

---

## Step 1 — Root monorepo scaffolding

Create the pnpm workspace configuration and root package.json:

```
Create a file at pnpm-workspace.yaml with content:
packages:
  - 'apps/*'
  - 'packages/*'
```

```
Create a file at package.json with content:
{
  "name": "ayooda",
  "private": true,
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "dev:api": "pnpm --filter api dev",
    "dev:widget": "pnpm --filter widget dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

```
Create a file at tsconfig.base.json with content:
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

Create the directory structure:
```
mkdir -p apps/web apps/api apps/widget apps/scraper packages/shared docs
```

---

## Step 2 — packages/shared (TypeScript types)

```
Create packages/shared/package.json with content:
{
  "name": "@ayooda/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.5"
  }
}
```

```
Create packages/shared/tsconfig.json with content:
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

```
Create packages/shared/src/index.ts with content:
// LLM Providers
export type LLMProvider = 'claude' | 'openai' | 'gemini'

// Knowledge base
export type KnowledgeDocType = 'webpage' | 'file'
export type KnowledgeDocStatus = 'pending' | 'processing' | 'indexed' | 'error'

// Conversations
export type ConversationStatus = 'bot' | 'human' | 'resolved'
export type MessageRole = 'user' | 'assistant' | 'operator'

// Channels
export type ChannelType = 'web_widget' | 'telegram'

// Firestore models
export interface UserDoc {
  email: string
  displayName: string
  photoURL: string | null
  workspaceId: string
  createdAt: Date
}

export interface AgentConfig {
  name: string
  photoURL: string | null
  description: string
  systemPrompt: string
  llmProvider: LLMProvider
  llmApiKey: string
  llmModel: string
}

export interface WorkspaceUsage {
  conversationCount: number
  tokenCount: number
}

export interface WorkspaceDoc {
  name: string
  ownerId: string
  createdAt: Date
  agent: AgentConfig
  usage: WorkspaceUsage
}

export interface KnowledgeDoc {
  type: KnowledgeDocType
  source: string
  status: KnowledgeDocStatus
  chunkCount: number
  errorMessage: string | null
  createdAt: Date
  indexedAt: Date | null
}

export interface WidgetConfig {
  widgetColor: string
  widgetPosition: 'bottom-right' | 'bottom-left'
  welcomeMessage: string
  agentName: string
  agentPhotoURL: string | null
}

export interface ChannelDoc {
  type: ChannelType
  config: WidgetConfig
  embedCode: string
  isActive: boolean
  createdAt: Date
}

export interface MessageMetadata {
  sources: Array<{ docId: string; source: string; score: number }>
  llmProvider?: string
  promptTokens?: number
  completionTokens?: number
}

export interface MessageDoc {
  role: MessageRole
  content: string
  createdAt: Date
  metadata?: MessageMetadata
}

export interface ConversationDoc {
  channelId: string
  visitorId: string
  status: ConversationStatus
  operatorId: string | null
  createdAt: Date
  updatedAt: Date
  lastMessage: string
}

// API types
export interface ChatRequest {
  agentId: string
  conversationId: string
  message: string
  visitorId: string
}

export interface WidgetConfigResponse {
  agentName: string
  agentPhotoURL: string | null
  widgetColor: string
  widgetPosition: 'bottom-right' | 'bottom-left'
  welcomeMessage: string
}
```

---

## Step 3 — apps/web (Next.js)

Run in the `apps/web` directory:

```bash
cd apps/web && pnpm create next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbo
```

After creation, add dependencies:

```bash
cd apps/web && pnpm add \
  firebase \
  @ayooda/shared \
  lucide-react \
  clsx \
  tailwind-merge

pnpm add -D \
  @types/node
```

Create the environment file:

```
Create apps/web/.env.local.example with content:
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Create the Firebase client config:

```
Create apps/web/src/lib/firebase.ts with content:
import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const db = getFirestore(app)
export default app
```

Update `apps/web/package.json` to add workspace reference and rename:

```
In apps/web/package.json, set "name" to "web" and add "@ayooda/shared": "workspace:*" to dependencies
```

---

## Step 4 — apps/api (Hono on Bun)

```
Create apps/api/package.json with content:
{
  "name": "api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --outfile dist/index.js --target bun",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ayooda/shared": "workspace:*",
    "hono": "^4.4.0",
    "firebase-admin": "^12.2.0",
    "@pinecone-database/pinecone": "^3.0.0",
    "@google/generative-ai": "^0.15.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/bun": "latest"
  }
}
```

```
Create apps/api/tsconfig.json with content:
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

```
Create apps/api/.env.example with content:
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
PINECONE_API_KEY=
PINECONE_INDEX=ayooda-prod
GEMINI_API_KEY=
SCRAPER_JOB_URL=
PORT=3001
```

```
Create apps/api/src/index.ts with content:
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ ok: true }))

// Routes will be added here:
// import authRoutes from './routes/auth'
// import workspaceRoutes from './routes/workspace'
// import knowledgeRoutes from './routes/knowledge'
// import conversationRoutes from './routes/conversations'
// import channelRoutes from './routes/channels'
// import widgetRoutes from './routes/widget'

const port = parseInt(process.env.PORT ?? '3001')
console.log(`API running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
```

```
Create apps/api/src/lib/firebase-admin.ts with content:
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

if (getApps().length === 0) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '{}')
  initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  })
}

export const adminDb = getFirestore()
export const adminAuth = getAuth()
```

```
Create apps/api/src/middleware/auth.ts with content:
import { createMiddleware } from 'hono/factory'
import { adminAuth, adminDb } from '../lib/firebase-admin'

export type AuthVariables = {
  uid: string
  workspaceId: string
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authorization.slice(7)
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    const userDoc = await adminDb.doc(`users/${decoded.uid}`).get()
    if (!userDoc.exists) {
      return c.json({ error: 'User not found' }, 404)
    }
    const userData = userDoc.data()!
    c.set('uid', decoded.uid)
    c.set('workspaceId', userData.workspaceId)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})
```

Create the Dockerfile for Cloud Run:

```
Create apps/api/Dockerfile with content:
FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lockb* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run --filter api build

FROM base AS release
COPY --from=build /app/apps/api/dist ./dist
COPY --from=install /app/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "dist/index.js"]
```

---

## Step 5 — apps/widget (Vite + vanilla TypeScript)

```
Create apps/widget/package.json with content:
{
  "name": "widget",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vite": "^5.3.0"
  }
}
```

```
Create apps/widget/tsconfig.json with content:
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

```
Create apps/widget/vite.config.ts with content:
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'AyoodaWidget',
      fileName: 'widget',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: 'es2020',
    minify: true,
  },
})
```

```
Create apps/widget/src/index.ts with content:
// Ayooda Widget — entry point
// Reads data-agent-id from the script tag and initializes the chat widget

const currentScript = document.currentScript as HTMLScriptElement | null
const agentId = currentScript?.getAttribute('data-agent-id')

if (!agentId) {
  console.error('[Ayooda] Missing data-agent-id attribute on widget script tag')
} else {
  // Dynamic import of widget initialization
  // Full implementation added in subsequent steps
  console.log(`[Ayooda] Widget initialized for agent: ${agentId}`)
}
```

---

## Step 6 — apps/scraper (Puppeteer Cloud Run Job)

```
Create apps/scraper/package.json with content:
{
  "name": "scraper",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "start": "node dist/index.js",
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ayooda/shared": "workspace:*",
    "puppeteer": "^22.12.0",
    "firebase-admin": "^12.2.0",
    "@pinecone-database/pinecone": "^3.0.0",
    "@google/generative-ai": "^0.15.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/node": "^20.14.0",
    "ts-node": "^10.9.2"
  }
}
```

```
Create apps/scraper/tsconfig.json with content:
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "CommonJS",
    "moduleResolution": "node",
    "target": "ES2022"
  },
  "include": ["src"]
}
```

```
Create apps/scraper/.env.example with content:
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_KEY=
PINECONE_API_KEY=
PINECONE_INDEX=ayooda-prod
GEMINI_API_KEY=
# Passed by the triggering API call:
WORKSPACE_ID=
DOC_ID=
URL=
```

```
Create apps/scraper/src/index.ts with content:
// Ayooda Scraper — Cloud Run Job entry point
// Environment variables set by the triggering API:
//   WORKSPACE_ID, DOC_ID, URL

async function main() {
  const workspaceId = process.env.WORKSPACE_ID
  const docId = process.env.DOC_ID
  const url = process.env.URL

  if (!workspaceId || !docId || !url) {
    console.error('Missing required env vars: WORKSPACE_ID, DOC_ID, URL')
    process.exit(1)
  }

  console.log(`Scraping ${url} for workspace ${workspaceId}`)
  // Full implementation added in subsequent steps:
  // 1. Update Firestore doc status to 'processing'
  // 2. Launch Puppeteer, crawl URL + linked pages
  // 3. Extract and clean text content
  // 4. Chunk text (~500 tokens, 50-token overlap)
  // 5. Embed chunks via Google text-embedding-004
  // 6. Upsert to Pinecone (namespace: workspace_{workspaceId})
  // 7. Update Firestore doc status to 'indexed' with chunkCount
}

main().catch((err) => {
  console.error('Scraper failed:', err)
  process.exit(1)
})
```

---

## Step 7 — Firebase configuration

```
Create firebase.json with content:
{
  "hosting": {
    "public": "apps/widget/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "headers": [
      {
        "source": "/widget.js",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=86400" },
          { "key": "Access-Control-Allow-Origin", "value": "*" }
        ]
      }
    ]
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

```
Create .firebaserc with content:
{
  "projects": {
    "default": "YOUR_FIREBASE_PROJECT_ID"
  }
}
```

```
Create firestore.rules with content:
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only read/write their own user document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Workspace: only the owner can read/write
    match /workspaces/{workspaceId} {
      allow read, write: if request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.workspaceId == workspaceId;

      // Sub-collections follow same rule
      match /knowledge/{docId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.workspaceId == workspaceId;
      }

      match /channels/{channelId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.workspaceId == workspaceId;
      }

      match /conversations/{conversationId} {
        allow read, write: if request.auth != null
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.workspaceId == workspaceId;

        match /messages/{messageId} {
          allow read, write: if request.auth != null
            && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.workspaceId == workspaceId;
        }
      }
    }
  }
}
```

```
Create firestore.indexes.json with content:
{
  "indexes": [
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "channelId", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

---

## Step 8 — Root .gitignore

```
Create .gitignore with content:
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.next/
out/

# Environment files
.env
.env.local
.env.*.local

# Firebase
.firebase/
firebase-debug.log
firestore-debug.log

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.suo
*.ntvs*
*.njsproj
*.sln

# Logs
*.log
npm-debug.log*
pnpm-debug.log*
```

---

## Step 9 — Install all dependencies

Run from the repo root:

```bash
pnpm install
```

---

## Step 10 — Verify setup

Run these checks to confirm the monorepo is wired up correctly:

```bash
# Type-check all packages
pnpm typecheck

# Start the API dev server (Bun)
pnpm dev:api

# In a separate terminal, start the Next.js dev server
pnpm dev:web
```

The API should be running at `http://localhost:3001/health` → `{ "ok": true }`
The web app should be running at `http://localhost:3000`

### Development login helper

To open the local dashboard as an existing Firebase Authentication user without
entering credentials, run from the repo root:

```bash
pnpm dev:login -- developer@example.com
```

The helper creates a short-lived Firebase custom token, places it in the URL
fragment (so it is not sent to the Next.js server), and opens the local app. The
login page removes the fragment immediately and creates the same Firebase and
session-cookie state as a normal sign-in. It refuses production and non-local
URLs. Set `DEV_AUTH_USER` in `apps/web/.env.local` to omit the email argument,
or add `--from=/dashboard/agents` to choose the destination. Use `--print` only
when you need to open the sensitive one-time URL manually.

This requires `FIREBASE_SERVICE_ACCOUNT_KEY` in `apps/web/.env.local` or working
Google Application Default Credentials, and the target Firebase user must
already exist.

---

## Step 11 — Firebase project wiring

1. Go to the [Firebase Console](https://console.firebase.google.com) and open your project
2. Enable **Firestore Database** in Native mode
3. Enable **Authentication** — turn on Google and Email/Password providers
4. Generate a **Service Account** key: Project Settings → Service Accounts → Generate new private key
5. Copy the JSON key content into `FIREBASE_SERVICE_ACCOUNT_KEY` in `apps/api/.env`
6. Copy your web app's Firebase config values into `apps/web/.env.local`
7. Update `.firebaserc` with your project ID
8. Deploy Firestore rules: `firebase deploy --only firestore`

---

## Step 12 — External service setup

### Pinecone
1. Create a Pinecone account at [pinecone.io](https://www.pinecone.io)
2. Create an index named `ayooda-dev` with:
   - **Dimensions**: 768
   - **Metric**: cosine
   - **Cloud**: GCP (to minimize latency with Cloud Run)
3. Copy your API key into `PINECONE_API_KEY` in `apps/api/.env` and `apps/scraper/.env`

### Google Gemini (embeddings)
1. Go to [Google AI Studio](https://aistudio.google.com)
2. Generate an API key
3. Copy it into `GEMINI_API_KEY` in `apps/api/.env` and `apps/scraper/.env`

---

## Directory structure after setup

```
ayooda/
├── apps/
│   ├── web/                    ← Next.js app (landing + dashboard)
│   │   ├── src/
│   │   │   ├── app/            ← App Router pages
│   │   │   └── lib/
│   │   │       └── firebase.ts
│   │   ├── .env.local.example
│   │   └── package.json
│   ├── api/                    ← Hono on Bun
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── lib/
│   │   │   │   └── firebase-admin.ts
│   │   │   └── middleware/
│   │   │       └── auth.ts
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   └── package.json
│   ├── widget/                 ← Embeddable JS snippet
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── scraper/                ← Cloud Run Job
│       ├── src/
│       │   └── index.ts
│       ├── .env.example
│       └── package.json
├── packages/
│   └── shared/                 ← TypeScript types
│       ├── src/
│       │   └── index.ts
│       └── package.json
├── docs/
│   ├── architecture.md
│   ├── project-description.md
│   └── setup-instructions.md
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc
├── .gitignore
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```
