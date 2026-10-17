# Bug / segnalazioni (tester)

Nessun bug bloccante aperto. Segnalazioni minori:

## B1 - parseRole non tollera confusioni di caratteri OCR (bassa priorita', owner: app-dev, src/ocr/parseRole.js)
- Passi: `parseRole('P0s 2')`, `parseRole('Pos l')`, `parseRole('Pos I')`, `parseRole('Pos S')`.
- Atteso: 2, 1, 1, 5 (0->O, l/I->1, S->5 sono errori tipici di Tesseract).
- Ottenuto: `null` in tutti i casi.
- Test marcati `todo` (non bloccanti) in tests/ocr.test.js.

## B2 - `node --test tests/` non funziona su Node 24 (nota, non bug del codice)
- Su Node 24 la directory passata a `--test` e' trattata come modulo. Usare `npm test` (o `node --test`) .

## B3 - Verifica visiva non eseguita (nota)
- Il renderer mock carica senza errori e popola il DOM (11 immagini, 0 rotte al momento del check), ma non e' stato fatto confronto visivo con il design di riferimento ne' test dell'OCR su screenshot reali di Dota (regioni OCR di default da calibrare, come dichiarato da app-dev).
