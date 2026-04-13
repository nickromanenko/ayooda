import Link from 'next/link'

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

function Nav() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-zinc-100">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <span className="text-base font-semibold text-zinc-900 tracking-tight">Ayooda</span>
        <nav className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors px-4 py-1.5 rounded-lg"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function ChatBubbleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
    </svg>
  )
}

function WidgetMockup() {
  return (
    <div className="relative bg-gradient-to-br from-zinc-50 to-indigo-50 rounded-2xl border border-zinc-200 p-8 overflow-hidden">
      {/* Fake browser chrome */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-lg overflow-hidden">
        <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2.5 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-zinc-300" />
          <div className="flex-1 mx-3 bg-zinc-200 rounded-md h-5 max-w-xs" />
        </div>
        <div className="relative h-64 bg-white flex items-center justify-center text-zinc-300 text-sm select-none">
          <span>Your website</span>

          {/* Chat widget */}
          <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2.5">
            <div className="w-64 rounded-2xl border border-zinc-200 shadow-xl overflow-hidden bg-white">
              <div className="bg-indigo-600 px-3 py-2.5 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-indigo-400 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  A
                </div>
                <div>
                  <p className="text-white text-xs font-semibold leading-none">Aria</p>
                  <p className="text-indigo-200 text-[10px] mt-0.5">Online</p>
                </div>
              </div>
              <div className="p-3 space-y-2 bg-white">
                <div className="bg-zinc-100 rounded-xl rounded-bl-sm text-zinc-700 text-xs px-3 py-2 max-w-[85%]">
                  Hi there! How can I help you today?
                </div>
                <div className="bg-indigo-600 rounded-xl rounded-br-sm text-white text-xs px-3 py-2 max-w-[85%] ml-auto">
                  What&apos;s included in the Pro plan?
                </div>
                <div className="bg-zinc-100 rounded-xl rounded-bl-sm text-zinc-700 text-xs px-3 py-2 max-w-[85%]">
                  Pro includes unlimited conversations, custom branding, and priority support…
                </div>
              </div>
              <div className="border-t border-zinc-100 px-3 py-2 flex items-center gap-2">
                <div className="flex-1 bg-zinc-50 rounded-lg h-6" />
                <div className="w-6 h-6 rounded-md bg-indigo-600 flex-shrink-0" />
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <ChatBubbleIcon />
            </div>
          </div>
        </div>
      </div>

      {/* Embed code callout */}
      <div className="mt-4 bg-zinc-900 rounded-xl p-4 text-left">
        <p className="text-zinc-400 text-xs mb-1.5 font-mono">index.html</p>
        <code className="text-emerald-400 text-xs font-mono">
          {'<script src="https://ayooda.com/widget.js"'}
          <br />
          {'        data-agent-id="your-agent-id" async></script>'}
        </code>
      </div>
    </div>
  )
}

function Hero() {
  return (
    <section className="pt-36 pb-20 px-6 text-center">
      <div className="max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-medium px-3 py-1 rounded-full mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          Powered by Gemini AI
        </div>
        <h1 className="text-5xl font-bold text-zinc-900 leading-tight tracking-tight mb-5">
          AI support that{' '}
          <span className="text-indigo-600">never sleeps</span>
        </h1>
        <p className="text-lg text-zinc-500 leading-relaxed max-w-xl mx-auto mb-8">
          Deploy a smart support agent in minutes. It knows your product, answers instantly, and
          hands off to your team when things get complex.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Start for free
          </Link>
          <Link
            href="/login"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
          >
            Sign in →
          </Link>
        </div>
        <p className="text-xs text-zinc-400 mt-4">No credit card required</p>
      </div>

      <div className="mt-16 max-w-4xl mx-auto">
        <WidgetMockup />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const STEPS = [
  {
    num: '01',
    title: 'Connect your knowledge',
    body: 'Paste your website URL. We crawl and index every page automatically so your agent always has the right answers.',
  },
  {
    num: '02',
    title: 'Customize your agent',
    body: 'Give it a name, set the tone — professional, friendly, or casual — and pick the AI model that fits your needs.',
  },
  {
    num: '03',
    title: 'Embed and go live',
    body: 'Copy one script tag into your HTML. Your agent appears instantly on every page — no setup, no integrations.',
  },
]

function HowItWorks() {
  return (
    <section className="py-20 px-6 bg-zinc-50 border-y border-zinc-200">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest text-center mb-3">
          How it works
        </p>
        <h2 className="text-3xl font-bold text-zinc-900 text-center mb-14 tracking-tight">
          From sign-up to live in under 5 minutes
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((step) => (
            <div key={step.num}>
              <span className="text-5xl font-black text-zinc-100 leading-none select-none">
                {step.num}
              </span>
              <h3 className="text-base font-semibold text-zinc-900 mt-2 mb-2">{step.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: '🧠',
    title: 'Knows your product',
    body: 'We crawl your website and index every page so the agent answers accurately from your own documentation.',
  },
  {
    icon: '🎨',
    title: 'Speaks your brand',
    body: 'Custom agent name, configurable tone, and brand colors. Feels like part of your product, not a third-party widget.',
  },
  {
    icon: '🙋',
    title: 'Human handover',
    body: 'When a question needs a human touch, route the conversation to your team with one click from the live inbox.',
  },
  {
    icon: '⚡',
    title: 'Instant deploy',
    body: "One script tag. No SDK, no integration work, no CI pipeline changes. Paste it and you're live.",
  },
  {
    icon: '📥',
    title: 'Conversation inbox',
    body: 'Every visitor conversation, in real time. See what customers are asking and jump in whenever you want.',
  },
  {
    icon: '🔌',
    title: 'More channels coming',
    body: 'Web widget is live today. Telegram, email, and Slack integrations are on the roadmap.',
  },
]

function Features() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest text-center mb-3">
          Features
        </p>
        <h2 className="text-3xl font-bold text-zinc-900 text-center mb-14 tracking-tight">
          Everything you need to support customers at scale
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-2xl border border-zinc-200 bg-white hover:border-indigo-200 hover:shadow-sm transition-all"
            >
              <span className="text-2xl mb-3 block">{f.icon}</span>
              <h3 className="text-sm font-semibold text-zinc-900 mb-1.5">{f.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// CTA
// ---------------------------------------------------------------------------

function CTA() {
  return (
    <section className="py-20 px-6 bg-indigo-600">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">
          Ready to put support on autopilot?
        </h2>
        <p className="text-indigo-200 text-base mb-8">
          Set up your AI agent in minutes. Free to start, no credit card required.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center px-7 py-3 rounded-xl text-sm font-semibold text-indigo-700 bg-white hover:bg-indigo-50 transition-colors shadow-sm"
        >
          Get started for free →
        </Link>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="py-8 px-6 border-t border-zinc-200 bg-white">
      <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-zinc-400">
        <span className="font-semibold text-zinc-500">Ayooda</span>
        <span>© {new Date().getFullYear()} Ayooda. All rights reserved.</span>
      </div>
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
