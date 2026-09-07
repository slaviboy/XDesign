import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

// The DOM fence below is load-bearing, not stylistic. jsdom has no DOMMatrix and
// no getBBox at all; happy-dom implements getBBox() as `return new DOMRect()`
// (always 0,0,0,0) and getCTM() as a fresh identity matrix. Geometry code that
// leaned on those would be tested against fabricated zeros. Keeping
// src/geometry and src/document free of DOM access is what makes the unit
// suite meaningful — and it is what lets those tests run in plain node.
const DOM_FENCE = {
  'no-restricted-globals': [
    'error',
    { name: 'document', message: 'src/geometry and src/document must stay DOM-free.' },
    { name: 'window', message: 'src/geometry and src/document must stay DOM-free.' },
    { name: 'DOMMatrix', message: 'Use Mat2D from src/geometry/Matrix.ts instead.' },
    { name: 'DOMMatrixReadOnly', message: 'Use Mat2D from src/geometry/Matrix.ts instead.' },
    { name: 'DOMPoint', message: 'Use Vec2 from src/geometry/Matrix.ts instead.' },
    { name: 'DOMRect', message: 'Use Bounds from src/geometry/Bounds.ts instead.' },
  ],
  'no-restricted-properties': [
    'error',
    { property: 'getBBox', message: 'happy-dom returns a fake 0,0,0,0. Use geometryBounds().' },
    { property: 'getCTM', message: 'happy-dom returns a fake identity. Use worldMatrix().' },
    { property: 'getScreenCTM', message: 'Use the Viewport matrix instead.' },
    { property: 'getComputedTextLength', message: 'Use measureText() from src/text.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='DOMMatrix']",
      message: 'Use Mat2D from src/geometry/Matrix.ts instead.',
    },
  ],
}

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  { files: ['src/geometry/**/*.ts', 'src/document/**/*.ts'], rules: DOM_FENCE },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', '*.config.ts', 'src/sw.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
)
