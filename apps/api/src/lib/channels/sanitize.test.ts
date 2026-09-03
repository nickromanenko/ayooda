import { expect, test } from 'bun:test'
import { stripChannelSecrets } from './sanitize'

test('channel serialization removes credentials for every supported provider', () => {
  expect(stripChannelSecrets({
    id: 'channel', type: 'slack', config: { teamName: 'Acme' },
    botTokenEnc: 'telegram', resendApiKeyEnc: 'email', webhookSecret: 'webhook',
    slackBotTokenEnc: 'slack-token', slackSigningSecretEnc: 'slack-signing',
    twilioAuthTokenEnc: 'twilio-token',
    identitySigningSecretEnc: 'identity-secret',
    identityPreviousSigningSecretEnc: 'previous-identity-secret',
  })).toEqual({ id: 'channel', type: 'slack', config: { teamName: 'Acme' } })
})
