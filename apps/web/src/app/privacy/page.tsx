import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, type LegalSection } from '@/components/marketing/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — Ayooda',
  description: 'How Ayooda collects, uses, shares, and protects personal data.',
}

const sections: LegalSection[] = [
  {
    id: 'scope-and-roles',
    title: 'Scope and our role',
    content: <>
      <p>This Privacy Policy applies to ayooda.live, the Ayooda dashboard, our support channels, and the hosted services we provide (together, the “Service”). It explains how Ayooda collects, uses, discloses, and protects personal data.</p>
      <p>For account administration, billing, website analytics, and our own business operations, <strong>Ayooda acts as a data controller</strong>. When a customer uses Ayooda to handle messages, tickets, knowledge, or information about its own users, <strong>the customer is normally the controller and Ayooda acts as its processor or service provider</strong>. In that case, the customer decides why the data is processed and should provide its own privacy notice. End users should direct requests about a customer conversation to the organisation whose agent they contacted.</p>
    </>,
  },
  {
    id: 'data-we-collect',
    title: 'Personal data we collect',
    content: <>
      <p>The data we process depends on how you use the Service:</p>
      <ul>
        <li><strong>Account and profile data:</strong> name, email address, profile image, authentication identifiers, workspace membership, role, and account status.</li>
        <li><strong>Customer content:</strong> agent instructions, uploaded files and webpages, conversation messages, internal notes, support tickets, feedback, and other information submitted to the Service.</li>
        <li><strong>End-user identity and channel data:</strong> names, email addresses, phone numbers, customer identifiers, message metadata, and channel identifiers when supplied by an end user, a customer, or an authorised integration.</li>
        <li><strong>Configuration and integration data:</strong> channel settings, webhook destinations, tool definitions, connector metadata, and encrypted credentials or tokens needed to operate customer-selected integrations.</li>
        <li><strong>Billing data:</strong> plan, usage, billing status, Stripe customer and subscription identifiers, and transaction metadata. Payment-card details are collected and handled by Stripe, not stored by Ayooda.</li>
        <li><strong>Device, network, and usage data:</strong> IP address, browser and device information, referring pages, pages viewed, interactions, diagnostics, timestamps, and security or reliability events.</li>
        <li><strong>Support and communications:</strong> messages you send us and information needed to respond.</li>
      </ul>
      <p>Please do not submit special-category or highly sensitive data unless it is necessary, lawful, and appropriate for your use of the Service.</p>
    </>,
  },
  {
    id: 'sources',
    title: 'Where data comes from',
    content: <>
      <p>We collect data directly from account holders and end users; from customers that configure the Service or identify their users; automatically from browsers, devices, and our systems; and from connected services such as Google sign-in, communication channels, billing providers, or customer-authorised integrations.</p>
    </>,
  },
  {
    id: 'uses-and-bases',
    title: 'How and why we use data',
    content: <>
      <p>We use personal data to:</p>
      <ul>
        <li>provide, personalise, maintain, and secure the Service;</li>
        <li>authenticate users, administer workspaces, and provide customer support;</li>
        <li>process customer conversations, retrieve relevant knowledge, generate AI-assisted responses, execute authorised tools, create tickets, and deliver messages;</li>
        <li>process subscriptions, measure usage, prevent fraud, and enforce service limits;</li>
        <li>monitor reliability, debug problems, understand product usage, and improve usability;</li>
        <li>communicate service, security, billing, and policy updates; and</li>
        <li>comply with law, resolve disputes, and protect Ayooda, our customers, and others.</li>
      </ul>
      <p>Where the GDPR or similar law applies, our legal bases are performance of a contract, compliance with legal obligations, and our legitimate interests in operating, securing, supporting, and improving the Service. We rely on consent where applicable law requires it. When Ayooda processes customer content as a processor, we do so on the customer’s documented instructions and the customer determines the applicable legal basis.</p>
    </>,
  },
  {
    id: 'ai-processing',
    title: 'AI-assisted processing',
    content: <>
      <p>Ayooda uses AI models to analyse messages, retrieve relevant knowledge, draft or stream responses, score interactions, summarise context, and perform customer-configured workflows. Inputs may include conversation content, selected knowledge, agent instructions, and tool results. Outputs are probabilistic and may be inaccurate.</p>
      <p>Ayooda does not use the Service to make decisions that produce legal or similarly significant effects about individuals on our own behalf. Customers are responsible for human oversight and for deciding whether their use case requires additional notices, consent, or restrictions. Customers may configure a supported model provider or compatible endpoint, in which case data is also processed under that provider’s terms.</p>
    </>,
  },
  {
    id: 'analytics-and-storage',
    title: 'Cookies, local storage, and analytics',
    content: <>
      <p>We use an essential, HTTP-only session cookie to keep dashboard users signed in. We also use browser storage for preferences such as theme and navigation state. The widget may store a visitor identifier and conversation identifier in session or local storage according to the customer’s selected conversation-memory settings.</p>
      <p>We use Mixpanel for product analytics, including autocaptured interactions and session recordings on the public website and authenticated dashboard. This can include page views, clicks, navigation, device details, and an account identifier after sign-in. We use this information to understand adoption, diagnose usability issues, and improve the Service. Browser or device controls may limit cookies and storage, although disabling essential technologies can prevent parts of the Service from working.</p>
    </>,
  },
  {
    id: 'sharing',
    title: 'How we disclose data',
    content: <>
      <p>We do not sell personal data. We disclose data only as needed to operate the Service, follow customer instructions, or meet legal obligations, including to:</p>
      <ul>
        <li><strong>Infrastructure and security providers,</strong> including Google Firebase and Google Cloud;</li>
        <li><strong>AI and retrieval providers,</strong> including Pinecone, Vercel AI Gateway, model providers routed through the gateway, or a customer-configured model endpoint;</li>
        <li><strong>Payments and analytics providers,</strong> including Stripe and Mixpanel;</li>
        <li><strong>Communication and integration providers,</strong> such as Resend, Slack, Telegram, Twilio, webhooks, MCP servers, and other services a customer chooses to connect;</li>
        <li><strong>Professional advisers and authorities</strong> where reasonably necessary to comply with law or protect rights, safety, and security; and</li>
        <li><strong>A successor organisation</strong> in connection with a merger, financing, acquisition, reorganisation, or sale of assets, subject to appropriate safeguards.</li>
      </ul>
      <p>Customer workspace administrators and authorised teammates can access data according to their permissions. A customer may also instruct Ayooda to send data to destinations it controls.</p>
    </>,
  },
  {
    id: 'transfers',
    title: 'International data transfers',
    content: <>
      <p>Ayooda and our service providers may process data in countries other than the country where it was collected. Where required, we use recognised safeguards for international transfers, such as adequacy decisions or contractual protections, and take supplementary measures where appropriate. You may contact us for information about the safeguards relevant to your data.</p>
    </>,
  },
  {
    id: 'retention',
    title: 'Data retention',
    content: <>
      <p>We retain personal data only as long as reasonably necessary for the purposes described here, including providing the Service, meeting contractual and legal obligations, resolving disputes, and maintaining security. Retention depends on the type of data, customer configuration, account status, sensitivity, and legal requirements.</p>
      <ul>
        <li>Customer content is generally retained while the relevant workspace or account remains active, unless deleted earlier by an authorised user or subject to a configured retention period.</li>
        <li>Optional agent memory is retained for the customer-selected period, currently between 1 and 365 days.</li>
        <li>Widget browser identifiers may persist for the customer-selected period, currently up to 30 days, or for the browser session.</li>
        <li>Channel reliability events expire after 30 days.</li>
        <li>Billing, audit, fraud-prevention, and legal records may be retained longer where required or reasonably necessary.</li>
      </ul>
      <p>When data is deleted, it may remain temporarily in backups or restricted systems until normal deletion cycles complete.</p>
    </>,
  },
  {
    id: 'security',
    title: 'Security',
    content: <>
      <p>We use technical and organisational safeguards designed to protect personal data, including access controls, workspace isolation, encrypted storage of supported integration credentials, transport encryption, restricted administrative access, and security logging. No internet service is completely secure, so we cannot guarantee absolute security. Customers should use strong authentication, limit permissions, rotate credentials, and avoid placing unnecessary sensitive data in agents or conversations.</p>
    </>,
  },
  {
    id: 'rights',
    title: 'Your privacy rights',
    content: <>
      <p>Depending on where you live, you may have rights to access, correct, delete, restrict, or receive a portable copy of your personal data; object to certain processing; withdraw consent; and appeal or complain to a data-protection authority. You may also have the right not to receive discriminatory treatment for exercising a privacy right.</p>
      <p>To make a request about an Ayooda account or our own website processing, email <a href="mailto:legal@ayooda.live">legal@ayooda.live</a>. We may need to verify your identity and may retain limited information needed to document the request. If your request concerns a conversation with one of our customers, contact that customer first; we will assist the customer as required. You may lodge a complaint with your local supervisory authority.</p>
    </>,
  },
  {
    id: 'children',
    title: 'Children',
    content: <>
      <p>The Service is intended for organisations and is not directed to children. You must be at least 18 years old, or the age of legal majority where you live, to create an Ayooda account. Customers must not knowingly use the Service to collect children’s personal data without the notices, permissions, and safeguards required by law. If you believe a child has provided data unlawfully, contact us.</p>
    </>,
  },
  {
    id: 'changes-and-contact',
    title: 'Changes and contact',
    content: <>
      <p>We may update this Policy as the Service or law changes. We will post the revised version here, update the date above, and provide additional notice when a change is material and applicable law requires it.</p>
      <p>Ayooda operates ayooda.live. Questions, requests, and privacy concerns can be sent to <a href="mailto:legal@ayooda.live">legal@ayooda.live</a>. You can also review our <Link href="/terms">Terms of Use</Link>.</p>
    </>,
  },
]

export default function PrivacyPage() {
  return <LegalPage
    eyebrow="Legal · Privacy"
    title="Privacy Policy"
    summary="This policy explains what information Ayooda handles, why we use it, who it may be shared with, and the choices available to account holders and end users."
    effectiveDate="September 6, 2026"
    highlights={[
      { title: 'No sale of personal data', body: 'We use and disclose information to provide, secure, support, and improve Ayooda—not to sell personal data.' },
      { title: 'Customers control support data', body: 'For customer conversations, tickets, and knowledge, the Ayooda customer normally decides the purpose and Ayooda processes the data for them.' },
      { title: 'Privacy rights supported', body: 'You can request access, correction, deletion, portability, or other rights available under the law that applies to you.' },
    ]}
    sections={sections}
  />
}
