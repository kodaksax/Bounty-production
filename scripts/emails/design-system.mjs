// Bounty email design system — tokens + table-based components.
//
// Every Bounty email is composed from these pieces so the whole set reads as
// one brand while each message keeps a structure that fits its job.
// Output is plain email HTML: tables for layout, inline styles, a small <style>
// block only for mobile + dark-mode overrides (clients that strip it still get
// a correct light layout from the inline styles).
//
// Variables use Resend's triple-brace syntax ({{{VAR}}}). Resend inserts them
// UNESCAPED, so the sender must HTML-escape every user-controlled value.

export const ASSETS = {
  // Hosted on the brand domain by the marketing site (verified 200, image/png).
  // The green app-tile crosshair is the mark used for the app icon + favicon.
  mark: 'https://www.bountyfinder.net/assets/img/brandmark-design__6_.png',
  site: 'https://www.bountyfinder.net/',
  manage: 'https://www.bountyfinder.net/manage/',
  support: 'mailto:support@bountyfinder.app',
}

// Brand: #18A772 primary green, #008E2A secondary (Bloom brand primary),
// #D7CBBD warm cream. Text colours are tuned for WCAG AA on their surfaces.
export const C = {
  canvas: '#F3EEE7', // page background — the cream, lifted so it reads as paper
  card: '#FFFFFF',
  soft: '#FAF7F2', // ticket / panel surface
  line: '#E6DCCF', // warm hairline
  cream: '#D7CBBD', // brand cream — perforations, dashed borders
  ink: '#121A15',
  body: '#3A403B',
  muted: '#5C615A',
  green: '#18A772', // accent: strips, rules, reward numerals (large text only)
  green2: '#008E2A',
  greenInk: '#00742A', // buttons + links (white text 5.8:1)
  greenTint: '#E7F5EC',
  greenDeep: '#0C3A21',
  amber: '#E39B2D',
  amberInk: '#7F4300',
  amberTint: '#FFF1DC',
  red: '#D9473B',
  redInk: '#9E2219',
  redTint: '#FCEAE8',
  neutralTint: '#EFE9E1',
}

export const TONES = {
  success: { accent: C.green, ink: '#0B6A31', tint: C.greenTint, cls: 'g' },
  action: { accent: C.amber, ink: C.amberInk, tint: C.amberTint, cls: 'a' },
  alert: { accent: C.red, ink: C.redInk, tint: C.redTint, cls: 'r' },
  neutral: { accent: C.cream, ink: C.body, tint: C.neutralTint, cls: 'n' },
}

export const F = {
  display: "Archivo,'Helvetica Neue',Arial,sans-serif",
  text: "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  mark: "'Archivo Black',Archivo,'Arial Black',Arial,sans-serif",
}

const T0 = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'
const txt = (size, lh, color, extra = '') =>
  `font-family:${F.text};font-size:${size}px;line-height:${lh}px;color:${color};${extra}`

// ---------------------------------------------------------------- primitives

export const label = (text, color = C.muted, cls = 'c-muted') =>
  `<p class="${cls}" style="margin:0 0 6px;${txt(11, 16, color, 'font-weight:700;letter-spacing:1.4px;text-transform:uppercase;')}">${text}</p>`

export const h1 = (text) =>
  `<h1 class="h1 c-ink" style="margin:0 0 14px;font-family:${F.display};font-size:31px;line-height:37px;letter-spacing:-0.6px;font-weight:800;color:${C.ink};">${text}</h1>`

export const h2 = (text) =>
  `<h2 class="c-ink" style="margin:0 0 10px;font-family:${F.display};font-size:22px;line-height:28px;letter-spacing:-0.3px;font-weight:800;color:${C.ink};">${text}</h2>`

export const lead = (text) =>
  `<p class="lead c-body" style="margin:0 0 22px;${txt(18, 28, C.body)}">${text}</p>`

export const p = (text, mb = 16) => `<p class="c-body" style="margin:0 0 ${mb}px;${txt(16, 26, C.body)}">${text}</p>`

export const small = (text, mb = 12) =>
  `<p class="c-muted" style="margin:0 0 ${mb}px;${txt(14, 22, C.muted)}">${text}</p>`

