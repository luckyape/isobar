import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDemoDocument(htmlPath: string): Document {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const doc = document.implementation.createHTMLDocument('demo');
  doc.open();
  doc.write(html);
  doc.close();
  return doc;
}

describe('ECCC reader layout', () => {
  it('shows the reader column on large screens via CSS rules', () => {
    const htmlPath = path.resolve(__dirname, '../../demos/transition-a.html');
    const doc = loadDemoDocument(htmlPath);

    const reader = doc.querySelector('.readerCol');
    expect(reader).not.toBeNull();
    expect(reader?.hasAttribute('hidden')).toBe(false);

    const styleText = Array.from(doc.querySelectorAll('style'))
      .map((style) => style.textContent || '')
      .join('\n');

    const baseRulePattern = /\.readerCol\s*\{[\s\S]*?display:\s*none\s*;?/;
    const mediaRulePattern = /@media\s*\(min-width:\s*980px\)[\s\S]*?\.readerCol\s*\{[\s\S]*?display:\s*block\s*;?/;

    expect(styleText).toMatch(baseRulePattern);
    expect(styleText).toMatch(mediaRulePattern);
  });
});
