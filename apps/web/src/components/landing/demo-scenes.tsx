import type { ComponentType } from 'react'
import { Globe, FileText, ShieldCheck, Check } from 'lucide-react'
import s from './ProductDemo.module.css'
import {
  AppShell, InboxFrame, Msg, Typing, ToolCall, SourceChip, RailTitle, RailStep, Meter, Score, StatusIcon,
  prog, typed, count, easeOut, type ConvItem,
} from './demo-kit'

type SceneProps = { t: number }

const OTHERS: ConvItem[] = [
  { id: 'elena', name: 'Elena Rossi', time: '9:41', preview: 'Do you ship to Canada?', tag: 'resolved' },
  { id: 'sam', name: 'Sam Okafor', time: '9:12', preview: 'Can I change my delivery address?', tag: 'resolved' },
  { id: 'jo', name: 'Jo Whitfield', time: '8:57', preview: 'Which size is the Alder parka?', tag: 'resolved' },
]

// ─── 1 · Answer ───────────────────────────────────────────────────────────────

const ANSWER = "Your order was held for address verification. I've confirmed the address on file and released it. It ships today via DHL Express, ETA Wed Apr 22."

function AnswerScene({ t }: SceneProps) {
  const resolved = t >= 7400
  const items: ConvItem[] = [
    { id: 'priya', name: 'Priya Nair', time: 'now', preview: t >= 3300 ? 'Your order was held for address…' : "Where's my order #4421?", tag: resolved ? 'resolved' : 'bot', unread: !resolved, active: true },
    { id: 'marcus', name: 'Marcus Tran', time: '9:48', preview: 'The jacket arrived with a torn zip', tag: 'resolved' },
    ...OTHERS.slice(0, 2),
  ]
  const confidence = count(94, t, 3400, 4600)
  const scoreP = easeOut(prog(t, 2000, 3000))
  return (
    <AppShell nav="inbox" address="app.ayooda.com/inbox">
      <InboxFrame
        items={items}
        name="Priya Nair"
        status={resolved ? 'Status: Resolved · Agent: Kim' : 'Status: Bot answering · Agent: Kim'}
        pill={resolved ? { label: 'Resolved', tone: 'green' } : { label: 'Kim is answering', tone: 'lime' }}
        thread={<>
          {t >= 300 && <Msg who="user">Hi, where&apos;s my order #4421? It&apos;s been 5 days.</Msg>}
          {t >= 1200 && t < 3300 && <Typing />}
          {t >= 1900 && <ToolCall name="orders.lookup" args="id: 4421" done={t >= 3000} result="Held · address verification" />}
          {t >= 3300 && (
            <Msg who="agent">
              {typed(ANSWER, t, 3300, 62)}
              {t >= 6100 && <div className={s.sources}><SourceChip>Shipping policy</SourceChip><SourceChip>Order #4421 · Shopify</SourceChip></div>}
            </Msg>
          )}
        </>}
        rail={<>
          <RailTitle sub="Every step is visible and editable">How Kim answered</RailTitle>
          {t >= 1500 && (
            <RailStep done={t >= 2900} title="Searched your knowledge" sub="3 relevant sources">
              <Score label="Shipping policy" value={+(0.94 * scoreP).toFixed(2)} />
              <Score label="Delivery FAQ" value={+(0.81 * scoreP).toFixed(2)} />
              <Score label="Returns policy" value={+(0.62 * scoreP).toFixed(2)} />
            </RailStep>
          )}
          {t >= 2000 && <RailStep done={t >= 3000} title="Checked live data" sub="Shopify · orders.lookup" />}
          {t >= 3400 && <Meter value={confidence} tone="lime" label={confidence >= 94 ? 'High confidence. Answered without a human.' : 'Scoring answer…'} />}
          {resolved && <div className={s.footChip}><Check size={12} strokeWidth={3} /> Resolved in 11 seconds</div>}
        </>}
      />
    </AppShell>
  )
}

// ─── 2 · Act ──────────────────────────────────────────────────────────────────

const CHECKS = [
  { at: 3700, label: 'Amount is within the $50 auto-refund limit' },
  { at: 4300, label: 'Delivered 6 days ago (30-day window)' },
  { at: 4900, label: 'Customer verified by email' },
]

function ActScene({ t }: SceneProps) {
  const running = t >= 5700
  const done = t >= 6900
  const items: ConvItem[] = [
    { id: 'marcus', name: 'Marcus Tran', time: 'now', preview: done ? 'Done. $24.99 is on its way back…' : 'The jacket arrived with a torn zip', tag: done ? 'resolved' : 'bot', unread: !done, active: true },
    { id: 'priya', name: 'Priya Nair', time: '9:52', preview: 'Your order was held for address…', tag: 'resolved' },
    ...OTHERS.slice(0, 2),
  ]
  const log = [
    { at: 3000, text: 'Action requested: shopify.orders.refund' },
    { at: 5000, text: 'Policy check passed' },
    { at: 6900, text: 'Refund issued · $24.99' },
    { at: 7300, text: 'Confirmation email sent' },
  ]
  return (
    <AppShell nav="inbox" address="app.ayooda.com/inbox">
      <InboxFrame
        items={items}
        name="Marcus Tran"
        status={done ? 'Status: Resolved · Agent: Kim' : 'Status: Bot answering · Agent: Kim'}
        pill={done ? { label: 'Resolved', tone: 'green' } : { label: 'Kim is working', tone: 'lime' }}
        thread={<>
          {t >= 300 && <Msg who="user">The jacket arrived with a torn zip. Can I get a refund?</Msg>}
          {t >= 1100 && t < 2300 && <Typing />}
          {t >= 2300 && <Msg who="agent">{typed("I'm sorry about the zip. I can refund this right away.", t, 2300, 60)}</Msg>}
          {t >= 3000 && (
            <div className={s.action}>
              <div className={s.actionHead}>
                <code>shopify.orders.refund<span>(order: 8821, amount: 24.99)</span></code>
                <span data-state={done ? 'done' : running ? 'run' : 'wait'}>
                  {done ? 'Refunded' : running ? 'Running' : 'Checking policy'}
                </span>
              </div>
              <ul className={s.checks}>
                {CHECKS.map((c) => t >= c.at - 400 && (
                  <li key={c.label}><StatusIcon done={t >= c.at + 200} />{c.label}</li>
                ))}
              </ul>
              {done && <div className={s.actionResult}><Check size={13} strokeWidth={3} /> Refunded $24.99 · customer notified · ticket closed <b>4.1s</b></div>}
            </div>
          )}
          {t >= 7300 && <Msg who="agent">Done. $24.99 is on its way back to your card (3–5 business days).</Msg>}
        </>}
        rail={<>
          <RailTitle sub="Rules your team set. Kim stays inside them.">Guardrails</RailTitle>
          <div className={s.rule} data-hit={t >= 5000}><ShieldCheck size={13} /> Auto-refund up to $50</div>
          <div className={s.rule}><ShieldCheck size={13} /> Ask a teammate above $50</div>
          <div className={s.rule}><ShieldCheck size={13} /> Never edit payment methods</div>
          <div className={s.railGap}><RailTitle>Activity</RailTitle></div>
          <ul className={s.log}>
            {log.map((l) => t >= l.at && <li key={l.text}>{l.text}</li>)}
          </ul>
        </>}
      />
    </AppShell>
  )
}

// ─── 3 · Hand off ─────────────────────────────────────────────────────────────

const HANDOFF = "I can see two charges of $89.00 from today. A refund this size needs a teammate, so I'm bringing in Maya from billing with everything we've covered."
const SUGGESTED = "Hi Daniel, Maya here. I've refunded the duplicate $89.00 charge. It will reach your card in 3–5 days, and I've emailed you a confirmation."

function HandoffScene({ t }: SceneProps) {
  const escalated = t >= 3600
  const confidence = Math.round(94 - 56 * easeOut(prog(t, 1900, 2800)))
  const sent = t >= 7200
  const items: ConvItem[] = [
    { id: 'daniel', name: 'Daniel Ortiz', time: 'now', preview: escalated ? 'Bringing in Maya from billing…' : 'I was charged twice and my bank…', tag: escalated ? 'assigned' : 'bot', unread: true, active: true, flag: escalated ? 'escalated' : undefined },
    { id: 'marcus', name: 'Marcus Tran', time: '9:53', preview: 'Done. $24.99 is on its way back…', tag: 'resolved' },
    ...OTHERS.slice(0, 2),
  ]
  return (
    <AppShell nav="inbox" badge={escalated ? 1 : undefined} address="app.ayooda.com/inbox">
      <InboxFrame
        items={items}
        name="Daniel Ortiz"
        status={escalated ? 'Status: Assigned · Maya R. (Billing)' : 'Status: Bot answering · Agent: Kim'}
        pill={sent ? { label: 'Maya replied', tone: 'green' } : escalated ? { label: 'Escalated', tone: 'red' } : { label: 'Kim is answering', tone: 'lime' }}
        thread={<>
          {t >= 300 && <Msg who="user">I was charged twice and my bank is threatening a chargeback. I need this fixed today.</Msg>}
          {t >= 1100 && t < 2400 && <Typing />}
          {t >= 2400 && <Msg who="agent">{typed(HANDOFF, t, 2400, 66)}</Msg>}
          {escalated && <div className={s.divider}><span>Escalated to Maya R. with full context</span></div>}
          {sent && <Msg who="human" name="Maya · Billing">{typed(SUGGESTED, t, 7200, 70)}</Msg>}
        </>}
        rail={<>
          <RailTitle sub="Kim knows when to stop">Hand-off</RailTitle>
          {t >= 1700 && <Meter value={confidence} tone={confidence < 60 ? 'red' : 'lime'} label={confidence < 60 ? 'Low confidence. Billing dispute.' : 'Scoring answer…'} />}
          {escalated && (
            <div className={s.assignee}>
              <span className={s.avatar} data-who="human">M</span>
              <div><b>Maya R.</b><span>Billing · online</span></div>
            </div>
          )}
          {t >= 4300 && (
            <div className={s.summary}>
              <div className={s.summaryLabel}>Summary for Maya</div>
              <p>{typed('Duplicate $89.00 charge on 14 Apr. Customer cites chargeback risk and wants it fixed today.', t, 4300, 70)}</p>
              {t >= 5600 && <div className={s.summaryMeta}><em data-tone="red">Frustrated</em><em>2 lookups done</em></div>}
            </div>
          )}
          {t >= 6000 && (
            <div className={s.suggest}>
              <div className={s.summaryLabel}>Suggested reply</div>
              <button type="button" tabIndex={-1} data-pressed={t >= 7000 && t < 7300}>{sent ? 'Sent' : 'Send'}</button>
            </div>
          )}
        </>}
      />
    </AppShell>
  )
}

// ─── 4 · Learn ────────────────────────────────────────────────────────────────

const PAGES = ['/help/shipping', '/help/returns', '/help/sizing', '/products/alder-parka', '/products/ridge-pack', '/blog/care-guide']
const URL_TEXT = 'https://northwind.com'
const CA_ANSWER = 'Yes. Standard shipping to Canada takes 5–8 business days.'

function LearnScene({ t }: SceneProps) {
  const crawl = prog(t, 2000, 6000)
  const finished = t >= 6000
  return (
    <AppShell nav="agents" address="app.ayooda.com/agents/northwind">
      <div className={s.page}>
        <div className={s.pageHead}>
          <div><b>Northwind Support</b><span>Kim · Live on website and email</span></div>
          <div className={s.subtabs} aria-hidden="true">
            {['Identity', 'Knowledge', 'Channels', 'Tests'].map((x) => <span key={x} data-on={x === 'Knowledge'}>{x}</span>)}
          </div>
        </div>
        <div className={s.learn}>
          <div className={s.panel}>
            <div className={s.panelTitle}>Add knowledge</div>
            <div className={s.urlRow}>
              <div className={s.input}><Globe size={13} /> {typed(URL_TEXT, t, 300, 22)}{t < 1700 && <i className={s.caret} />}</div>
              <span className={s.btn} data-pressed={t >= 1700 && t < 2000} data-on={t >= 1700}>Index website</span>
            </div>
            {t >= 2000 && (
              <>
                <div className={s.bar}><i style={{ width: `${crawl * 100}%` }} /></div>
                <ul className={s.pages}>
                  {PAGES.map((p, i) => t >= 2000 + i * 520 && (
                    <li key={p}><StatusIcon done={t >= 2000 + i * 520 + 700} /><code>{p}</code></li>
                  ))}
                  {t >= 5300 && <li className={s.more}>+ 142 more pages</li>}
                </ul>
              </>
            )}
            {t >= 6200 && (
              <div className={s.files}>
                <span><FileText size={12} /> returns-policy.pdf</span>
                <span style={{ animationDelay: '160ms' }}><FileText size={12} /> size-guide.csv</span>
              </div>
            )}
          </div>
          <div className={s.panel}>
            <div className={s.stats}>
              <div><b>{count(148, t, 2000, 6000)}</b><span>Pages</span></div>
              <div><b>{count(1962, t, 2000, 6000).toLocaleString('en-US')}</b><span>Chunks</span></div>
              <div><b>{finished ? 'Ready' : 'Indexing'}</b><span>Status</span></div>
            </div>
            <div className={s.panelTitle}>Test your agent</div>
            <div className={s.mini}>
              {t >= 7000 && <Msg who="user">Do you ship to Canada?</Msg>}
              {t >= 7500 && (
                <Msg who="agent">
                  {typed(CA_ANSWER, t, 7500, 56)}
                  {t >= 8400 && <div className={s.sources}><SourceChip>/help/shipping</SourceChip></div>}
                </Msg>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// ─── 5 · Measure ──────────────────────────────────────────────────────────────

const AGENT_LINE = 'M0 92 C40 88 70 84 110 70 S180 58 220 46 S290 40 330 26 S390 18 420 10'
const TEAM_LINE = 'M0 104 C40 103 80 100 120 98 S190 96 230 92 S300 90 340 86 S400 82 420 80'

function MeasureScene({ t }: SceneProps) {
  const draw = easeOut(prog(t, 1200, 4400))
  const tiles = [
    { label: 'Conversations', value: count(1284, t, 500, 2400).toLocaleString('en-US'), delta: '+12%' },
    { label: 'Automation rate', value: `${count(87, t, 500, 2400)}%`, delta: '+9 pts' },
    { label: 'First response', value: `${(4 * easeOut(prog(t, 500, 2400))).toFixed(0)}s`, delta: '-31%' },
    { label: 'Customer rating', value: (4.8 * easeOut(prog(t, 500, 2400))).toFixed(1), delta: '+0.3' },
  ]
  const added = t >= 6900
  return (
    <AppShell nav="overview" address="app.ayooda.com/dashboard">
      <div className={s.page}>
        <div className={s.pageHead}>
          <div><b>Overview</b><span>Your support agents at a glance</span></div>
          <div className={s.subtabs} aria-hidden="true"><span data-on>7 days</span><span>30 days</span></div>
        </div>
        <div className={s.tiles}>
          {tiles.map((x) => (
            <div key={x.label} className={s.tile}>
              <span>{x.label}</span>
              <b>{x.value}</b>
              <em>{x.delta}</em>
            </div>
          ))}
        </div>
        <div className={s.measure}>
          <div className={s.panel}>
            <div className={s.panelTitle}>Conversations resolved</div>
            <svg className={s.chart} viewBox="0 0 420 120" preserveAspectRatio="none" aria-hidden="true">
              {[30, 60, 90].map((y) => <line key={y} x1="0" x2="420" y1={y} y2={y} />)}
              <defs><clipPath id="demo-chart-reveal"><rect x="0" y="0" width={draw * 420} height="120" /></clipPath></defs>
              <g clipPath="url(#demo-chart-reveal)">
                <path d={TEAM_LINE} className={s.lineTeam} />
                <path d={AGENT_LINE} className={s.lineAgent} />
              </g>
            </svg>
            <div className={s.legend}><span data-k="agent">Resolved by Kim</span><span data-k="team">Resolved by your team</span></div>
          </div>
          <div className={s.panel}>
            <div className={s.panelTitle}>Needs attention</div>
            {t >= 4500 && (
              <div className={s.attn}>
                <p>12 questions about EU returns went unanswered</p>
                <span className={s.btn} data-on data-pressed={t >= 6700 && t < 7000} data-done={added}>{added ? 'Added to knowledge' : 'Add to knowledge'}</span>
              </div>
            )}
            {t >= 5200 && (
              <div className={s.attn} style={{ animationDelay: '60ms' }}>
                <p>3 refunds above $50 are waiting for approval</p>
                <span className={s.btn}>Review</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export type Scene = { id: string; label: string; desc: string; duration: number; Component: ComponentType<SceneProps> }

export const SCENES: Scene[] = [
  { id: 'answer', label: 'Answer', desc: 'Grounded replies from your docs and live order data, with the sources shown.', duration: 9000, Component: AnswerScene },
  { id: 'act', label: 'Act', desc: 'Refunds and updates run inside rules your team sets.', duration: 9600, Component: ActScene },
  { id: 'handoff', label: 'Hand off', desc: 'When confidence drops, a teammate gets the case with a summary.', duration: 10200, Component: HandoffScene },
  { id: 'learn', label: 'Learn', desc: 'Point it at your site. It indexes every page in minutes.', duration: 9800, Component: LearnScene },
  { id: 'measure', label: 'Measure', desc: 'See what it resolves and what it still can’t answer.', duration: 8600, Component: MeasureScene },
]

