---
article_id: channel-health
title: Channel health and alerts
slug: channel-health-and-alerts
category: Operations
route: /dashboard/channels
roles: [owner]
summary: "Check every connected channel, diagnose delivery failures, review recent activity, and configure owner reliability alerts."
keywords: [channel health, delivery failures, diagnostics, alerts, credentials, inbound, outbound, recovery]
related_articles: [agent-deploy, inbox, team]
status: published
updated_at: 2026-09-04
---

# Channel health and alerts

Channel health gives owners an operational view of every deployed channel across all agents. It checks provider credentials, summarizes successful and failed activity, and shows recent inbound and outbound events.

## Read channel status

Each channel card identifies the provider and agent, current state, successful and failed event totals, last activity, and recent event details. A failing state means Ayooda detected a provider, credential, or delivery problem; it does not delete or disconnect the channel.

Choose **Check** on one channel to run its provider-specific diagnostic, or **Check all** to refresh every connected channel. Diagnostics can make safe verification requests to the provider but do not create a customer conversation. If there are no channels, open an agent's Deploy page.

## Reliability alerts

Reliability alerts notify owners when a channel reaches the configured failure threshold and notify them again after recovery. Ayooda sends one alert per incident instead of one alert per failed event. Configure the available transport and destination, enable alerts, then save.

Alert-delivery failures are recorded but are not retried automatically. Confirm the destination and provider configuration if the channel card says an alert could not be delivered.

## Respond to an incident

1. Open the failing channel and read the latest event detail.
2. Run **Check** to distinguish a current configuration problem from an older failure.
3. Verify credentials, webhook URLs, provider permissions, and sender configuration on the agent's Deploy page.
4. Send a controlled test through the affected channel.
5. Confirm the channel returns to healthy and that a recovery alert arrives when alerts are enabled.

The Inbox remains the source of truth for customer-visible conversation state. Channel health is the source of truth for transport and provider delivery health.

