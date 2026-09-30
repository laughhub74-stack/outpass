/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bgdark: "#0b0f19",
        navy: {
          DEFAULT: "#1a2b3c",
          light: "#2b3c4d",
          dark: "#0d1620",
        },
        advisor: "#2563eb", // Royal Blue
        warden: "#4f46e5",  // Indigo
        success: "#10b981", // Emerald Green
      },
      fontFamily: {
        sans: ["Inter", "Outfit", "sans-serif"],
      },
    },
  },
  plugins: [],
}
