import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../constants/support';

export type OffPlatformRisk = 'payment' | 'contact';

const paymentMethod = /\b(?:venmo|paypal|cash\s*app|zelle|apple\s*pay|google\s*pay|western\s*union|moneygram|bitcoin|btc|crypto(?:currency)?|wire\s*transfer|bank\s*transfer|gift\s*cards?)\b/i;
const paymentIntent = /\b(?:pay|paid|payment|send|transfer|accept|deposit|charge|settle|refund|tip|use|using)\b/i;
const contactMove = /\b(?:(?:text|call|email|e-mail|whatsapp|telegram|dm)\s+(?:me|us)|(?:message|contact|reach)\s+(?:me|us)\s+(?:on|at|via|outside)|(?:move|take|continue|switch)\b.{0,45}\b(?:off[- ]?(?:platform|app)|outside\s+(?:bounty|the\s+app)|whatsapp|telegram|signal|email|sms|text(?:ing)?)|(?:let'?s|can\s+we)\s+(?:talk|chat)\s+(?:on|via)\s+(?:whatsapp|telegram|signal|email)|(?:my|your)\s+(?:phone\s+number|email\s+address)|(?:send|share|give)\b.{0,25}\b(?:phone\s+number|email|contact\s+details))\b/i;

function withoutNegatedInstructions(text: string): string {
  // Remove only safety instructions, not unrelated negations like "don't worry".
  return text
    .replace(/\b(?:don'?t|do\s+not|never|shouldn'?t|should\s+not|won'?t|will\s+not|cannot|can'?t|avoid|stop)\s+(?:(?:ever|please|just)\s+)?(?:pay|paying|send|sending|share|sharing|give|giving|move|moving|take|taking|use|using|accept|accepting|text|texting|call|calling|email|emailing|contact|contacting|settle|settling|transfer|transferring|communicate|communicating)\b[^,;.!?\n]*/gi, '')
    .replace(/\bno\s+(?:off[- ]platform|external|outside)\s+payments?\b/gi, '');
}

/** Advisory heuristics over local plaintext only; never inspects attachments or calls a service. */
export function detectOffPlatformRisk(plaintext: string): OffPlatformRisk | null {
  const normalized = plaintext.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase();
  const clauses = normalized.split(/(?:[.!?]\s+|[;\n]+|\bbut\b|\bhowever\b)/);
  let contact = false;

  for (const raw of clauses) {
    let clause = withoutNegatedInstructions(raw);
    let paymentLink = false;
    clause = clause.replace(/\b(?:https?:\/\/|www\.)[^\s<>]+|\b(?:paypal\.me|venmo\.com|cash\.app|wa\.me|t\.me)\/[^\s<>]+/g, url => {
      const host = url.replace(/^(?:https?:\/\/|www\.)/, '').split('/')[0];
      if (/^(?:www\.)?(?:paypal\.me|paypal\.com|venmo\.com|cash\.app|zellepay\.com)$/.test(host)) paymentLink = true;
      if (/^(?:www\.)?(?:wa\.me|t\.me|api\.whatsapp\.com)$/.test(host)) contact = true;
      // Reference/portfolio URLs aren't instructions, including words in paths.
      return ' ';
    });
    clause = clause.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g, email => {
      if (email !== SUPPORT_EMAIL.toLowerCase()) contact = true;
      return email === SUPPORT_EMAIL.toLowerCase() ? ' official-support ' : ' ';
    });
    clause = clause.replace(/(?:\+?\d[\d(). -]{7,}\d)/g, phone => {
      const digits = phone.replace(/\D/g, '');
      const supportDigits = SUPPORT_PHONE.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15 &&
          digits !== supportDigits && digits !== supportDigits.slice(1) &&
          !/^\d{4}-\d{2}-\d{2}$/.test(phone)) contact = true;
      return digits === supportDigits || digits === supportDigits.slice(1) ? ' official-support ' : ' ';
    });
    clause = clause.replace(/\b(?:email|e-mail|call|text|contact|reach)\s+(?:(?:me|us)\s+)?(?:(?:at|on|via)\s+)?official-support\b/g, '');

    if (paymentLink ||
        /(?:^|\s)\$[a-z][a-z0-9_]{2,19}\b/.test(clause) ||
        /\b(?:venmo|paypal|zelle|cash\s*app)\s+(?:me|us)\b/.test(clause) ||
        (paymentMethod.test(clause) &&
          (paymentIntent.test(clause) || /(?:@[\w.-]+|\$[a-z][\w]*|\bmy\b|\bhandle\b)/i.test(clause))) ||
        /\b(?:pay|send|give)\s+(?:me|us|you|them)\b.{0,35}\b(?:cash|directly|outside|off[- ]platform)\b/.test(clause) ||
        /\b(?:pay|payment|paid|settle|settlement|refund|money)\b.{0,45}\b(?:outside\s+(?:bounty|the\s+app)|off[- ]?(?:platform|app)|in\s+cash)\b/.test(clause) ||
        /\b(?:accept|take)\s+(?:only\s+)?cash\b/.test(clause) ||
        /\bpay\s+(?:(?:me|us|you|them)\s+)?(?:in\s+)?cash\b/.test(clause) ||
        (paymentIntent.test(clause) && /\b(?:outside\s+(?:bounty|the\s+app)|off[- ]?(?:platform|app))\b/.test(clause)) ||
        /\b(?:pay|send)\b.{0,25}\b(?:fee|deposit)\b.{0,30}\b(?:get|receive|start|secure)\b.{0,15}\b(?:job|work|bounty)\b/.test(clause)) {
      return 'payment';
    }
    if (contactMove.test(clause)) contact = true;
  }
  return contact ? 'contact' : null;
}

export interface RiskMessage {
  id: string;
  text: string;
  createdAt: string | number;
}

/** One contextual warning per conversation, attached to the newest relevant incoming message. */
export function latestIncomingRisk<T extends RiskMessage>(
  messages: readonly T[],
  isIncoming: (message: T) => boolean,
): { message: T; risk: OffPlatformRisk } | null {
  let latest: { message: T; risk: OffPlatformRisk } | null = null;
  let latestTime = -Infinity;
  for (const message of messages) {
    if (!isIncoming(message)) continue;
    const risk = detectOffPlatformRisk(message.text);
    if (!risk) continue;
    const time = typeof message.createdAt === 'number' ? message.createdAt : Date.parse(message.createdAt);
    const comparableTime = Number.isFinite(time) ? time : 0;
    if (comparableTime >= latestTime) {
      latest = { message, risk };
      latestTime = comparableTime;
    }
  }
  return latest;
}
