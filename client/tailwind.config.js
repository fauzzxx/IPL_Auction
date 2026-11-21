/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#050814', 900: '#080d1c', 800: '#0d1428', 700: '#131c36', 600: '#1b2646', 500: '#27345c' },
        gold: { DEFAULT: '#f5b942', soft: '#ffd98a', deep: '#c98a12' },
        volt: '#5b8cff',
      },
      fontFamily: { display: ['"Barlow Condensed"', 'sans-serif'], sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: { glow: '0 0 40px -8px rgba(245,185,66,.45)', card: '0 10px 40px -12px rgba(0,0,0,.7)' },
    },
  },
  plugins: [],
};
