# Ayooda — Project Description

## What Is Ayooda?

Ayooda is a customer support automation platform that lets any company deploy an AI-powered support agent in minutes. Visitors on your website get instant, accurate answers to their questions — without your team lifting a finger.

You connect your website or upload your documentation, give your agent a name and a face, and Ayooda handles the rest. A single `<script>` tag drops a floating chat widget onto your site. The agent reads from your knowledge base, converses naturally with visitors, and escalates to your human team only when it needs to.

---

## The Problem

Support teams are drowning in repetitive questions. "How do I reset my password?" "What's your refund policy?" "Do you integrate with X?" — the same questions, hundreds of times a day, answered by humans who could be doing higher-value work.

Existing AI support tools are either locked inside large, expensive platforms (Intercom, Zendesk) or require significant engineering effort to set up. Small and mid-sized businesses need something that works in an afternoon, not a quarter.

---

## Who It's For

- **SaaS companies** with a product that generates repetitive support questions
- **E-commerce stores** that need 24/7 answers about orders, shipping, and returns
- **Agencies and consultancies** that want to deflect FAQ traffic before it hits their team
- **Startups** that can't afford a full support team but need to look like they have one

---

## Core Value Proposition

> Deploy an AI support agent in under an hour. It knows your product. It sounds like your brand. It never sleeps.

- **No engineering required** — paste a script tag, done
- **Your knowledge, automatically** — point it at your website and it learns
- **Your brand voice** — give it a name, photo, and custom instructions
- **Your AI model** — bring your own API key for Claude, GPT-4o, or Gemini
- **Your team stays in control** — operators can take over any conversation live

---

## Features

### Onboarding
- Sign up with Google or email
- Create your workspace and agent in a guided flow
- Provide your website URL — Ayooda crawls and indexes it automatically
- Upload additional files (PDFs, Word docs, CSVs) as supplemental knowledge
- Set your agent's name, avatar, and personality instructions
- Choose your LLM provider and connect your API key

### Knowledge Base
- Website scraping with multi-page crawl (sitemaps supported)
- File uploads: PDF, DOCX, TXT, CSV, MD
- Each source shows indexing status (pending → processing → indexed)
- Delete individual sources and remove their vectors from the knowledge base
- Re-index sources on demand after content updates

### AI Agent
- Retrieval-augmented generation (RAG) — answers grounded in your actual content
- LLM of your choice: Claude (Anthropic), GPT-4o (OpenAI), or Gemini (Google)
- Custom system prompt — define tone, rules, and escalation triggers
- Conversation history context — the agent remembers earlier messages in the session
- Source attribution — every response cites which documents it drew from

### Web Widget
- Floating chat button, customizable color and position
- Shadow DOM rendering — zero style conflicts with your site
- Mobile-responsive
- Agent avatar and name shown in the chat header
- Instant deploy: one `<script>` tag, no build step required
- Works on any website — static HTML, WordPress, Webflow, React, etc.

### Live Inbox
- Real-time conversation feed across all your channels
- Filter by status: bot-handled, awaiting human, resolved
- Operators can take over any conversation instantly
- Full message history with source attribution visible
- Mark conversations as resolved

### Channels
- **Web Widget** — available now
- **Telegram** — coming soon
- **WhatsApp** — coming soon
- **Messenger** — coming soon
- **Slack** — coming soon

### Dashboard
- Overview metrics: total conversations, automation rate, response time
- Knowledge base health: number of indexed documents and chunks
- Recent conversation activity

---

## How It Works

```
1. CONNECT
   You enter your website URL or upload files.
   Ayooda crawls your content, splits it into chunks,
   and stores it as searchable vectors.

2. CUSTOMIZE
   Give your agent a name, photo, and instructions.
   Connect your preferred LLM with your API key.
   Configure your widget's appearance.

3. DEPLOY
   Copy a single <script> tag.
   Paste it into your website's HTML.
   Your agent goes live immediately.
```

---

## Technical Highlights

- **Bring your own LLM** — Claude, GPT-4o, or Gemini. Your API key, your costs, your data.
- **RAG architecture** — responses are grounded in your content, not hallucinated
- **Pinecone vector database** — millisecond semantic search across your knowledge base
- **Google embeddings** — text-embedding-004 for high-quality 768-dimensional vectors
- **Firebase infrastructure** — Firestore, Firebase Auth, App Hosting, all within one Google Cloud project
- **Real-time updates** — the inbox updates live using Firestore listeners, no polling
- **Streaming responses** — LLM output streams token-by-token to the widget for a fast, natural feel

---

## Competitive Positioning

| | Ayooda | Hugo by Crisp | Intercom Fin |
|---|---|---|---|
| Standalone product | Yes | No (requires Crisp) | No (requires Intercom) |
| Bring your own LLM | Yes | Yes | No |
| Pricing model | Per-conversation (planned) | $0.05/conversation + plan | $0.99/resolution |
| Setup time | < 1 hour | Minutes (within Crisp) | Days |
| Live inbox | Yes | Via Crisp | Via Intercom |
| Open channel ecosystem | Yes (roadmap) | 10 channels | Multiple channels |
| Self-hostable | Planned | No | No |

---

## Roadmap

### v1 — Core Platform
- Landing page + sign up
- Onboarding: website scraping + file upload + agent config
- Web widget with RAG-powered chat
- Live inbox with human takeover
- Dashboard with basic analytics

### v2 — Channels
- Telegram bot integration
- WhatsApp via Meta Cloud API
- Messenger via Meta Pages

### v3 — Monetization
- Usage-based billing (per-conversation pricing)
- Stripe integration + subscription tiers
- Free tier with conversation credits

### v4 — Advanced
- Workflow builder (escalation rules, routing logic)
- CRM / tool integrations via API
- Custom webhook actions (look up orders, update records)
- Multiple agents per workspace
- Self-hosting option
