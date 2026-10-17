# Dota Picker — contratto v2: squadra dal nickname, calibrazione automatica, ban

Estende `docs/CONTRACT.md` (proprietà dei file, protocollo status, copy in italiano, JS semplice CommonJS restano validi).
Bozzetto della nuova calibrazione: https://claude.ai/artifact/G45DTNgdKTeEJZQHCpCorH

## Problemi da risolvere (parole dell'utente, riassunte)
1. La calibrazione mostra 12 riquadri senza senso (Alleato 1-5, Nemico 1-5, Il tuo eroe, Testo del ruolo). Va sostituita.
2. L'app dà per scontato che gli alleati siano a sinistra. Deve capire DA SOLA, a ogni draft, in quale squadra è l'utente in base a dove compare il suo nickname nella barra in alto. Mai una squadra fissa.
3. Il nickname non viene riconosciuto pur avendo lo Steam ID: oggi lo Steam ID serve solo per il rank, il nome non viene mai letto.
4. Un eroe bannato o non disponibile NON deve mai essere proposto. Niente tasto manuale "bannato": il filtro è automatico e, nel dubbio, si scarta.
5. L'overlay (src/renderer) va bene così com'è: non cambiarne l'aspetto.

## Fatti dagli screenshot reali (tests/fixtures/, PNG = copie decodificabili dei .webp)
- `draft-allpick-dire.png` (2000x837, ridimensionato da un ultrawide ~21:9; la risoluzione reale è ignota): barra in alto centrata: 5 slot Radiant a sinistra, timer al centro ("1:10 ALL PICK"), 5 slot Dire a destra. Radiant è SEMPRE a sinistra per tutti i giocatori.
- Ogni slot = riquadro scuro del ritratto (vuoto finché non c'è pick) con sotto una lineetta di colore FISSO per slot: Radiant blu #3375FF, verde acqua #66FFBF, viola #BF00BF, giallo #F3F00B, arancio #FF6B00; Dire rosa #FE86C2, oliva #A1B447, azzurro #65D9F7, verde #008321, marrone #A46900. Sotto la lineetta il nome del giocatore.
- In quel file l'utente è nel primo slot Dire, nome mostrato troncato "Mooq'a#PE…". I bot non mostrano nome. Atteso: slot 5 (indice 0-9), lato 'dire'.
- `allpick-ban-esempio.png`: griglia eroi a 4 blocchi (STRENGTH / AGILITY / INTELLIGENCE / UNIVERSAL); alcuni eroi bannati con una linea rossa diagonale.
- `griglia-ban-reali.png` (1675x891): altra disposizione della griglia (righe lunghe per attributo). Cerchiati in blu: 3 eroi BANNATI = riquadro scurito + linea rossa diagonale dall'angolo basso-sinistro all'alto-destro. Ci sono anche riquadri solo ingrigiti SENZA linea = non disponibili (già scelti). Entrambi vanno esclusi.
- La disposizione della griglia cambia (ordinamento, patch, risoluzione): niente posizioni fisse dei 125 riquadri.
- Tutto deve essere indipendente dalla risoluzione e dalle proporzioni.

## Moduli e interfacce (puri, senza electron, su immagini RGBA {data:Uint8ClampedArray|Buffer, width, height})

`Rect` = `{ x, y, width, height }` (mai `w`/`h`). Nei moduli di src/ocr è in pixel dell'immagine; verso la calibrazione e nelle regioni salvate è in DIP del display principale.

### app-dev — `src/ocr/topbar.js` (nuovo)
```js
findTopBar(rgba) -> { slots:[{ index:0..9, side:'radiant'|'dire', bar:Rect, portrait:Rect, name:Rect, found:bool }], confidence:0..1 } | null
// cerca le 10 lineette colorate nella fascia alta; slot mancanti ricostruiti per simmetria attorno al timer; portrait sopra, name sotto, misure relative alla lineetta.
matchNickname(names:[string|null] x10, personaname) -> { index, score } | null
// fuzzy: tollera troncamento con "…"/"...", maiuscole, errori OCR tipici (0/O, l/I/1, S/5), confronto sul prefisso. Sotto soglia -> null.
sideOf(index) -> 'radiant'|'dire'   // index < 5 -> radiant
```
### app-dev — `src/ocr/heroGrid.js` (nuovo)
```js
findHeroGrid(rgba) -> Rect | null          // area della griglia eroi (pattern dei riquadri e/o intestazioni attributi)
tileStatus(rgba, tileRect) -> 'banned'|'unavailable'|'available'|'unknown'
// banned: pixel rossastri lungo la diagonale basso-sx -> alto-dx; unavailable: luminanza/saturazione molto sotto i riquadri vicini.
locateHero(rgba, gridRect, template) -> { rect, score } | null   // confronto in scala di grigi, ignorando la banda diagonale
```
### app-dev — main/controller
- `src/main/opendota.js`: `fetchProfile(steamId) -> { rankTier, personaname }` (OpenDota /players/{id}: `rank_tier`, `profile.personaname`). Salvare `personaname` nello store; aggiornarlo se cambia.
- Regioni salvate per risoluzione: `{ topBar:Rect, grid:Rect, manualSlot?:0..9 }` (le vecchie 12 regioni vanno migrate o ignorate). roleText si ricava dal preset come oggi.
- Controller a ogni tick: findTopBar -> OCR dei nomi -> matchNickname -> lato e slot (fallback: manualSlot salvato) -> alleati = ritratti del proprio lato, nemici = dell'altro, myHero = ritratto del proprio slot.
- Filtro ban: `excluded` = bannati ∪ non disponibili ∪ incerti. Ciclo: suggest({..., excluded}) -> controlla nella griglia top + alternative -> se uno è bannato/non disponibile/non trovato con sicurezza lo aggiunge a excluded e ripete (max 5 giri). Solo dopo pubblica la suggestion. Bannati ricordati per tutta la draft (reset quando la barra si svuota).
- State aggiunge: `nickname:string|null, mySide:'radiant'|'dire'|null, mySlot:0..9|null, excluded:[heroId]`.
- IPC per la calibrazione (preload della finestra di calibrazione, da concordare con ui-designer):
  `calApi.autoDetect() -> { topBar, slots, grid, nickname, ocrNames, mySlot, side, notes:[string] }`, `calApi.save({ topBar, grid, manualSlot })`, `calApi.cancel()`.

### tactician — `src/engine/**`
- `suggest({ allies, enemies, role, rankTier, excluded:[heroId] })`: un eroe in `excluded` non compare MAI in top né in alternatives né in nessun output. Test in selfcheck.

### ui-designer — `src/calibrate/**`
- Nuova calibrazione come nel bozzetto: pannello centrale con 3 passi (Barra eroi trovata, Nickname trovato, Squadra dedotta dal nickname), cornice unica della barra, evidenza blu del proprio slot "Sei tu", secondo quadrante "Griglia eroi". Se il nick non è trovato: pulsanti R1..R5 / D1..D5 per indicare lo slot (salvato come manualSlot). Pulsanti: Conferma, Rileva di nuovo, Sposta la barra a mano (trascinamento dei soli 2 rettangoli). Niente più 12 riquadri. Stile: scuro, ambra #e8b04a, Barlow; accessibile (button veri, focus visibile, target >= 44px).

### tester — `tests/**`, `tools/vision-bench/**`
- Banco prova della lettura schermo: `node tools/vision-bench/server.js` su http://localhost:5175. Carichi uno screenshot (trascina o scegli una fixture), inserisci il nickname, vedi disegnati sopra: 10 slot trovati, nomi letti, slot dell'utente, lato, griglia, stato dei riquadri (bannato/non disponibile/disponibile) con colori diversi. Usa i moduli veri di src/ocr (ricarica a caldo come tools/playground).
- Test su fixture (decodifica PNG con zlib, senza nuove dipendenze): draft-allpick-dire -> lato 'dire', slot 5; i 3 eroi cerchiati di griglia-ban-reali -> 'banned'; nessun eroe escluso compare nei consigli; matchNickname con nomi troncati e errori OCR.
- `npm test` deve restare verde (oggi: 75 test, 0 falliti).
