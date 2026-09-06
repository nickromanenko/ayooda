import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, type LegalSection } from '@/components/marketing/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Use — Ayooda',
  description: 'The terms that apply when organisations access or use Ayooda.',
}

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement and eligibility',
    content: <>
      <p>These Terms of Use (“Terms”) govern access to ayooda.live and the Ayooda hosted services, dashboard, widgets, APIs, and related software (the “Service”). By creating an account, purchasing a subscription, or using the Service, you agree to these Terms and our <Link href="/privacy">Privacy Policy</Link>.</p>
      <p>You must be at least 18 years old, or the age of legal majority where you live. If you use the Service for an organisation, you confirm that you have authority to bind that organisation; “you” then means that organisation. The Service is offered primarily for business and professional use.</p>
    </>,
  },
  {
    id: 'service',
    title: 'The Service',
    content: <>
      <p>Ayooda helps organisations configure AI-assisted support agents, connect knowledge and communication channels, manage conversations and tickets, create workflows, and use authorised third-party tools. Features and limits depend on the selected plan and may evolve over time.</p>
      <p>You are responsible for evaluating whether the Service is suitable for your use case, configuring it appropriately, supervising its operation, and maintaining any notices, consents, policies, or human-review processes required for your users.</p>
    </>,
  },
  {
    id: 'accounts',
    title: 'Accounts and authorised users',
    content: <>
      <p>You must provide accurate account information and keep it current. Keep credentials confidential, use reasonable security controls, and notify us promptly if you suspect unauthorised access. You are responsible for activity under your account and for users you invite, except to the extent caused by Ayooda’s breach of these Terms.</p>
      <p>Workspace owners control membership, permissions, connected systems, and agent configuration. You must ensure each authorised user follows these Terms.</p>
    </>,
  },
  {
    id: 'fees',
    title: 'Trials, subscriptions, and payment',
    content: <>
      <p>Plan prices, usage allowances, overage rates, trial terms, and billing intervals are shown when you subscribe. Unless stated otherwise, paid subscriptions renew automatically for the same billing period until cancelled. You authorise Ayooda and Stripe to charge the applicable fees, taxes, and usage-based amounts to your payment method.</p>
      <p>You can cancel or manage a paid subscription through the billing portal. Cancellation takes effect at the end of the current paid period unless the checkout terms say otherwise. Fees already paid are non-refundable except where required by law or expressly stated at purchase. We may correct billing errors and change future pricing with reasonable advance notice.</p>
    </>,
  },
  {
    id: 'customer-data',
    title: 'Your content and customer data',
    content: <>
      <p>You retain ownership of content and data you submit or connect (“Customer Data”). You grant Ayooda a limited, non-exclusive right to host, copy, transmit, transform, and otherwise process Customer Data only as needed to provide, secure, support, and improve the Service, comply with law, and follow your documented instructions.</p>
      <p>You are responsible for the legality, accuracy, and quality of Customer Data and for having all rights, notices, and permissions needed to process it through Ayooda. Do not submit data that is prohibited by law or that Ayooda has not agreed in writing to process. As between the parties, you are the controller of personal data in customer conversations and Ayooda acts as your processor or service provider where applicable.</p>
    </>,
  },
  {
    id: 'ai',
    title: 'AI outputs and human oversight',
    content: <>
      <p>AI-generated responses and recommendations are probabilistic. They may be incomplete, inaccurate, or inappropriate and may resemble content generated for others. You must test agents before deployment, maintain appropriate safeguards, and apply human review where an error could affect a person’s rights, safety, finances, employment, healthcare, legal position, or access to essential services.</p>
      <p>You must not represent AI output as professionally verified or rely on it as the sole basis for legal, medical, financial, employment, insurance, credit, or other high-impact decisions. Ayooda does not guarantee that output is unique, correct, or fit for a particular purpose.</p>
    </>,
  },
  {
    id: 'tools-and-integrations',
    title: 'Tools, channels, and third-party services',
    content: <>
      <p>The Service may connect to model providers, communication channels, webhooks, MCP servers, APIs, and other third-party services. You choose and authorise those connections and are responsible for their accounts, permissions, instructions, fees, terms, security, and continued availability.</p>
      <p>Tools that write or change external data can have real-world effects. Configure the minimum necessary permissions, require confirmation where appropriate, test with non-production data, and monitor activity. Ayooda is not responsible for third-party services or for actions performed according to your configuration, except where caused by Ayooda’s breach of these Terms.</p>
    </>,
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    content: <>
      <p>You must not use the Service to:</p>
      <ul>
        <li>break the law, infringe rights, deceive people, or facilitate fraud, abuse, harassment, discrimination, or violence;</li>
        <li>send unlawful spam, impersonate another person, or conceal that a user is interacting with an automated system where disclosure is required;</li>
        <li>collect or process sensitive data without a lawful basis and appropriate safeguards;</li>
        <li>introduce malware, probe or bypass security, disrupt the Service, or access another customer’s data;</li>
        <li>reverse engineer or copy the Service except where applicable law expressly permits it;</li>
        <li>resell, sublicense, or provide the Service as a standalone competing product without written permission;</li>
        <li>use automated means to exceed limits or avoid charges; or</li>
        <li>use the Service or its output to train a competing model or service except with Ayooda’s written agreement.</li>
      </ul>
      <p>We may investigate suspected misuse and restrict activity reasonably necessary to protect the Service and its users.</p>
    </>,
  },
  {
    id: 'intellectual-property',
    title: 'Ayooda technology and feedback',
    content: <>
      <p>Ayooda and its licensors retain all rights in the Service, including software, interfaces, designs, documentation, and trademarks. Subject to these Terms and payment of applicable fees, we grant you a limited, non-exclusive, non-transferable, revocable right to use the Service during your subscription for your internal business purposes.</p>
      <p>If you provide suggestions or feedback, you grant Ayooda a worldwide, perpetual, irrevocable, royalty-free right to use it without restriction or compensation. This does not give us ownership of your Customer Data.</p>
    </>,
  },
  {
    id: 'confidentiality',
    title: 'Confidentiality and data protection',
    content: <>
      <p>Each party may receive non-public information that a reasonable person would understand to be confidential. The receiving party will use it only to perform under these Terms, protect it with reasonable care, and disclose it only to personnel and service providers who need it and are bound by confidentiality obligations. These duties do not apply to information that is public through no breach, already known without restriction, independently developed, or lawfully received from another source.</p>
      <p>Our <Link href="/privacy">Privacy Policy</Link> explains our own privacy practices. Where data-protection law requires a controller-processor agreement, contact <a href="mailto:legal@ayooda.live">legal@ayooda.live</a> before submitting regulated personal data so the parties can put appropriate terms in place.</p>
    </>,
  },
  {
    id: 'availability',
    title: 'Changes, availability, and beta features',
    content: <>
      <p>We aim to operate a reliable Service, but features may occasionally be unavailable because of maintenance, security events, third-party failures, or circumstances beyond our reasonable control. We may modify or discontinue features. If a change materially reduces core paid functionality, we will provide reasonable notice where practical.</p>
      <p>Features identified as preview, beta, experimental, or evaluation may be changed or withdrawn at any time and may be less reliable. They are provided for testing and should not be used for critical workloads.</p>
    </>,
  },
  {
    id: 'suspension',
    title: 'Suspension and termination',
    content: <>
      <p>You may stop using the Service at any time and may cancel a subscription through the billing portal. We may suspend or limit access when reasonably necessary to prevent harm, address a security risk, comply with law, respond to non-payment, or investigate a material breach. Where practical, we will give notice and an opportunity to remedy the issue.</p>
      <p>Either party may terminate for a material breach that is not cured within a reasonable period after notice, unless immediate termination is necessary by law or to prevent serious harm. On termination, your right to use the Service ends. We may delete Customer Data after a reasonable wind-down period, subject to legal obligations and backup cycles. Export important data before closing your account.</p>
    </>,
  },
  {
    id: 'disclaimers',
    title: 'Disclaimers',
    content: <>
      <p>To the maximum extent permitted by law, the Service is provided “as is” and “as available.” Ayooda disclaims implied warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted or error-free operation. We do not warrant AI output, third-party services, or results obtained from the Service.</p>
      <p>Nothing in these Terms excludes warranties or rights that cannot lawfully be excluded, including mandatory consumer rights where they apply.</p>
    </>,
  },
  {
    id: 'liability',
    title: 'Limits of liability',
    content: <>
      <p>To the maximum extent permitted by law, neither party will be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, goodwill, or data, even if advised that they may occur.</p>
      <p>Except for liability that cannot be limited by law, your payment obligations, misuse of the other party’s intellectual property, or breach of confidentiality, each party’s total aggregate liability arising from the Service or these Terms will not exceed the fees paid or payable for the Service during the 12 months before the event giving rise to the claim. These limitations apply to the extent permitted by applicable law and regardless of the legal theory.</p>
    </>,
  },
  {
    id: 'indemnity',
    title: 'Indemnity',
    content: <>
      <p>To the extent permitted by law, you will defend and indemnify Ayooda against third-party claims arising from Customer Data, your unlawful use of the Service, or your material breach of the acceptable-use, data-rights, or third-party integration obligations in these Terms. We will promptly notify you of a covered claim, allow you reasonable control of the defence, and cooperate at your expense. You may not settle a claim in a way that admits fault by or imposes obligations on Ayooda without our consent.</p>
    </>,
  },
  {
    id: 'general',
    title: 'General terms',
    content: <>
      <p>Neither party is liable for delay caused by events beyond reasonable control. You may not assign these Terms without our consent, except with a merger or sale of substantially all relevant assets; Ayooda may assign them as part of a reorganisation or sale. If a provision is unenforceable, it will be limited to the minimum extent necessary and the rest remains effective. Failure to enforce a provision is not a waiver.</p>
      <p>The governing law and forum stated in an applicable order form control. If no order form specifies them, governing law and forum will be determined under applicable law, without overriding mandatory rights available to you. Before bringing a formal claim, each party agrees to make a reasonable good-faith effort to resolve the dispute informally.</p>
    </>,
  },
  {
    id: 'changes-contact',
    title: 'Changes and contact',
    content: <>
      <p>We may update these Terms. We will post the revised Terms, update the date above, and provide reasonable notice of material changes. Changes normally apply prospectively. If you continue using the Service after the effective date, you accept the updated Terms; if you do not agree, you must stop using the Service.</p>
      <p>Questions or legal notices may be sent to <a href="mailto:legal@ayooda.live">legal@ayooda.live</a>. Ayooda operates ayooda.live.</p>
    </>,
  },
]

export default function TermsPage() {
  return <LegalPage
    eyebrow="Legal · Service"
    title="Terms of Use"
    summary="These terms set clear responsibilities for using Ayooda, including account security, customer data, AI oversight, connected tools, subscriptions, and acceptable use."
    effectiveDate="September 6, 2026"
    highlights={[
      { title: 'You keep your content', body: 'Customers retain ownership of the knowledge, messages, configurations, and other data they submit to Ayooda.' },
      { title: 'AI needs oversight', body: 'AI output can be wrong. Test agents carefully and keep a human involved wherever errors could materially affect people.' },
      { title: 'Connected actions are real', body: 'Use least-privilege credentials, confirmations, and monitoring when agents can update third-party systems.' },
    ]}
    sections={sections}
  />
}
