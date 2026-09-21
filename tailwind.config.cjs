const colors = require('tailwindcss/colors');
module.exports = {
  content: ['./index.html', './src/**/*.{html,js,jsx}'],
  darkMode: 'class',
  theme: { extend: {
    fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
    colors: {
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
