import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Renders the plain-text legal documents in assets/legal/*.ts.
 *
 * Those files are plain text with a few conventions, not markdown: blank
 * lines separate paragraphs, a one-line ALL-CAPS paragraph is a heading, and
 * lines starting "- " are list items. The terms file also opens with a
 * literal "# " title. Every screen used to split on blank lines and print the
 * result verbatim, so the "#" was shown to users and headings looked like body
 * text (Shoal trust-audit, 2026-09-19).
 */

export type LegalBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'toc'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] };

// A heading is a single line with no lowercase letters, e.g. "7. REFUNDS POLICY"
// or "CONTACT US". Capped in length so a shouted sentence stays a paragraph.
const HEADING_RE = /^[^a-z\n]{3,80}$/;
const HAS_LETTER_RE = /[A-Z]/;

function isHeading(p: string): boolean {
  return HEADING_RE.test(p) && HAS_LETTER_RE.test(p);
}

export function parseLegalText(text: string): LegalBlock[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(Boolean);

  // The terms file lists every section heading twice: once in its table of
  // contents and once above the section. The first occurrence is the TOC entry.
  const headingCounts = new Map<string, number>();
  for (const p of paragraphs) {
    if (isHeading(p)) headingCounts.set(p, (headingCounts.get(p) ?? 0) + 1);
  }
  const seen = new Set<string>();

  const blocks: LegalBlock[] = [];
  for (const p of paragraphs) {
    if (p.startsWith('# ')) {
      blocks.push({ kind: 'title', text: p.slice(2).trim() });
      continue;
    }
    if (isHeading(p)) {
      const isTocEntry = (headingCounts.get(p) ?? 0) > 1 && !seen.has(p);
      seen.add(p);
      blocks.push({ kind: isTocEntry ? 'toc' : 'heading', text: p });
      continue;
    }

    // A paragraph may mix a lead-in line with "- " items; keep their order.
    let prose: string[] = [];
    let items: string[] = [];
    const flushProse = () => {
      if (prose.length) blocks.push({ kind: 'paragraph', text: prose.join('\n') });
      prose = [];
    };
    const flushItems = () => {
      if (items.length) blocks.push({ kind: 'bullets', items });
      items = [];
    };
    for (const line of p.split('\n')) {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) {
        flushProse();
        items.push(bullet[1]);
      } else {
        flushItems();
        prose.push(line);
      }
    }
    flushProse();
    flushItems();
  }
  return blocks;
}

interface LegalTextProps {
  text: string;
}

export function LegalText({ text }: LegalTextProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const blocks = useMemo(() => parseLegalText(text), [text]);

  return (
    <View>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'title':
            return (
              <Text key={i} style={s.title} accessibilityRole="header">
                {b.text}
              </Text>
            );
          case 'heading':
            return (
              <Text key={i} style={s.heading} accessibilityRole="header">
                {b.text}
              </Text>
            );
          case 'toc':
            return (
              <Text key={i} style={s.toc}>
                {b.text}
              </Text>
            );
          case 'bullets':
            return (
              <View key={i} style={s.list}>
                {b.items.map((item, j) => (
                  <View key={j} style={s.listItem}>
                    <Text style={s.bullet}>{'•'}</Text>
                    <Text style={s.listText}>{item}</Text>
                  </View>
                ))}
              </View>
            );
          default:
            return (
              <Text key={i} style={s.paragraph}>
                {b.text}
              </Text>
            );
        }
      })}
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: t.text,
      marginTop: 8,
      marginBottom: 8,
    },
    heading: {
      fontSize: 15,
      fontWeight: '700',
      color: t.text,
      marginTop: 12,
      marginBottom: 8,
    },
    toc: {
      fontSize: 13,
      lineHeight: 19,
      color: t.textSecondary,
      marginBottom: 2,
    },
    paragraph: {
      fontSize: 14,
      lineHeight: 21,
      color: t.textSecondary,
      marginBottom: 12,
    },
    list: {
      marginBottom: 12,
    },
    listItem: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    bullet: {
      width: 16,
      fontSize: 14,
      lineHeight: 21,
      color: t.textSecondary,
    },
    listText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 21,
      color: t.textSecondary,
    },
  });
}
