import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('homepage is one complete HTML document with no trailing source fragments', () => {
  assert.equal((html.match(/<!doctype html>/gi) || []).length, 1);
  assert.equal((html.match(/<\/html>/gi) || []).length, 1);
  assert.match(html.trimEnd(), /<\/html>$/i);
});

test('homepage script tags are balanced and every inline script parses', () => {
  const openingTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
  const closingTags = [...html.matchAll(/<\/script>/gi)];
  const scriptBlocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

  assert.equal(openingTags.length, closingTags.length, 'every script opening tag has a closing tag');
  assert.equal(scriptBlocks.length, openingTags.length, 'all script blocks are properly paired');

  for (const [index, block] of scriptBlocks.entries()) {
    if (/\bsrc\s*=/.test(block[1])) continue;
    assert.doesNotThrow(
      () => new vm.Script(block[2], { filename: \`index.html:inline-script-\${index + 1}\` }),
      \`inline script \${index + 1} must parse\`
    );
  }
});
