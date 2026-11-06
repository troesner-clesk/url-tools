// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  nitro: {
    // Built into Node 22.13+; tell the bundler instead of letting it guess.
    rollupConfig: { external: ['node:sqlite'] },
  },
  app: {
    head: {
      script: [
        {
          innerHTML: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
          type: 'text/javascript',
        },
      ],
    },
  },
})
