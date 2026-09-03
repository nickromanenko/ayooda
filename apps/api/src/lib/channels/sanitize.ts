/** Remove every server-only channel credential before returning a channel document. */
export function stripChannelSecrets(data: Record<string, unknown>): Record<string, unknown> {
  const {
    botTokenEnc,
    resendApiKeyEnc,
    slackBotTokenEnc,
    slackSigningSecretEnc,
    twilioAuthTokenEnc,
    webhookSecret,
    identitySigningSecretEnc,
    identityPreviousSigningSecretEnc,
    ...safe
  } = data
  return safe
}
