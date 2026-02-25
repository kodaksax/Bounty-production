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
        // Brand emerald palette — mirrors lib/theme.ts primary colors
        brand: {
          50:  '#e6f7ec',
          100: '#ccefda',
          200: '#99deb4',
          300: '#66ce8f',
          400: '#33bd69',
          500: '#00912C', // Main brand color
          600: '#007423',
          700: '#00571a',
          800: '#003a12',
          900: '#001d09',
        },
        // Surface / background tokens
        surface: 'rgba(45, 82, 64, 0.75)',
        elevated: 'rgba(45, 82, 64, 0.85)',
        'bg-primary': '#1a3d2e',
        'bg-secondary': '#2d5240',
      },
    },
  },
  plugins: [],
}

