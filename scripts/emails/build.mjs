#!/usr/bin/env node
// Builds Bounty v2 email templates.
//   node scripts/emails/build.mjs [outDir]
// Writes <outDir>/templates/<alias>.{html,txt}, <outDir>/manifest.json and
// <outDir>/previews/<alias>--<case>.html (variables filled with sample data).
// Exits non-zero if any template uses an undeclared variable, declares an
// unused one, or leaves a {{{placeholder}}} unfilled in a preview.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from './design-system.mjs'
import { TEMPLATES, AUTH_TEMPLATES } from './templates.mjs'

const out = process.argv[2] || 'emails'
const RESEND_IDS = JSON.parse(readFileSync(new URL('./resend-ids.json', import.meta.url), 'utf8'))
mkdirSync(join(out, 'templates'), { recursive: true })
mkdirSync(join(out, 'previews'), { recursive: true })

const RESERVED = new Set(['FIRST_NAME', 'LAST_NAME', 'EMAIL', 'RESEND_UNSUBSCRIBE_URL'])
const VAR_RE = /\{\{\{([A-Z0-9_]+)\}\}\}/g
const used = (s) => new Set([...s.matchAll(VAR_RE)].map((m) => m[1]))
const fill = (s, values) => s.replace(VAR_RE, (_, k) => (k in values ? values[k] : `{{{${k}}}}`))

// Supabase Auth Go-template placeholders → sample values, so previews are
// realistic and clickable.
const GO_SAMPLES = {
  '{{ .ConfirmationURL }}': 'https://www.bountyfinder.net/',
  '{{ .Token }}': '482913',
  '{{ .Email }}': 'old@example.com',
  '{{ .NewEmail }}': 'new@example.com',
}
const goSample = (s) => Object.entries(GO_SAMPLES).reduce((acc, [k, v]) => acc.replaceAll(k, v), s)

// Collapse inter-tag whitespace; keeps conditional comments and text intact.
const minify = (h) => h.replace(/>\s*\n\s*</g, '><').replace(/\n{2,}/g, '\n')

const problems = []
const manifest = []

for (const t of [...TEMPLATES, ...AUTH_TEMPLATES]) {
  const declared = Object.fromEntries(
    Object.entries(t.vars).map(([k, v]) => {
      const d = typeof v === 'object' ? v : { fallback: v }
      // Resend refuses to send when a declared variable has no fallback; an
      // empty string is ambiguous, so "nothing" is a single space (renders as
      // nothing in HTML).
      return [k, { ...d, fallback: d.fallback === '' ? ' ' : d.fallback }]
    })
  )
  const html = minify(shell({
    title: t.subject,
    preheader: t.preheader,
    stamp: t.stamp,
    body: t.body(),
    footer: t.footer(),
    emailKey: t.key,
    variables: Object.keys(declared),
  }))
  const text = t.text

  const inUse = new Set([...used(html), ...used(text), ...used(t.subject)])
  for (const k of inUse) if (!(k in declared)) problems.push(`${t.alias}: uses undeclared {{{${k}}}}`)
  for (const k of Object.keys(declared)) {
    if (!inUse.has(k)) problems.push(`${t.alias}: declares unused ${k}`)
    if (RESERVED.has(k)) problems.push(`${t.alias}: ${k} is reserved by Resend`)
  }
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > 90_000) problems.push(`${t.alias}: ${bytes} bytes — Gmail clips at ~102KB`)

  writeFileSync(join(out, 'templates', `${t.alias}.html`), html)
  writeFileSync(join(out, 'templates', `${t.alias}.txt`), text)

  const fallbacks = Object.fromEntries(Object.entries(declared).map(([k, v]) => [k, v.fallback]))
  for (const [name, sample] of Object.entries(t.samples)) {
    const values = { ...fallbacks, ...sample }
    // Supabase Auth placeholder → a sample link so previews are clickable.
    const rendered = goSample(fill(html, values))
    const left = used(rendered)
    if (left.size) problems.push(`${t.alias}--${name}: unfilled ${[...left].join(', ')}`)
    writeFileSync(join(out, 'previews', `${t.alias}--${name}.html`), rendered)
    writeFileSync(join(out, 'previews', `${t.alias}--${name}.txt`), goSample(fill(text, values)))
  }

  manifest.push({
    key: t.key,
    alias: t.alias,
    name: t.name,
    resendId: RESEND_IDS[t.alias] ?? null,
    audience: t.audience,
    kind: t.kind,
    status: t.status,
    trigger: t.trigger,
    replaces: t.replaces,
    subject: t.subject,
    preheader: t.preheader,
    replyTo: t.replyTo ?? null,
    stamp: t.stamp.label,
    bytes,
    variables: Object.entries(declared).map(([key, v]) => ({
      key,
      type: 'string',
      fallbackValue: v.fallback,
      html: v.html === true,
    })),
    samples: Object.keys(t.samples),
  })
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`built ${manifest.length} templates → ${out}`)
for (const m of manifest) console.log(`  ${m.alias.padEnd(32)} ${String(m.bytes).padStart(6)} B  ${m.variables.length} vars`)
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '))
  process.exit(1)
}
