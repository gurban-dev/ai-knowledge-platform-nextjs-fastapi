import baseConfig from '@akp/eslint-config';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'vitest.config.ts',
          ],
        },
      },
    },
  },
  {
    files: [
      '**/*.config.js',
      '**/*.config.ts',
      '**/eslint.config.js',
      '**/vitest.config.ts',
    ],
    rules: {
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },
];