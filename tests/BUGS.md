# Bug / segnalazioni (tester)

Nessun bug bloccante aperto. Aperto: B1 (bassa priorità). Note: B2, B3, B7, B9. Chiusi: B4, B5, B6, B8.

## B1 - parseRole non tollera confusioni di caratteri OCR (bassa priorita', owner: app-dev, src/ocr/parseRole.js)
- Passi: `parseRole('P0s 2')`, `parseRole('Pos l')`, `parseRole('Pos I')`, `parseRole('Pos S')`.
- Atteso: 2, 1, 1, 5 (0->O, l/I->1, S->5 sono errori tipici di Tesseract).
- Ottenuto: `null` in tutti i casi.
- Test marcati `todo` (non bloccanti) in tests/ocr.test.js.

## B2 - `node --test tests/` non funziona su Node 24 (nota, non bug del codice)
- Su Node 24 la directory passata a `--test` e' trattata come modulo. Usare `npm test` (o `node --test`) .

## B3 - Verifica visiva non eseguita (nota)
- Il renderer mock carica senza errori e popola il DOM (11 immagini, 0 rotte al momento del check), ma non e' stato fatto confronto visivo con il design di riferimento ne' test dell'OCR su screenshot reali di Dota (regioni OCR di default da calibrare, come dichiarato da app-dev).

## B4 - findHeroGrid/findTiles perdeva meta' della griglia su allpick-ban-esempio (CHIUSO, owner: app-dev, src/ocr/heroGrid.js)
- Passi: `findTiles(decodePNG('tests/fixtures/allpick-ban-esempio.png'))`.
- Visto nella prima versione: griglia {x:476,y:162,w:778,h:381}, 87 riquadri su 127: mancavano le colonne FOR 0-2, parte di INT e tutto UNI. Quegli eroi sarebbero risultati "non trovati" e quindi esclusi.
- Corretto da app-dev nella stessa sessione: ora 127 riquadri, griglia {x:356,y:160,w:902,h:387}. Coperto da tests/heroGrid.test.js ("copre i 4 blocchi", "numero di riquadri").

## B5 - Riquadro normale letto come 'unknown' (falso escluso) (CHIUSO, owner: app-dev, src/ocr/heroGrid.js)
- Passi: su allpick-ban-esempio.png, `tileStatus(img, {x:974,y:420,width:35,height:62})` (Skywrath Mage, INT riga 5 col 4).
- Atteso: 'available' (nessuna linea rossa, riquadro non scurito).
- Ottenuto: 'unknown' (detail: mean 115, sd 43, sat 27, line 0.48): le ali dorate in diagonale alzano banLineScore. Il controller lo esclude "nel dubbio", quindi l'eroe sparisce dai consigli senza motivo.
- Corretto da app-dev: banLineScore conta solo il rosso vero (R - max(G,B)) e vuole la linea su tutti e tre i terzi del riquadro. Ora Skywrath -> 'available'; il test "4 bannati, nessun falso escluso" in tests/heroGrid.test.js non e' piu' todo e passa.

## B6 - OCR dei nomi (nota, CHIUSO)
- All'inizio mancava node_modules (tesseract.js non installato); durante la sessione e' stato installato.
- Il banco usa src/ocr/nameOcr.js (NameOcr, eng+ita) con i dati lingua in tools/vision-bench/.cache (scaricati al primo uso).
- Verificato: su draft-allpick-dire l'OCR legge "Mooq'a#PE..." nello slot D1 e nulla negli slot dei bot (~0,4 s per 10 slot).
  Test "catena reale" in tests/topbar.test.js (si salta da solo se tesseract o i dati lingua mancano: niente rete nei test).
- Rumore innocuo nel log: tesseract stampa "failed to load ./ita.special-words".

## B7 - Formato Rect non fissato nel contratto (nota, owner: lead / CONTRACT-v2)
- app-dev usa `{x,y,width,height}` (come Electron); il contratto scrive solo "Rect". I test accettano entrambe le forme ({w,h} e {width,height}); controller e calibrazione (ui-designer) devono usare `width/height`.

## B8 - topbar: ritratto e nome sbagliati con la lineetta SOPRA il ritratto (STRATEGY TIME) (CHIUSO, owner: app-dev, src/ocr/topbar.js)
- Passi: `findTopBar(decodePNG('tests/fixtures/strategy-time-dire.png'))` (anche nel banco, fixture strategy-time-dire.png).
- Atteso: ritratto subito sotto la lineetta (y≈5, altezza ≈52, larghezza ≈88) e nome sotto il ritratto (y≈64-78; slot 5 "Mooq'a#PE…" centro 1140,71).
- Ottenuto: 10/10 lineette ma `portrait` {y:0, height:1} per tutti gli slot; `name` a y=7 (sopra il testo).
- Test `todo` in tests/topbar.test.js ("strategy-time-dire: ..."); forzabili con STRATEGY_STRICT=1. Da riattivare quando app-dev corregge.
- Corretto da app-dev: layout 'strategy'|'pick', ritratto sotto la lineetta, nome sotto il ritratto; test strategy-time-dire attivi (non piu' todo).

## B9 - smoke Electron a volte rosso quando altri agenti usano Electron/la stessa userData (nota, owner: tester)
- Visto 2 volte su 6 in `npm test` mentre altri agenti avviavano l'app; da solo e nelle ultime 3 esecuzioni passa. Non riproducibile a comando: probabile conflitto di istanza singola/userData con un Electron gia' aperto.
