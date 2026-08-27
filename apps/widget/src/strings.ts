import type { WidgetLocale } from '@ayooda/shared'

const EN = {
  online: 'Online', responding: 'Responding…', reconnecting: 'Reconnecting…',
  compose: 'Compose your message…', send: 'Send', close: 'Close chat', newConversation: 'Start a new conversation',
  inputHint: 'Enter to send · Shift+Enter for a new line', newMessages: '↓ New messages', retry: 'Try again',
  timeout: 'The response took too long to start.', rateLimit: 'Too many messages were sent. Please wait a moment.',
  sendError: 'The message could not be sent.', emptyResponse: 'Sorry, I could not generate a response.',
  human: "You're now chatting with a human", waiting: 'Waiting for a teammate', resolved: 'This conversation has been resolved',
  privacy: 'Privacy', poweredBy: 'Powered by', openChat: 'Open chat with', closeChat: 'Close chat', unread: 'unread',
}

export type WidgetStrings = typeof EN

const STRINGS: Record<Exclude<WidgetLocale, 'auto'>, WidgetStrings> = {
  en: EN,
  es: {
    online: 'En línea', responding: 'Respondiendo…', reconnecting: 'Reconectando…', compose: 'Escribe tu mensaje…', send: 'Enviar', close: 'Cerrar chat', newConversation: 'Iniciar una conversación nueva', inputHint: 'Enter para enviar · Mayús+Enter para una línea nueva', newMessages: '↓ Mensajes nuevos', retry: 'Intentar de nuevo', timeout: 'La respuesta tardó demasiado en comenzar.', rateLimit: 'Se enviaron demasiados mensajes. Espera un momento.', sendError: 'No se pudo enviar el mensaje.', emptyResponse: 'Lo siento, no pude generar una respuesta.', human: 'Ahora estás hablando con una persona', waiting: 'Esperando a un miembro del equipo', resolved: 'Esta conversación se ha resuelto', privacy: 'Privacidad', poweredBy: 'Funciona con', openChat: 'Abrir chat con', closeChat: 'Cerrar chat', unread: 'sin leer',
  },
  fr: {
    online: 'En ligne', responding: 'Réponse en cours…', reconnecting: 'Reconnexion…', compose: 'Écrivez votre message…', send: 'Envoyer', close: 'Fermer le chat', newConversation: 'Démarrer une nouvelle conversation', inputHint: 'Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne', newMessages: '↓ Nouveaux messages', retry: 'Réessayer', timeout: 'La réponse a mis trop de temps à démarrer.', rateLimit: 'Trop de messages ont été envoyés. Patientez un instant.', sendError: "Le message n'a pas pu être envoyé.", emptyResponse: "Désolé, je n'ai pas pu générer de réponse.", human: 'Vous discutez maintenant avec une personne', waiting: "En attente d'un membre de l'équipe", resolved: 'Cette conversation est résolue', privacy: 'Confidentialité', poweredBy: 'Propulsé par', openChat: 'Ouvrir le chat avec', closeChat: 'Fermer le chat', unread: 'non lus',
  },
  de: {
    online: 'Online', responding: 'Antwortet…', reconnecting: 'Verbindung wird hergestellt…', compose: 'Nachricht verfassen…', send: 'Senden', close: 'Chat schließen', newConversation: 'Neue Unterhaltung starten', inputHint: 'Enter zum Senden · Umschalt+Enter für eine neue Zeile', newMessages: '↓ Neue Nachrichten', retry: 'Erneut versuchen', timeout: 'Die Antwort hat zu lange gebraucht.', rateLimit: 'Zu viele Nachrichten. Bitte warten Sie einen Moment.', sendError: 'Die Nachricht konnte nicht gesendet werden.', emptyResponse: 'Leider konnte keine Antwort erstellt werden.', human: 'Sie chatten jetzt mit einem Menschen', waiting: 'Warten auf ein Teammitglied', resolved: 'Diese Unterhaltung wurde abgeschlossen', privacy: 'Datenschutz', poweredBy: 'Bereitgestellt von', openChat: 'Chat öffnen mit', closeChat: 'Chat schließen', unread: 'ungelesen',
  },
  pt: {
    online: 'Online', responding: 'Respondendo…', reconnecting: 'Reconectando…', compose: 'Escreva sua mensagem…', send: 'Enviar', close: 'Fechar chat', newConversation: 'Iniciar nova conversa', inputHint: 'Enter para enviar · Shift+Enter para nova linha', newMessages: '↓ Novas mensagens', retry: 'Tentar novamente', timeout: 'A resposta demorou demais para começar.', rateLimit: 'Muitas mensagens foram enviadas. Aguarde um momento.', sendError: 'Não foi possível enviar a mensagem.', emptyResponse: 'Desculpe, não foi possível gerar uma resposta.', human: 'Agora você está falando com uma pessoa', waiting: 'Aguardando um membro da equipe', resolved: 'Esta conversa foi resolvida', privacy: 'Privacidade', poweredBy: 'Desenvolvido por', openChat: 'Abrir chat com', closeChat: 'Fechar chat', unread: 'não lidas',
  },
  ar: {
    online: 'متصل', responding: 'جارٍ الرد…', reconnecting: 'جارٍ إعادة الاتصال…', compose: 'اكتب رسالتك…', send: 'إرسال', close: 'إغلاق المحادثة', newConversation: 'بدء محادثة جديدة', inputHint: 'Enter للإرسال · Shift+Enter لسطر جديد', newMessages: 'رسائل جديدة ↓', retry: 'حاول مرة أخرى', timeout: 'استغرق بدء الرد وقتًا طويلًا.', rateLimit: 'تم إرسال رسائل كثيرة. يرجى الانتظار قليلًا.', sendError: 'تعذر إرسال الرسالة.', emptyResponse: 'عذرًا، تعذر إنشاء رد.', human: 'أنت تتحدث الآن مع أحد أعضاء الفريق', waiting: 'في انتظار أحد أعضاء الفريق', resolved: 'تم حل هذه المحادثة', privacy: 'الخصوصية', poweredBy: 'مدعوم من', openChat: 'فتح المحادثة مع', closeChat: 'إغلاق المحادثة', unread: 'غير مقروءة',
  },
}

export function resolveWidgetLocale(configured: WidgetLocale, browserLanguage = 'en'): Exclude<WidgetLocale, 'auto'> {
  if (configured !== 'auto') return configured
  const language = browserLanguage.toLowerCase().split('-')[0]
  return language && language in STRINGS ? language as Exclude<WidgetLocale, 'auto'> : 'en'
}

export function widgetStrings(configured: WidgetLocale, browserLanguage?: string): WidgetStrings {
  return STRINGS[resolveWidgetLocale(configured, browserLanguage)]
}
