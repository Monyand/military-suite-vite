const colors = require('tailwindcss/colors');
module.exports = {
  content: ['./index.html', './src/**/*.{html,js,jsx}'],
  darkMode: 'class',
  theme: { extend: {
    fontFamily: {
      sans: ['"Segoe UI Variable Text"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      mono: ['"Cascadia Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace']
    },
    colors: {
      canvas: '#111418',
      surface: '#181c22',
      elevated: '#20262f',
      hairline: '#2b3340',
      'hairline-strong': '#384252',
      accent: { DEFAULT: '#4c8ed9', hover: '#5b9ae0', active: '#2b67ab' },
      gray: colors.slate,
      tactical: colors.slate,
      olive: { 400: '#84965c', 500: '#5c693a', 600: '#4b5320', 700: '#3a4219', 800: '#2c3311', 900: '#1d2309' },
      coyote: { 400: '#c5a365', 500: '#a6824a', 600: '#8c6833' }
    }
  } },
  // Class alternatives are complete literal tokens in the source (not assembled
  // color fragments). Scan native HTML renderers as well as JSX components.
  safelist: []
};
