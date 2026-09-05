---
article_id: agent-test
title: Test chat and regression suite
slug: test-chat-and-regression-suite
category: Agents
route: /dashboard/agents/:agentId/test
roles: [owner, member]
summary: "Run realistic sandbox conversations, inspect confidence and workflow outcomes, safely test tools, and maintain repeatable regression cases."
keywords: [test agent, sandbox, regression tests, evaluation suite, confidence, sources, connected tools, streaming, hand-off]
related_articles: [agent-knowledge, agent-workflows, agent-tools, agent-deploy]
status: published
updated_at: 2026-09-04
---

# Test chat and regression suite

Test uses the agent's saved identity, model, indexed knowledge, skills, and workflow rules in a sandbox. Sandbox sessions stay out of the customer Inbox, customer analytics, and conversation limits.

## Regression suite

Regression tests protect stable facts and behaviors from accidental changes. A test contains a name, customer message, phrases the answer must mention, phrases it must avoid, and an enabled state. Only enabled tests are included when you run the suite.

Choose **Run suite** after changing instructions, models, knowledge, skills, or workflows. Review the customer prompt, captured agent response, expected outcome, and failure reasons. Phrase checks are useful but cannot prove an answer is factually correct, so write focused cases for important policies and unsafe claims.

## Sandbox conversation

Choose a preset scenario—Knowledge answer, Uncertain question, or Human hand-off—or enter a custom customer message. Replies stream into the chat and render Markdown.

Diagnostics show:

- **Flow** — whether the bot remains active or a workflow moved, routed, resolved, or handed off the conversation;
- **Confidence** — the strongest retrieval evidence from the latest response;
- **Sources** — how many knowledge matches supported the response;
- **Tools** — whether connected tools are live for this sandbox.

Sources support diagnostics but are not shown as customer-facing citations in the response.

## Connected tools and reset

Connected tools are off by default for safety. Enabling them can read or change real external systems. Use test accounts, harmless prompts, and reversible actions. This switch covers connected action execution; it does not make an external service a sandbox.

When a workflow ends or hands off the test conversation, use **Reset session** before continuing. Reset also clears the current sandbox context. If a result is unexpected, confirm the latest configuration was saved, knowledge finished indexing, the intended workflow engine is active, and the selected model connection is valid.

