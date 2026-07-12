// ESLint flat config (see docs/STANDARDS.md). typescript-eslint `recommended` everywhere;
// type-aware `recommendedTypeChecked` is scoped to `src/**` (the one tree `tsconfig.json`
// covers) — cheap there, project-less elsewhere (tests/e2e, scripts, root *.config.ts).
// `eslint-config-prettier` goes last to turn off any rule that fights Prettier formatting.
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const typeCheckedForSrc = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['src/**/*.ts'],
}));

export default tseslint.config(
  {
    ignores: ['dist/**', 'public/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  ...tseslint.configs.recommended,
  ...typeCheckedForSrc,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Pragmatic first-lint pass (never-linted codebase, behaviour-preserving per plan 013):
      // downgrade a type-aware, style-only rule that fires heavily on an existing pattern instead
      // of rewriting logic. TODO(lint): revisit — tighten to `error` once cleaned up.
      '@typescript-eslint/unbound-method': 'warn', // 51 hits, all `emitter.on(evt, this.fn, this)` —
      // Phaser's 3-arg form binds `this` at registration; the rule can't see that 3rd arg.
    },
  },
  {
    rules: {
      // Same pragmatic posture, but this rule is non-type-aware so it's safe to set globally.
      '@typescript-eslint/no-explicit-any': 'warn', // 23 hits, mostly untyped test-harness plumbing
    },
  },
  prettier,
);
