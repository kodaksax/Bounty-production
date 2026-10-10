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
        // Mirrors lib/themes/colors.ts — #008E2A leads.
        primary: {
          50: '#EDF8F0',
          100: '#DBF0E1',
          200: '#B5E3C2',
          300: '#1FAE49',
          400: '#1FAE49',
          500: '#008E2A', // Main brand color
          600: '#00701F',
          700: '#00571A',
          800: '#00410F',
          900: '#002E0E',
          950: '#001D09',
        },
        background: {
          primary: '#1B1E24',
          secondary: '#22262C',
          surface: '#2A2E35',
          elevated: '#22262C',
        },
        text: {
          primary: '#E6DED1',
          secondary: '#929497',
          muted: '#61656B',
          inverse: '#31363F',
        },
        border: {
          primary: '#454952',
          muted: '#454952',
          strong: '#454952',
        },
        berry: '#B81E8A',
        success: '#008E2A',
        warning: '#C98A3A',
        error: '#C24A42',
        info: '#3E6E92',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        medium: ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold: ['Inter_700Bold'],
        extrabold: ['Inter_800ExtraBold'],
        mono: ['SpaceMono'],
      },
    },
  },
  plugins: [],
}
