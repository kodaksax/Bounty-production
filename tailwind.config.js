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
        // Emerald brand colors - comprehensive palette
        emerald: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',  // Primary brand color
          600: '#059669',  // Main app background
          700: '#047857',  // Dark emerald for emphasis
          800: '#065f46',  // Darker emerald
          900: '#064e3b',  // Darkest emerald
          950: '#022c22',  // Ultra dark for overlays
        },
        // Semantic colors for consistent usage
        background: {
          DEFAULT: '#059669',    // emerald-600 - Main app background
          dark: '#022c22',       // emerald-950 - Ultra dark overlays
          card: '#047857',       // emerald-700 - Card backgrounds
          surface: '#065f46',    // emerald-800 - Surface elements
          overlay: 'rgba(2, 44, 34, 0.55)', // emerald-900 with opacity
        },
        text: {
          primary: '#fffef5',    // Off-white for main text
          secondary: '#d1fae5',  // emerald-100 for secondary text
          muted: '#a7f3d0',      // emerald-200 for muted text
          accent: '#6ee7b7',     // emerald-300 for accent text
        },
        border: {
          DEFAULT: '#047857',    // emerald-700
          light: '#6ee7b7',      // emerald-300
          dark: '#022c22',       // emerald-950
        },
        status: {
          error: '#dc2626',      // red-600
          warning: '#f59e0b',    // amber-500
          success: '#10b981',    // emerald-500
          info: '#3b82f6',       // blue-500
        },
      },
      spacing: {
        // Consistent spacing scale
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '24px',
        '2xl': '32px',
        '3xl': '48px',
        '4xl': '64px',
      },
      borderRadius: {
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '24px',
        '2xl': '32px',
        'full': '9999px',
      },
      fontSize: {
        'tiny': ['11px', { lineHeight: '16px' }],
        'xs': ['12px', { lineHeight: '18px' }],
        'sm': ['14px', { lineHeight: '21px' }],
        'base': ['15px', { lineHeight: '22px' }],
        'md': ['16px', { lineHeight: '24px' }],
        'lg': ['18px', { lineHeight: '27px' }],
        'xl': ['20px', { lineHeight: '30px' }],
        '2xl': ['24px', { lineHeight: '36px' }],
      },
      boxShadow: {
        'emerald-sm': '0 1px 2px 0 rgba(5, 150, 105, 0.15)',
        'emerald-md': '0 4px 6px -1px rgba(5, 150, 105, 0.2), 0 2px 4px -1px rgba(5, 150, 105, 0.1)',
        'emerald-lg': '0 10px 15px -3px rgba(5, 150, 105, 0.25), 0 4px 6px -2px rgba(5, 150, 105, 0.15)',
        'emerald-xl': '0 20px 25px -5px rgba(5, 150, 105, 0.3), 0 10px 10px -5px rgba(5, 150, 105, 0.1)',
        'emerald-glow': '0 0 20px rgba(5, 150, 105, 0.4)',
      },
    },
  },
  plugins: [],
}

