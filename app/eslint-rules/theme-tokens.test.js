import { RuleTester, ESLint } from 'eslint';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import rule from './theme-tokens.js';

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});
tester.run('theme-tokens', rule, {
  valid: [
    "const record = { runId: '#abcdef', fill: 'norm', [fontFamily]: 'abc' };",
    "const sx = { fontFamily: 'var(--font-body)', color: 'var(--red)' };",
    'const sx = { font: `600 12px ${tokens.body}` };',

    'const sx = { color: tokens.ink, fontFamily: tokens.mono, border: `1px solid ${tokens.border}` };',
    "const sx = { color: 'text.secondary', background: 'transparent', fontFamily: 'inherit', fontSize: 12 };",
    "const sx = { color: withAlpha(tokens.ink, 0.2), fill: 'url(#pattern)' };",
    "const categories = { fill: 'norm' }; const label = 'red'; const url = 'https://example.org/#abcdef';",
    'const rgb = `rgba(${r}, ${g}, ${b}, ${alpha})`;',
    'const view = <svg fill={selected ? colors.active : colors.idle} />;',
  ],
  invalid: [
    { code: "const sx = { color: withAlpha('#fff', 0.5) };", errors: [{ messageId: 'color' }] },
    { code: "const sx = { color: 'var(--surface, #fff)' };", errors: [{ messageId: 'color' }] },

    {
      code: "const sx = { background: 'linear-gradient(red, blue)' };",
      errors: [{ messageId: 'color' }],
    },
    { code: "const sx = { color: 'color(display-p3 1 0 0)' };", errors: [{ messageId: 'color' }] },
    { code: 'context.font = `${12}px Arial`;', errors: [{ messageId: 'font' }] },
    {
      code: "const font = 'Arial'; const sx = { fontFamily: font };",
      errors: [{ messageId: 'font' }],
    },

    {
      code: "const local = '#123456'; const sx = { color: local };",
      errors: [{ messageId: 'color' }],
    },
    {
      code: "const sx = { background: 'linear-gradient(red, rgb(1, 2, 3))' };",
      errors: [{ messageId: 'color' }],
    },
    { code: "const sx = { border: '1px solid red' };", errors: [{ messageId: 'color' }] },
    { code: "const view = <svg fill='rebeccapurple' />;", errors: [{ messageId: 'color' }] },
    {
      code: "const sx = { color: selected ? tokens.ink : 'white' };",
      errors: [{ messageId: 'color' }],
    },
    {
      code: "const sx = { fontFamily: { xs: tokens.body, md: 'Arial' } };",
      errors: [{ messageId: 'font' }],
    },
    { code: "context.font = '12px monospace';", errors: [{ messageId: 'font' }] },
    { code: 'const sx = { color: `#fff` };', errors: [{ messageId: 'color' }] },
    {
      code: "const view = <div style={{ fontFamily: 'Arial' }} />;",
      errors: [{ messageId: 'font' }],
    },
  ],
});

it('enforces production code while permitting theme definitions and test fixtures', async () => {
  const eslint = new ESLint();
  for (const [filePath, expected] of [
    ['src/components/TokenProbe.tsx', 1],
    ['src/ui/theme/palettes.ts', 0],
    ['src/ui/theme/index.ts', 0],
    ['src/components/TokenProbe.test.tsx', 0],
  ]) {
    const [result] = await eslint.lintText("export const probe = { color: '#abcdef' };", {
      filePath,
    });
    assert.equal(
      result.messages.filter((message) => message.ruleId === 'local/theme-tokens').length,
      expected,
      filePath,
    );
  }
});