export const strong = (text) => `<strong class="c-ink" style="color:${C.ink};font-weight:700;">${text}</strong>`

export const link = (href, text) =>
  `<a href="${href}" target="_blank" class="c-link" style="color:${C.greenInk};font-weight:600;text-decoration:underline;">${text}</a>`

export const spacer = (h) => `<table ${T0} width="100%"><tr><td height="${h}" style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`

// ------------------------------------------------------------------- button

export function button(labelText, href, { secondary } = {}) {
  const bg = secondary ? C.card : C.greenInk
  const color = secondary ? C.greenInk : '#FFFFFF'
  const border = secondary ? `border:2px solid ${C.greenInk};` : ''
  return `<table ${T0} class="btn" style="margin:6px 0 20px;"><tr>
<td align="center" bgcolor="${bg}" style="border-radius:12px;background-color:${bg};${border}">
<a href="${href}" target="_blank" style="display:inline-block;padding:16px 30px;font-family:${F.text};font-size:17px;line-height:20px;font-weight:700;color:${color};text-decoration:none;border-radius:12px;">${labelText}&nbsp;&rarr;</a>
</td></tr></table>`
}

// -------------------------------------------------------------- bounty ticket
// The signature component: the bounty as a stub — what it is above a
// perforation, what it pays below. Title gets the full width so long titles
// wrap cleanly; the reward sits on its own line so long amounts never collide.

export function ticket({ kicker = 'Your bounty', title = '{{{BOUNTY_TITLE}}}', meta, reward = '{{{BOUNTY_REWARD}}}', rewardLabel = 'Reward', done } = {}) {
  const titleStyle = done
    ? `margin:0;${txt(19, 26, C.muted, 'font-weight:700;text-decoration:line-through;word-break:break-word;overflow-wrap:anywhere;')}`
    : `margin:0;${txt(19, 26, C.ink, 'font-weight:700;word-break:break-word;overflow-wrap:anywhere;')}`
  const metaRow = meta ? `<p class="c-body" style="margin:6px 0 0;${txt(14, 20, C.body)}">${meta}</p>` : ''
  const bottom = done
    ? `<td class="c-muted" style="${txt(11, 16, C.muted, 'font-weight:700;letter-spacing:1.4px;text-transform:uppercase;')}">Status</td>
<td align="right" style="white-space:nowrap;"><span class="c-tint-g c-tint-g-t" style="display:inline-block;padding:5px 12px;border-radius:999px;background-color:${C.greenTint};${txt(14, 18, '#0B6A31', 'font-weight:800;')}">&#10003;&nbsp;Done</span></td>`
    : `<td class="c-muted" style="${txt(11, 16, C.muted, 'font-weight:700;letter-spacing:1.4px;text-transform:uppercase;')}">${rewardLabel}</td>
<td align="right" class="c-reward" style="font-family:${F.display};font-size:26px;line-height:30px;font-weight:800;letter-spacing:-0.4px;color:${C.green2};word-break:break-word;">${reward}</td>`
  return `<table ${T0} width="100%" class="c-soft" style="margin:0 0 24px;background-color:${C.soft};border:1px solid ${C.line};border-radius:14px;">
<tr><td style="padding:18px 20px 16px;">${label(kicker)}<p class="${done ? 'c-muted' : 'c-ink'}" style="${titleStyle}">${title}</p>${metaRow}</td></tr>
<tr><td style="padding:0 20px;"><table ${T0} width="100%"><tr><td class="c-perf" style="border-top:2px dashed ${C.cream};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:14px 20px 16px;"><table ${T0} width="100%"><tr>${bottom}</tr></table></td></tr>
</table>`
}

// ----------------------------------------------------------- numbered steps
// Editorial list: green tabular numerals, hairline between rows.

export function steps(items, heading) {
  const rows = items
    .map(
      ([title, body], i) => `<tr>
<td valign="top" width="40" class="c-line c-accent" style="padding:13px 0 13px;border-top:1px solid ${C.line};font-family:${F.display};font-size:14px;line-height:24px;font-weight:800;color:${C.green2};letter-spacing:0.5px;">0${i + 1}</td>
<td valign="top" class="c-line c-body" style="padding:13px 0 13px;border-top:1px solid ${C.line};${txt(16, 24, C.body)}">${strong(title)} ${body}</td>
</tr>`
    )
    .join('')
  return `${heading ? label(heading) : ''}<table ${T0} width="100%" style="margin:0 0 22px;">${rows}</table>`
}

