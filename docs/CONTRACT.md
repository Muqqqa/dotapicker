# Dota Picker Overlay — contratto condiviso

App Electron standalone (JS semplice, niente TypeScript, niente bundler) che suggerisce il miglior pick in draft di Dota 2.
Design di riferimento: https://claude.ai/artifact/J8FsrmsGGY3QdwMrkL49v7 (colonna 480px, scura, accent ambra #e8b04a, font Barlow / Barlow Condensed). Copy in italiano.

## Proprietà dei file (un solo proprietario per file)
- `tactician`   -> `src/engine/**`
- `app-dev`     -> `package.json`, `main.js`, `preload.js`, `src/main/**`, `src/ocr/**`
- `ui-designer` -> `src/renderer/**`
- `tester`      -> `tests/**`
Nessuno modifica file altrui: se serve un cambio, scrivi al proprietario nel proprio status log e prosegui con un mock.

## Requisiti utente
- Schermata iniziale: input Steam ID, salvato su disco (userData) e non richiesto di nuovo. Da Steam ID si ricava il rank (OpenDota `/players/{account_id}`, `rank_tier`).
- Rank lobby = media tra il rank dell'utente e quello degli avversari.
- Ruolo (Pos 1-5) rilevato via OCR dalla scritta di ruolo sotto il riquadro eroe/nick nelle ranked.
- Immagini eroi (non sigle) per alleati, nemici, suggerimenti; piccolo riquadro con l'eroe dell'utente.
- Mostrare cosa manca alla squadra: controllo (disable), iniziazione, danno magico, push, ecc.
- Spiegazione del consiglio (reasons) per ogni pick.
- Overlay sopra il gioco (finestra senza bordi, trasparente, always-on-top), scorciatoia per mostrare/nascondere (default F8).

## API engine (`src/engine/index.js`, CommonJS)
```js
loadData({ rankTier })            // async: scarica/cached OpenDota (heroes, matchups, winrate per rank)
suggest({ allies:[heroId], enemies:[heroId], role:1..5, rankTier:number })
// -> {
//   top: Pick, alternatives: [Pick, Pick],
//   teamNeeds: [{ key, label, level:0..1, note }]   // es. key:'disable', note:'Mancante'
// }
// Pick = { heroId, name, img, score:0..100, winrate:number, counter:number, synergy:number, reasons:[string] }
heroImageUrl(heroId)              // URL CDN Valve (cache locale a cura di app-dev)
```
Se i dati non sono ancora caricati, `suggest` lancia un errore chiaro. Fornire anche `src/engine/sample-data.json` per i test offline.

## Stato verso il renderer (preload espone `window.api`)
```js
api.getState()  // Promise<State>
api.onState(cb) // cb(State) a ogni cambio
api.saveSteamId(id)
api.getSettings() // Promise<{ steamId, rankTier, resolution:'2560x1440', scaleFactor, regionsSource:'preset'|'utente',
                  //                stratz:{ configured:bool, ok:bool|null, error:string|null } }>
api.onSettings(cb) // cb(settings) quando cambiano (salvataggio calibrazione o chiave STRATZ, esito della prova)
api.saveStratzToken(token) // Promise<{ok, error?}>; '' = rimuove; cifrata con safeStorage (rifiutata se non disponibile), mai in chiaro
api.startCalibration() // apre la finestra di calibrazione (anche F10); regioni salvate in userData/regions.json per risoluzione
api.setRole(r) // override manuale del ruolo 1..5
// State = { steamId:string|null, rankTier:number|null, lobbyRankTier:number|null, role:1..5|null,
//           allies:[{heroId,name,img}], enemies:[{heroId,name,img}], myHero:{heroId,name,img}|null,
//           suggestion: <output di suggest>|null, status:'setup'|'waiting'|'draft'|'error', message?:string,
//           matchEstimate: <output di engine.estimateMatch>|null }  // solo a draft completo (5 alleati incl. myHero + 5 nemici), altrimenti null
```
Il renderer deve funzionare anche con `index.html?mock=1` usando `src/renderer/mock.js` (nessuna dipendenza da Electron).

## Test (`tests/`, `node --test`)
Algoritmo con draft di esempio (offline), parsing OCR su testo di esempio, persistenza Steam ID, smoke test dell'avvio.

## Protocollo status (per la schermata live)
Ogni agente mantiene `team-status/<nome>.js`:
```js
window.TEAM_STATUS = window.TEAM_STATUS || {};
window.TEAM_STATUS['<nome>'] = { state:'working|idle|done|blocked', task:'testo breve', progress:0-100, log:['ultime','5','righe'], updated:'ISO' };
```
Aggiornalo all'inizio e alla fine di ogni task e a ogni milestone (sovrascrivi il file intero).
