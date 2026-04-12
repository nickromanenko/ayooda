// Ayooda Widget — entry point
// Reads data-agent-id from the script tag and initializes the chat widget

const currentScript = document.currentScript as HTMLScriptElement | null
const agentId = currentScript?.getAttribute('data-agent-id')

if (!agentId) {
  console.error('[Ayooda] Missing data-agent-id attribute on widget script tag')
} else {
  console.log(`[Ayooda] Widget initialized for agent: ${agentId}`)
}