// ---------------------------------------------------------------- tips list

export function tips(items, heading) {
  const rows = items
    .map(
      ([title, body]) => `<tr>
<td valign="top" width="26" class="c-accent" style="padding:0 0 12px;font-family:${F.text};font-size:16px;line-height:24px;font-weight:800;color:${C.green2};">&rarr;</td>
<td valign="top" class="c-body" style="padding:0 0 12px;${txt(16, 24, C.body)}">${strong(title)} ${body}</td></tr>`
    )
    .join('')
  return `${heading ? label(heading) : ''}<table ${T0} width="100%" style="margin:0 0 18px;">${rows}</table>`
}

// ------------------------------------------------- trust / payment callout

export function callout(text, heading = 'Your money', tone = 'success') {
  const t = TONES[tone]
  return `<table ${T0} width="100%" style="margin:0 0 24px;"><tr>
<td class="c-tint-${t.cls}" style="padding:16px 18px;background-color:${t.tint};border-radius:12px;">
<p class="c-tint-${t.cls}-t" style="margin:0 0 4px;${txt(11, 16, t.ink, 'font-weight:800;letter-spacing:1.4px;text-transform:uppercase;')}">${heading}</p>
<p class="c-tint-${t.cls}-t" style="margin:0;${txt(15, 23, tone === 'success' ? C.greenDeep : tone === 'neutral' ? C.ink : t.ink)}">${text}</p>
</td></tr></table>`
}

// ------------------------------------------------ status rows (key / value)
// For anything about money or state: say exactly where things stand.

export function statusRows(rows) {
  const tr = rows
    .map(
      ([k, v, tone]) => `<tr>
<td class="c-line c-muted" style="padding:11px 0;border-bottom:1px solid ${C.line};${txt(14, 20, C.muted)}">${k}</td>
<td align="right" class="c-line ${tone ? `c-tint-${TONES[tone].cls}-t` : 'c-ink'}" style="padding:11px 0;border-bottom:1px solid ${C.line};${txt(14, 20, tone ? TONES[tone].ink : C.ink, 'font-weight:700;')}">${v}</td></tr>`
    )
    .join('')
  return `<table ${T0} width="100%" class="c-line" style="margin:0 0 22px;border-top:1px solid ${C.line};">${tr}</table>`
}

// ---------------------------------------------- two-up choice / stat tiles

export function twoUp(left, right) {
  const cell = ([k, v], pad) => `<td valign="top" width="50%" class="stack ${pad ? 'stack-gap' : ''}" style="${pad ? 'padding-left:10px;' : ''}">
<table ${T0} width="100%" class="c-card" style="border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:16px 16px 14px;">
${label(k)}<p class="c-body" style="margin:0;${txt(15, 22, C.body)}">${v}</p></td></tr></table></td>`
  return `<table ${T0} width="100%" style="margin:0 0 22px;"><tr>${cell(left)}${cell(right, true)}</tr></table>`
}

export function stat(value, caption, sideLabel, sideValue) {
  return `<table ${T0} width="100%" class="c-soft" style="margin:0 0 20px;background-color:${C.soft};border:1px solid ${C.line};border-radius:14px;"><tr>
<td valign="top" class="stack" style="padding:18px 20px;">
<p class="c-ink" style="margin:0;font-family:${F.display};font-size:28px;line-height:32px;font-weight:800;letter-spacing:-0.5px;color:${C.ink};">${value}</p>
<p class="c-muted" style="margin:4px 0 0;${txt(14, 20, C.muted)}">${caption}</p></td>
<td valign="top" align="right" class="stack stack-left" style="padding:18px 20px;">
${label(sideLabel)}<p class="c-tint-a-t" style="margin:0;${txt(16, 22, C.amberInk, 'font-weight:800;')}">${sideValue}</p></td>
</tr></table>`
}

// -------------------------------------------------------------- chips

