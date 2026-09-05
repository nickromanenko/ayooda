---
article_id: agent-deploy
title: Deploy agents and channels
slug: deploy-agents-and-channels
category: Agents
route: /dashboard/agents/:agentId/deploy
roles: [owner, member]
summary: "Check launch readiness, install and customize the website widget, and connect Telegram, email, Slack, or Twilio SMS channels."
keywords: [deploy, widget, embed code, Next.js, Angular, Telegram, Resend, email, Slack, Twilio, SMS, channel]
related_articles: [channel-health, agent-test, agent-info, agent-security]
status: published
updated_at: 2026-09-04
---

# Deploy agents and channels

Deploy connects an agent to customer-facing channels. A channel uses this agent's current saved configuration, so test important changes before directing traffic to it.

## Launch readiness

Launch readiness checks required and recommended setup such as agent identity, indexed knowledge, regression tests, workflows, and channel state. Required blockers indicate missing essentials; recommended items improve quality or safety. The score is guidance, not a deployment lock. Refresh it after changing related configuration.

## Website widget

Create a website widget to receive an embed code containing this agent's public widget identifier. Use the installation guide for the site's architecture:

- on HTML or a multi-page site, add the script once in the shared page template;
- in Next.js, load it once from the root layout with the framework's script component;
- in Angular, add it once to the application shell or global document.

A single installation works across client-side SPA route changes. Widget path rules are evaluated as navigation changes. Do not inject a new script on every route.

Installation status reports whether Ayooda has observed a configuration load, the last origin and time, and detected domains. Reload the installed site, then choose **Check installation again**. If it remains undetected, inspect the browser console and allow Ayooda's CDN in Content Security Policy `script-src` and the API origin in `connect-src`.

## Widget settings

The interactive preview uses the production renderer but keeps preview messages local.

- **Appearance** controls brand colour and contrast, light/dark/automatic theme, launcher position and offsets, and plan-dependent Ayooda branding.
- **Content** controls header title and subtitle, welcome message, composer placeholder, launcher greeting, interface language, and localized custom copy. A blank title uses the agent name from Info.
- **Behavior** can pause the widget without changing embed code, auto-open it, delay the greeting, control desktop/mobile visibility, include or exclude path patterns, choose conversation persistence, and enable reply sound. Exclude rules win. Returning-visitor persistence stores a conversation identifier in the browser.
- **Security** restricts embedding to allowed domains and configures a privacy-policy URL and notice. Add detected domains or explicit hostnames and wildcards.

Use desktop/mobile and light/dark preview modes plus welcome, Markdown, hand-off, error, long-content, and streaming scenarios before saving. Widget engagement reports configuration loads, visibility, opens, conversations, conversion rates, and helpful-answer feedback for the selected range.

Authenticated websites can identify signed-in visitors through the documented widget identity API. Set stable application user ID, name, and email only after authentication, and clear identity on sign-out; never place trusted identity data directly in public HTML.

Removing the widget makes existing embed code stop working immediately but does not delete conversation history.

## Other channels

- **Telegram** uses a BotFather bot token.
- **Email** uses Resend credentials, verified sender and inbox addresses, and the displayed inbound webhook URL and signing secret.
- **Slack** uses a Bot User OAuth token, signing secret, required app permissions/events, and the displayed Events API request URL.
- **SMS via Twilio** uses an Account SID, Auth Token, E.164 Twilio number, and the displayed incoming-message webhook URL.

Credentials are sensitive and should have the minimum required permissions. After connecting, send a controlled message and verify both the conversation in Inbox and transport health on Channel health. Disconnecting stops future channel traffic but does not delete prior conversations.

