/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#f0ddf5",
          1: "#e8d3f0",
          2: "#dfc9ea",
        },
        primary: {
          50: "#eef2ff",
          100: "#e0e7ff",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
        },
        accent: {
          mint: "#c2e8d5",
          "mint-dark": "#a3d4be",
        },
        dark: "#2d2d2d",
        gold: {
          300: "#fde68a",
          400: "#f5d565",
          500: "#ebc94e",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "20px",
        "4xl": "24px",
      },
      borderWidth: {
        '3': '3px',
      },
      boxShadow: {
        brutal: "4px 4px 0px 0px #2d2d2d",
        "brutal-sm": "3px 3px 0px 0px #2d2d2d",
        "brutal-xs": "2px 2px 0px 0px #2d2d2d",
      },
    },
  },
  plugins: [],
};
