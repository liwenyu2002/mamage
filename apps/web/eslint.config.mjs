import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

// 规则原则：先"看得见"，再"卡得住"。
// error 只留会直接导致线上事故的项；历史债用 warn，逐步清零。
export default [
  { linterOptions: { reportUnusedDisableDirectives: 'warn' } },
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'scripts/**', 'src/wechat/vendor/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', fetch: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        FormData: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly', Image: 'readonly',
        Worker: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly', IntersectionObserver: 'readonly',
        CustomEvent: 'readonly', Event: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
        performance: 'readonly', structuredClone: 'readonly', queueMicrotask: 'readonly', matchMedia: 'readonly',
        alert: 'readonly', confirm: 'readonly', prompt: 'readonly', HTMLElement: 'readonly', Element: 'readonly',
        Node: 'readonly', getComputedStyle: 'readonly', crypto: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        CanvasRenderingContext2D: 'readonly', ImageData: 'readonly', Audio: 'readonly', CSS: 'readonly',
        DOMParser: 'readonly', XMLSerializer: 'readonly', DOMException: 'readonly', XMLHttpRequest: 'readonly',
        createImageBitmap: 'readonly', self: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
        process: 'readonly', require: 'readonly', module: 'readonly', __dirname: 'readonly', define: 'readonly',
        globalThis: 'readonly', requestIdleCallback: 'readonly', cancelIdleCallback: 'readonly',
        BarcodeDetector: 'readonly', FaceDetector: 'readonly', SpeechSynthesisUtterance: 'readonly',
        ClipboardItem: 'readonly', ClipboardEvent: 'readonly', MediaRecorder: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks, react },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true,
        varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 纯风格类：先降级为提示，避免淹没真正的问题
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-misleading-character-class': 'warn',
      'no-irregular-whitespace': 'warn',
      'react/no-danger': 'warn',
      // JSX 里用到的标识符算"已使用"，否则会把组件当死变量删掉（踩过）
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react/jsx-no-undef': 'error',
      'react/react-in-jsx-scope': 'off',
      'no-cond-assign': 'error',
      'no-dupe-keys': 'error',
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
