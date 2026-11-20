import js from '@eslint/js';

// 服务端：先把"未定义变量 / 重复声明 / 不可达代码"这类会直接炸服务的规则卡成 error，
// 历史风格问题降级为 warn，逐步收敛。
export default [
  { ignores: ['node_modules/**', 'tmp/**', '**/*.min.js'] },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', TextDecoder: 'readonly',
        fetch: 'readonly', AbortSignal: 'readonly', performance: 'readonly', crypto: 'readonly' } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['warn', { args: 'none' }] },
  },
  {
    files: ['lib/news_preview_renderer.js', 'scripts/preview_news_render.js'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly', DOMParser: 'readonly' } },
  },
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'readonly', exports: 'readonly', __dirname: 'readonly', __filename: 'readonly',
        process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly', queueMicrotask: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', structuredClone: 'readonly',
        performance: 'readonly', crypto: 'readonly', global: 'readonly', globalThis: 'readonly', FormData: 'readonly',
        Blob: 'readonly', File: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
        WebSocket: 'readonly', EventTarget: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
        clearImmediate: 'readonly', queueMicrotaskMicrotask: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'warn',
      'no-useless-catch': 'warn',
      'no-constant-condition': 'warn',
    },
  },
];
