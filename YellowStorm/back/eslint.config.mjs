import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/interface-name-prefix': 'off',
    },
  },
  {
    // Tests routinely reach into private state with non-null assertions;
    // assertion-style strictness stays enforced on source, not specs.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // F.3 / remediation 4.7: migrated modules must not import Mongoose.
    // Mirrors src/common/testing/no-mongoose-in-migrated-modules.spec.ts
    // (which carries the allowlist of still-Mongo-backed modules).
    files: [
      'src/**/*.ts',
      '!src/**/*.spec.ts',
      '!src/modules/playbook-flow/**',
      '!src/modules/worky/**',
      '!src/modules/knowledge-intelligence/**',
      '!src/modules/classifier/**',
      '!src/modules/evaluation/**',
      '!src/modules/conversation-v2/**',
      '!src/modules/app-runtime/**',
      '!src/modules/integration-events/**',
      '!src/modules/logger/**',
      '!src/modules/database/**',
      '!src/modules/health/**',
      '!src/modules/app-data/**',
      '!src/modules/whatsapp/**',
      '!src/modules/connector/services/connector-playbook-binding-sync.service.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'mongoose', message: 'Module migrated to Postgres — no Mongoose imports (see no-mongoose-in-migrated-modules.spec.ts).' },
            { name: '@nestjs/mongoose', message: 'Module migrated to Postgres — no Mongoose imports (see no-mongoose-in-migrated-modules.spec.ts).' },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
);