export function chips(items, heading) {
  const c = items
    .map(
      (i) => `<span class="c-line c-body" style="display:inline-block;margin:0 6px 8px 0;padding:7px 13px;border:1px solid ${C.line};border-radius:999px;${txt(14, 18, C.body)}">${i}</span>`
    )
    .join('')
  return `${heading ? label(heading) : ''}<p style="margin:0 0 20px;">${c}</p>`
}

// ------------------------------------------------------- forwardable box

export function forwardBox(inner) {
  return `<table ${T0} width="100%" class="c-soft" style="margin:4px 0 20px;background-color:${C.soft};border:2px dashed ${C.cream};border-radius:16px;"><tr><td style="padding:22px 22px 6px;">${inner}</td></tr></table>`
}

// ------------------------------------------------------------- sign-off

export const signoff = (who = 'The Bounty team') =>
  `<table ${T0} style="margin:4px 0 18px;"><tr>
<td width="30" valign="middle"><img src="${ASSETS.mark}" width="22" height="22" alt="" border="0" style="display:block;width:22px;height:22px;border-radius:6px;"></td>
<td valign="middle" class="c-ink" style="${txt(15, 20, C.ink, 'font-weight:700;')}">${who}</td></tr></table>`

// ------------------------------------------------------------------ shell

const DARK = [
  ['.c-canvas', 'background-color:#0F1311'],
  ['.c-card', 'background-color:#171C19;border-color:#2A322D'],
  ['.c-soft', 'background-color:#1E2420;border-color:#2F3832'],
  ['.c-ink', 'color:#F2EEE8'],
  ['.c-body', 'color:#CFCAC2'],
  ['.c-muted', 'color:#A39E96'],
  ['.c-link', 'color:#5FDCA2'],
  ['.c-line', 'border-color:#2A322D'],
  ['.c-perf', 'border-color:#3C463F'],
  ['.c-reward', 'color:#5FDCA2'],
  ['.c-accent', 'color:#5FDCA2'],
  ['.c-tint-g', 'background-color:#13301F'],
  ['.c-tint-g-t', 'color:#8FE6B9'],
  ['.c-tint-a', 'background-color:#3A2A10'],
  ['.c-tint-a-t', 'color:#F5C77E'],
  ['.c-tint-r', 'background-color:#3D1916'],
  ['.c-tint-r-t', 'color:#F4A79F'],
  ['.c-tint-n', 'background-color:#262B27'],
  ['.c-tint-n-t', 'color:#E6E1D9'],
]

function styleBlock() {
  const dark = DARK.map(([s, d]) => `${s}{${d.split(';').map((x) => `${x} !important`).join(';')}}`).join('\n')
  // Outlook.com dark mode rewrites colours and tags elements with data-ogsc /
  // data-ogsb; repeating the rules there keeps our palette instead of its guess.
  const ogsc = DARK.filter(([, d]) => d.startsWith('color')).map(([s, d]) => `[data-ogsc] ${s}{${d} !important}`).join('\n')
  const ogsb = DARK.filter(([, d]) => d.startsWith('background')).map(([s, d]) => `[data-ogsb] ${s}{${d.split(';')[0]} !important}`).join('\n')
  return `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0 !important;padding:0 !important;width:100% !important;-webkit-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
@media only screen and (max-width:620px){
.container{width:100% !important;}
.px{padding-left:20px !important;padding-right:20px !important;}
.pad-card{padding:28px 22px 6px !important;}
.h1{font-size:27px !important;line-height:33px !important;}
.lead{font-size:17px !important;line-height:26px !important;}
.btn{width:100% !important;}
.btn a{display:block !important;text-align:center !important;}
.stack{display:block !important;width:100% !important;box-sizing:border-box !important;}
.stack-gap{padding-left:0 !important;padding-top:10px !important;}
.stack-left{text-align:left !important;padding-top:0 !important;}
}
@media (prefers-color-scheme:dark){
${dark}
}
${ogsc}
${ogsb}
</style>`
}

const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(36)

/**
 * @param {object} o
 * @param {string} o.title       <title> (shown by some clients in previews)
 * @param {string} o.preheader   inbox preview text (may contain variables)
 * @param {{label:string,tone:string}|{label:string,vars:true}} o.stamp
 * @param {string} o.body        card content (component HTML)
 * @param {string} o.footer      footer HTML (see footer())
 * @param {string} o.emailKey    stable key for measurement + debugging
 */
