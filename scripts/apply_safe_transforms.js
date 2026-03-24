#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const scanDirs = ['app', 'components', 'lib', 'hooks', 'services'];
const exts = ['.js', '.ts', '.tsx', '.jsx'];

function walk(dir, cb) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build' || e.name === '.expo')) {
      continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

function isTextFile(file) {
  return exts.includes(path.extname(file));
}

function transform(content) {
  let out = content;

  // 1) Logical assignment -> expanded form for simple left-hand expressions
  // Match identifiers, dotted properties, and bracket access (conservative)
  const logicalRe = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.(?:[A-Za-z_$][A-Za-z0-9_$]*)|\[[^\]]+\])*)\s*&&=\s*/g;
  out = out.replace(logicalRe, (m, left) => `${left} = ${left} && `);

  const logicalOrRe = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.(?:[A-Za-z_$][A-Za-z0-9_$]*)|\[[^\]]+\])*)\s*\|\|=\s*/g;
  out = out.replace(logicalOrRe, (m, left) => `${left} = ${left} || `);

  const logicalNullishRe = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.(?:[A-Za-z_$][A-Za-z0-9_$]*)|\[[^\]]+\])*)\s*\?\?=\s*/g;
  out = out.replace(logicalNullishRe, (m, left) => `${left} = ${left} ?? `);

  // 2) Numeric separators removal
  // Hex
  out = out.replace(/\b0x[0-9a-fA-F_]+\b/g, s => s.replace(/_/g, ''));
  // Binary
  out = out.replace(/\b0b[01_]+\b/g, s => s.replace(/_/g, ''));
  // Octal
  out = out.replace(/\b0o[0-7_]+\b/g, s => s.replace(/_/g, ''));
  // Decimal (avoid matching trailing dots by word boundary)
  out = out.replace(/\b\d[\d_]*\b/g, s => s.replace(/_/g, ''));

  // 3) Convert 8-digit hex colors (#RRGGBBAA) to rgba(...) for better runtime compatibility.
  // This only rewrites the hex token itself and leaves surrounding quotes intact.
  out = out.replace(/#([0-9a-fA-F]{8})\b/g, (m, hex) => {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    // Keep alpha concise but stable.
    const alpha = Number(a.toFixed(3));
    return `rgba(${r},${g},${b},${alpha})`;
  });

  // 4) Remove unsupported/fragile StyleSheet gap keys conservatively.
  // Removes full lines like: "gap: 8," to avoid parser/runtime differences on older engines.
  out = out.replace(/^\s*gap\s*:\s*[^,\n]+,?\s*$/gm, '');

  // 5) Remove Tailwind gap utility tokens from className strings in a conservative way.
  // Example: "flex-row gap-2 items-center" -> "flex-row items-center"
  out = out.replace(/\b(gap-[0-9]+)\b/g, '');
  // Cleanup duplicate spaces introduced by the previous replacement in quoted className strings.
  out = out.replace(/className=(['"])\s*([^'"\n]*?)\s*\1/g, (m, quote, classes) => {
    const cleaned = classes.replace(/\s+/g, ' ').trim();
    return `className=${quote}${cleaned}${quote}`;
  });

  return out;
}

const changedFiles = [];

for (const d of scanDirs) {
  const abs = path.join(root, d);
  if (!fs.existsSync(abs)) continue;
  walk(abs, file => {
    if (!isTextFile(file)) return;
    try {
      const src = fs.readFileSync(file, 'utf8');
      const res = transform(src);
      if (res !== src) {
        fs.writeFileSync(file, res, 'utf8');
        changedFiles.push(file.replace(root + path.sep, ''));
      }
    } catch (err) {
      console.error('ERR', file, err && err.message);
    }
  });
}

console.log('Safe transforms applied. Files changed:', changedFiles.length);
if (changedFiles.length) console.log(changedFiles.join('\n'));

if (changedFiles.length === 0) process.exitCode = 0;
