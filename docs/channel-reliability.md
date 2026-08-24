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

## Failure and recovery alerts

Owners can enable alerts from the **Reliability alerts** panel. A policy chooses a threshold from 2–10 consecutive failures and one or both delivery destinations:

- **Email** uses a selected connected Resend mailbox and defaults the recipient to the workspace owner's sign-in email.
- **Slack** uses a selected connected Slack app and a Slack channel or conversation ID (`C…`, `G…`, or `D…`). The app must already be a member of that destination.

Ayooda opens an incident when the threshold is reached and sends one failure alert. Later failures do not create alert noise. The first successful reliability event closes the incident and sends one recovery alert. Changing the threshold applies to subsequent events.

Alert attempts are recorded on the channel summary as delivered, partially delivered, or failed. Alert delivery failures are not fed back into channel telemetry, which prevents recursive alert storms. They are also not retried automatically.

## Storage and security

Summaries live at `workspaces/{workspaceId}/channelReliability/{channelId}`. Alert policies live at `workspaces/{workspaceId}/channelAlertSettings/default`. Individual events live in the nested `events` collection and carry an `expiresAt` timestamp 30 days after creation; expired events are hidden from the dashboard. Firestore client access is denied, and provider errors are normalized, truncated, and stripped of common credential formats before storage.

## Operational boundaries

A successful connection check proves that the credential is accepted by the provider at that moment. It does not send a test message or prove that a third-party webhook is configured correctly. Recent inbound activity is the stronger signal that a webhook is reaching Ayooda.

The dashboard does not automatically redeliver failed customer messages. Automatic redelivery needs provider-specific idempotency and payload retention; until that is implemented, fix the reported credential/configuration issue and use the Inbox to resend an operator reply.
