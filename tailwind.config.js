/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Geist Sans', 'Inter', 'system-ui', 'sans-serif'],
        technical: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        bg: {
          primary: '#0a0a0f',
          secondary: '#12121a',
          tertiary: '#1a1a25',
          elevated: '#22222e',
          overlay: 'rgba(10, 10, 15, 0.85)',
        },
        border: {
          primary: '#2a2a3a',
          secondary: '#1e1e2a',
          hover: '#3a3a4e',
          focus: '#6366f1',
        },
        control: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          active: '#4f46e5',
          muted: 'rgba(99, 102, 241, 0.15)',
          text: '#c7d2fe',
        },
        github: {
          DEFAULT: '#8b949e',
          bg: '#161b22',
          border: '#30363d',
          accent: '#58a6ff',
          muted: 'rgba(139, 148, 158, 0.15)',
        },
        git: {
          DEFAULT: '#f97316',
          bg: '#1a120a',
          border: '#6b3a1f',
          accent: '#fb923c',
          muted: 'rgba(249, 115, 22, 0.15)',
        },
        claude: {
          DEFAULT: '#a78bfa',
          bg: '#1a1225',
          border: '#4c3575',
          accent: '#c4b5fd',
          muted: 'rgba(167, 139, 250, 0.15)',
        },
        state: {
          running: '#22d3ee',
          success: '#34d399',
          error: '#f87171',
          warning: '#fbbf24',
          idle: '#64748b',
          scheduled: '#818cf8',
        },
        text: {
          primary: '#f1f5f9',
          secondary: '#94a3b8',
          tertiary: '#64748b',
          inverse: '#0f172a',
          link: '#818cf8',
        },
      },
      boxShadow: {
        glow: '0 0 15px rgba(99, 102, 241, 0.15)',
        'glow-lg': '0 0 30px rgba(99, 102, 241, 0.2)',
        'node': '0 4px 12px rgba(0, 0, 0, 0.4)',
        'node-selected': '0 4px 20px rgba(99, 102, 241, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