export function shell({ title, preheader, stamp, body, footer, emailKey, variables }) {
  const tone = stamp.vars
    ? { accent: '{{{TONE_ACCENT}}}', ink: '{{{TONE_INK}}}', tint: '{{{TONE_TINT}}}', cls: null }
    : TONES[stamp.tone]
  const stampCls = tone.cls ? `c-tint-${tone.cls} c-tint-${tone.cls}-t` : ''
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<!-- bounty-email-design v2 · email_key: ${emailKey} · variables: ${variables.join(', ')} -->
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
${styleBlock()}
</head>
<body class="c-canvas" style="margin:0;padding:0;background-color:${C.canvas};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">${preheader}${PREHEADER_FILL}</div>
<table ${T0} width="100%" class="c-canvas" bgcolor="${C.canvas}" style="background-color:${C.canvas};">
<tr><td align="center" style="padding:26px 10px 36px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table ${T0} class="container" width="600" style="width:600px;max-width:600px;">
<tr><td class="px" style="padding:0 8px 16px;">
<table ${T0} width="100%"><tr>
<td valign="middle"><table ${T0}><tr>
<td valign="middle" width="34"><a href="${ASSETS.site}" target="_blank" style="text-decoration:none;"><img src="${ASSETS.mark}" width="34" height="34" alt="Bounty" border="0" style="display:block;width:34px;height:34px;border-radius:9px;font-family:${F.text};font-size:12px;color:${C.greenInk};"></a></td>
<td valign="middle" class="c-ink" style="padding-left:10px;font-family:${F.mark};font-size:15px;line-height:20px;font-weight:900;letter-spacing:3px;color:${C.ink};">BOUNTY</td>
</tr></table></td>
<td valign="middle" align="right"><span class="${stampCls}" style="display:inline-block;padding:6px 11px;border-radius:999px;background-color:${tone.tint};${txt(11, 14, tone.ink, 'font-weight:800;letter-spacing:1.2px;text-transform:uppercase;white-space:nowrap;')}"><span style="color:${tone.accent};">&#9679;</span>&nbsp;${stamp.label}</span></td>
</tr></table>
</td></tr>
<tr><td class="c-card" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.line};border-radius:20px;">
<table ${T0} width="100%">
<tr><td height="5" bgcolor="${tone.accent}" style="height:5px;font-size:0;line-height:0;background-color:${tone.accent};border-radius:20px 20px 0 0;">&nbsp;</td></tr>
<tr><td class="pad-card" style="padding:34px 40px 10px;">
${body}
</td></tr>
</table>
</td></tr>
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`
}

/**
 * Footer outside the card. Transactional emails get a reason + settings;
 * lifecycle (non-essential) emails also get an unsubscribe link.
 */
export function footer({ reason, links = [], postal = '{{{POSTAL_LINE}}}', tagline = 'Got a task? Drop a bounty.', extra = '' }) {
  const linkHtml = links
    .map(([text, href]) => `<a href="${href}" target="_blank" class="c-muted" style="color:${C.muted};text-decoration:underline;">${text}</a>`)
    .join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')
  return `<tr><td class="px" style="padding:24px 8px 0;">
${extra}
<table ${T0} style="margin:0 0 12px;"><tr>
<td width="26" valign="middle"><img src="${ASSETS.mark}" width="18" height="18" alt="" border="0" style="display:block;width:18px;height:18px;border-radius:5px;"></td>
<td valign="middle" class="c-ink" style="${txt(13, 18, C.ink, 'font-weight:700;')}">Bounty&nbsp;<span class="c-muted" style="color:${C.muted};font-weight:400;">&middot;&nbsp;${tagline}</span></td>
</tr></table>
<p class="c-muted" style="margin:0 0 8px;${txt(12, 18, C.muted)}">${reason}</p>
${linkHtml ? `<p class="c-muted" style="margin:0 0 8px;${txt(12, 18, C.muted)}">${linkHtml}</p>` : ''}
${postal ? `<p class="c-muted" style="margin:0;${txt(12, 18, C.muted)}">${postal}</p>` : ''}
</td></tr>`
}
