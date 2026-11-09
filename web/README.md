# Forage web app

Forage for phones and any browser: practice, save words, and settings. It signs in to the same
Supabase account as the extension, so words and progress are the same everywhere. It reuses the
extension's screens and logic (`../extension`); only the Supabase client and the badge differ
(`src/supabase.ts`, `src/badge.ts`).

On a phone, open the site and add it to the home screen. On Android the installed app then
appears in the Share menu: share selected text to Forage, tap the word, and save.

```sh
npm install        # uses legacy-peer-deps (.npmrc) to get around an npm bug
npm run dev        # http://localhost:5173, also on your network
npm test
npm run build      # static site in dist/
```

The Supabase URL and anon key come from `../extension/.env` (`WXT_SUPABASE_URL`,
`WXT_SUPABASE_ANON_KEY`). When deploying, set the same two variables on the host. `dist/` is a
static site with no server routes, so any static host works. It needs HTTPS to install.
