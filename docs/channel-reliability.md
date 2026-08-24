# Channel reliability dashboard

Workspace owners can open **Dashboard → Channel health** to monitor every deployed web widget, Telegram bot, Resend mailbox, Slack app, and Twilio SMS number.

## What it reports

- **Live connection checks** validate the stored provider credential and channel configuration without sending a customer message.
- **Inbound outcomes** are recorded after supported provider webhooks are authenticated and processed.
- **Outbound outcomes** cover operator replies, email workflow replies, and provider delivery errors captured by the channel handlers.
- Each channel keeps aggregate success/failure counters, consecutive failures, last inbound/outbound activity, and up to eight recent events in the UI.

Health is intentionally conservative:

| Status | Meaning |
|---|---|
| Healthy | At least one successful check or delivery has completed after the latest failure. |
| Needs attention | The latest reliability sequence contains one or more failures. |
| Not checked | The channel is connected but has no reliability data yet. |
| Inactive | The channel document is disabled. |

## Storage and security

Summaries live at `workspaces/{workspaceId}/channelReliability/{channelId}`. Individual events live in the nested `events` collection and carry an `expiresAt` timestamp 30 days after creation; expired events are hidden from the dashboard. Firestore client access is denied, and provider errors are normalized, truncated, and stripped of common credential formats before storage.

## Operational boundaries

A successful connection check proves that the credential is accepted by the provider at that moment. It does not send a test message or prove that a third-party webhook is configured correctly. Recent inbound activity is the stronger signal that a webhook is reaching Ayooda.

The dashboard does not automatically redeliver failed customer messages. Automatic redelivery needs provider-specific idempotency and payload retention; until that is implemented, fix the reported credential/configuration issue and use the Inbox to resend an operator reply.
