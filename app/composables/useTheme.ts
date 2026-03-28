export function useTheme() {
    const theme = useState<'dark' | 'light'>('theme', () => 'dark')

    function toggleTheme() {
        theme.value = theme.value === 'dark' ? 'light' : 'dark'
        if (import.meta.client) {
            localStorage.setItem('theme', theme.value)
            document.documentElement.setAttribute('data-theme', theme.value)
        }
    }

    function initTheme() {
        if (import.meta.client) {
            const stored = localStorage.getItem('theme')
            if (stored === 'light' || stored === 'dark') {
                theme.value = stored
            } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
                theme.value = 'light'
            }
            document.documentElement.setAttribute('data-theme', theme.value)
        }
    }

    return { theme, toggleTheme, initTheme }
}
