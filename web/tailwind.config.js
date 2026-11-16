// The brand colours come from CSS variables (set from the branding profile at start-up), so the whole interface follows them.
export default { content: ['./index.html', './src/**/*.{ts,tsx}'], theme: { extend: { colors: { brand: { DEFAULT: 'rgb(var(--brand) / <alpha-value>)', dark: 'rgb(var(--brand-dark) / <alpha-value>)', light: 'rgb(var(--brand-light) / <alpha-value>)' } } } }, plugins: [] };
