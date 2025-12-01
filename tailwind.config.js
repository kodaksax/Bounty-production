/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand colors to replace emerald
        // Background: #008e2a, Foreground: #ffffff
        // Accent 1: #d5ecdc, Accent 2: #aad9b8, Accent 3: #80c795
        brand: {
          50: '#f0faf3',
          100: '#d5ecdc', // Accent 1 - lightest
          200: '#aad9b8', // Accent 2 - medium
          300: '#80c795', // Accent 3 - darker accent
          400: '#4ab06a',
          500: '#008e2a', // Main brand - Background
          600: '#007523',
          700: '#005c1c',
          800: '#004315',
          900: '#002a0e',
          950: '#001507',
        },
        // Override emerald with brand colors for backward compatibility
        emerald: {
          50: '#f0faf3',
          100: '#d5ecdc', // Accent 1
          200: '#aad9b8', // Accent 2
          300: '#80c795', // Accent 3
          400: '#4ab06a',
          500: '#008e2a', // Background
          600: '#007523',
          700: '#005c1c',
          800: '#004315',
          900: '#002a0e',
          950: '#001507',
        },
      },
    },
  },
  plugins: [],
}
