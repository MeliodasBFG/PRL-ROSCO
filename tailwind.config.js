/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        studio: {
          950: '#020b24',
          900: '#041442',
          800: '#06236e',
          700: '#0a369d',
          600: '#0e4cd1',
          500: '#1d68ff',
          400: '#478eff',
          300: '#7ab3ff',
        },
      },
      fontFamily: {
        display: ['"Montserrat"', '"Inter"', 'system-ui', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'rosco-blue': '0 0 22px rgba(29, 104, 255, 0.85), inset 0 0 12px rgba(255, 255, 255, 0.45)',
        'rosco-green': '0 0 22px rgba(16, 185, 129, 0.9), inset 0 0 12px rgba(255, 255, 255, 0.45)',
        'rosco-red': '0 0 22px rgba(239, 68, 68, 0.9), inset 0 0 12px rgba(255, 255, 255, 0.45)',
        'rosco-amber': '0 0 22px rgba(245, 158, 11, 0.9), inset 0 0 12px rgba(255, 255, 255, 0.45)',
        'studio-glow': '0 0 40px rgba(14, 76, 209, 0.6)',
      },
    },
  },
  plugins: [],
};
