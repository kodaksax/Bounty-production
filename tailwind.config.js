/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "app/index.js",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e6f7ec',
          100: '#ccefda',
          200: '#99deb4',
          300: '#66ce8f',
          400: '#33bd69',
          500: '#00912C', // Main brand color
          600: '#007423',
          700: '#00571a',
          800: '#003a12',
          900: '#001d09',
          950: '#000e04',
        },
        background: {
          primary: '#0a0f0d',
          secondary: '#141e1a',
          surface: 'rgba(20, 40, 32, 0.85)',
          elevated: 'rgba(20, 40, 32, 0.95)',
        },
        text: {
          primary: '#fffef5',
          secondary: 'rgba(255, 254, 245, 0.8)',
          muted: 'rgba(255, 254, 245, 0.6)',
          inverse: '#0a0f0d',
        },
        border: {
          primary: 'rgba(0, 145, 44, 0.4)',
          muted: 'rgba(0, 145, 44, 0.2)',
          strong: 'rgba(0, 145, 44, 0.6)',
        },
        success: '#00912C',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
      },
    },
  },
  plugins: [],
}
