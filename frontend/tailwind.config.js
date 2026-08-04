/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // RDS brand — royal blue.
        brand: {
          50: '#eef3fc',
          100: '#d9e3f7',
          200: '#b6c8ee',
          300: '#89a4e0',
          400: '#5578cc',
          500: '#3157b4',
          600: '#234c9c', // primary brand color
          700: '#1e3f80',
          800: '#1b3568',
          900: '#182d54',
        },
      },
    },
  },
  plugins: [],
};
