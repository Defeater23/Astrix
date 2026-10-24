import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../tailwind.config';

/** Guards the strict monochrome rule: no colored palette, gradients or glow effects. */

function collectHexColors(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^#[0-9a-f]{6}$/i.test(value)) found.push(value);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectHexColors(child, found);
  }
  return found;
}

function isGray(hex: string): boolean {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return r.toLowerCase() === g.toLowerCase() && g.toLowerCase() === b.toLowerCase();
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

describe('monochrome design system', () => {
  it('defines only true grays (R = G = B) in the Tailwind theme', () => {
    const colors = collectHexColors(tailwindConfig.theme?.colors);
    expect(colors.length).toBeGreaterThan(5);
    expect(colors.filter((hex) => !isGray(hex))).toEqual([]);
  });

  it('does not extend the theme with additional colors', () => {
    expect(tailwindConfig.theme?.extend).not.toHaveProperty('colors');
  });

  it('uses no gradients, shadows, glows or non-gray hex values in source files', () => {
    const files = walk(join(__dirname));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/gradient|box-shadow|drop-shadow|\bshadow(-|\b)|blur-/i.test(text)) {
        offenders.push(`${file}: gradient/shadow/blur`);
      }
      for (const match of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        if (!isGray(match[0])) offenders.push(`${file}: ${match[0]}`);
      }
      if (/\b(rgb|hsl)a?\(/i.test(text)) offenders.push(`${file}: rgb/hsl color function`);
    }
    expect(offenders).toEqual([]);
  });
});
