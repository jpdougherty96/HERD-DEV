/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        herd: {
          green: "#556B2F",
          dark: "#3c4f21",
          accent: "#c54a2c",
          bg: "#f8f9f6",
          tan: "#e8e4d8",
        },
        /* Restore shadcn/ui color tokens */
        border: "hsl(214, 32%, 91%)",
        input: "hsl(214, 32%, 98%)",
        ring: "hsl(214, 32%, 80%)",
        background: "#ffffff",
        foreground: "#1a1a1a",

        primary: {
          DEFAULT: "#556B2F", // HERD green
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#e8e4d8", // HERD tan
          foreground: "#3c4f21",
        },
        accent: {
          DEFAULT: "#c54a2c", // HERD orange
          foreground: "#ffffff",
        },
        destructive: {
          DEFAULT: "#dc2626",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "#f8f9f6",
          foreground: "#6b7280",
        },
        popover: {
          DEFAULT: "#ffffff",
          foreground: "#3c4f21",
        },
        card: {
          DEFAULT: "#ffffff",
          foreground: "#3c4f21",
        },
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Avenir", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
