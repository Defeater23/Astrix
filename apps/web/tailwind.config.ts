import type { Config } from 'tailwindcss';

/**
 * Strict monochrome design tokens.
 *
 * `theme.colors` is REPLACED (not extended) so no colored utilities such as
 * `bg-red-500` or `text-green-600` can exist. A unit test (monochrome.test.ts)
 * verifies that every color below is a true gray (R = G = B).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      offwhite: '#f7f7f7',
      black: '#000000',
      charcoal: '#262626',
      gray: {
        50: '#fafafa',
        100: '#f2f2f2',
        200: '#e5e5e5',
        300: '#d4d4d4',
        400: '#a3a3a3',
        500: '#737373',
        600: '#525252',
        700: '#404040',
      },
    },
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
      },
      maxWidth: {
        content: '72rem',
      },
    },
  },
  // Decorative effects are intentionally not part of the design system.
  corePlugins: {
    boxShadow: false,
    dropShadow: false,
    backdropBlur: false,
    blur: false,
    backgroundImage: false,
  },
  plugins: [],
} satisfies Config;
