#!/usr/bin/env node
/**
 * Fail when anything that looks like a credential (or a machine-specific path)
 * is committed. Dependency-free so it can run in CI and via `npm test`.
 *
 * The point is not to replace GitHub secret scanning: it keeps THIS repository's
 * own history clean, including data the plugin prints into tests and docs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.tgz']);

const RULES = [
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub classic token', pattern: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: 'registry auth token assignment', pattern: /_authToken\s*=/ },
  { name: 'bearer header', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: 'secret assignment', pattern: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i },
  { name: 'absolute Windows user path', pattern: /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/ },
];

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    return output.split('\0').filter(Boolean);
  } catch {
    // No git (e.g. running from an unpacked tarball): walk the directory instead.
    const collected = [];
    const walk = (dir, prefix) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) walk(join(dir, entry.name), relative);
        else collected.push(relative);
      }
    };
    walk(process.cwd(), '');
    return collected;
  }
}

function extensionOf(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index).toLowerCase();
}

const findings = [];
let scanned = 0;

for (const file of trackedFiles()) {
  if (SKIP_EXTENSIONS.has(extensionOf(file))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;
  const lines = text.split('\n');
  for (const rule of RULES) {
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        findings.push(`${file}:${index + 1}  ${rule.name}  ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`secret scan found ${findings.length} suspicious line(s):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`secret scan OK: ${scanned} text files clean`);
