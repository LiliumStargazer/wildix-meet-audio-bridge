# Wildix Meet Audio Bridge

Estensione Chrome che silenzia automaticamente Google Meet quando l'Interno è Occupato, secondo gli eventi del Centralino Wildix.

## Funzionamento

Quando il Centralino segnala una Chiamata Wildix in entrata (già dallo squillo) o in uscita:

- chiude il segnale del microfono che Google Meet riceve da Chrome, senza toccare il pulsante microfono di Meet;
- silenzia completamente l'audio della scheda Google Meet.

Quando termina l'ultima Chiamata Wildix, anche se altre erano in attesa:

- riapre il segnale del microfono; il pulsante di Meet resta come l'utente l'ha lasciato, anche se lo ha cambiato durante la chiamata;
- ripristina lo stato precedente dell'audio della scheda Meet.

L'estensione non modifica il microfono o l'audio del sistema operativo e funziona interamente all'interno di Chrome.

Attualmente è configurata per:

- Wildix: `https://automaticmachines.wildixin.com/`
- Google Meet: `https://meet.google.com/`

## Compatibilità

Testata con:

- Google Chrome
- macOS
- Wildix Collaboration
- Google Meet

L'architettura dell'estensione è compatibile anche con Google Chrome su Windows.

## Struttura

```text
wildix-meet-audio-bridge/
├── manifest.json
├── README.md
├── icons/
│   └── icon128.png     icona dell'estensione e delle notifiche
├── src/
│   ├── background.js   stato Occupato/Libero e audio delle schede Meet
│   ├── centralino.js   avvio del collegamento, badge e notifiche
│   ├── centralino-settings.js  validazione delle opzioni
│   ├── offscreen.html  documento che ospita WTAPI
│   ├── offscreen.js    eventi del Centralino e chiamate attive
│   ├── wtapi.js        libreria WTAPI v1 inclusa
│   ├── options.html    pagina di opzioni
│   ├── options.js      salvataggio e stato del collegamento
│   ├── meet-audio.js   controllo del segnale microfono prima degli script di Meet
│   └── meet.js         inoltro dello stato Occupato/Libero alla pagina Meet
└── test/
    ├── bridge.test.js     test audio e stato Occupato/Libero
    └── centralino.test.js test collegamento e opzioni
```

## Sviluppo

Il progetto può essere sviluppato direttamente tramite GitHub Codespaces.

Dopo una modifica:

```bash
git status
git add .
git commit -m "Descrizione modifica"
git push origin main
```

## Collegamento al Centralino

Con Chrome 116 o successivo, aprire **Dettagli → Opzioni estensione** da `chrome://extensions` e salvare Interno, password e indirizzo HTTPS del Centralino. L'indirizzo aziendale è precompilato; scegliendone un altro Chrome chiede il permesso per quel solo indirizzo. Le credenziali sono salvate in `chrome.storage.local`, solo nel profilo Chrome e senza cifratura, e non sono accessibili ai content script.

Le opzioni mostrano **Collegato** o **Scollegato**. Il badge rosso **!** indica che il collegamento manca; le notifiche segnalano solo i cambi di collegamento, non i tentativi falliti ripetuti. Il collegamento parte anche all'avvio di Chrome e all'installazione, senza una scheda Wildix Collaboration aperta, e si riallinea dopo il riavvio del service worker.

Se il collegamento cade, lo stato **Occupato/Libero** resta invariato: Meet non viene riaperto durante una Chiamata Wildix. L'estensione ritenta il collegamento automaticamente dopo 5 secondi e, alla riconnessione, attende l'elenco delle chiamate dal Centralino prima di riallineare Meet, anche quando l'elenco è vuoto.

Gli eventi del Centralino sono l'unica fonte dello stato **Occupato/Libero** che comanda Meet: basta una chiamata attiva, in squillo, risposta o attesa, su qualunque dispositivo dell'Interno. Le chiamate sovrapposte mantengono Meet silenziato fino all'ultima chiusura. Nessuno script dell'estensione gira su Wildix Collaboration: il vecchio rilevamento da pulsanti e WebRTC è stato eliminato.

Per i log di `call_added`, `call_updated` e `call_terminated`, aprire `chrome://extensions`, abilitare Modalità sviluppatore e ispezionare il documento `src/offscreen.html`; i cambi Occupato/Libero e di collegamento compaiono nella console del service worker.

La libreria inclusa in `src/wtapi.js` è **WTAPI v1.0.2**, copia invariata di <https://automaticmachines.wildixin.com/public/wtapi.js>, scaricata il 13/10/2026 (Last-Modified: 22/06/2026). SHA-256: `384cefab95377c936f637450604862f1f6d23ecea07a68396b51a601e38d4da9`. Chrome non carica codice remoto; le risposte HTTP della libreria sono forzate a JSON per evitare valutazione di JavaScript remoto.

WTAPI v1 è deprecata: vedi [ADR 0001](docs/adr/0001-occupato-dagli-eventi-del-centralino.md). Login ed eventi reali dall'estensione, inclusa l'eventuale restrizione sull'origine `chrome-extension://`, vanno verificati con credenziali vere nella #4. La release e l'aggiornamento complessivo di questo README sono previsti nella #7.

## Test automatici

I test eseguono il codice reale dell'estensione su API Chrome simulate e non richiedono dipendenze (Node.js 20 o successivo):

```bash
node --test
```

## Creazione di una release

Prima di creare il pacchetto assicurarsi che tutte le modifiche siano state salvate su `main`.

Esempio per la versione `0.2.1`:

```bash
git add .
git commit -m "Release v0.2.1"
git push origin main
```

Creare quindi il tag:

```bash
git tag -a v0.2.1 -m "v0.2.1"
git push origin v0.2.1
```

## Creazione dello ZIP

Lo ZIP viene creato direttamente nel Codespace.

Creare la directory `dist`:

```bash
mkdir -p dist
```

Creare il pacchetto partendo dal tag:

```bash
git archive \
  --format=zip \
  --prefix=wildix-meet-audio-bridge-v0.2.1/ \
  --output=dist/wildix-meet-audio-bridge-v0.2.1.zip \
  v0.2.1
```

Controllare il contenuto:

```bash
unzip -l dist/wildix-meet-audio-bridge-v0.2.1.zip
```

Il file risultante sarà:

```text
dist/wildix-meet-audio-bridge-v0.2.1.zip
```

È consigliato aggiungere `dist/` al `.gitignore`:

```text
dist/
```

In questo modo i pacchetti generati non vengono salvati nel repository Git.

## Creazione ZIP di test senza tag

Durante lo sviluppo è possibile creare un pacchetto direttamente dallo stato corrente di `main`:

```bash
mkdir -p dist

git archive \
  --format=zip \
  --prefix=wildix-meet-audio-bridge-test/ \
  --output=dist/wildix-meet-audio-bridge-test.zip \
  HEAD
```

Per le versioni distribuite ai colleghi è invece preferibile utilizzare sempre un tag (`v0.2.0`, `v0.2.1`, ecc.).

# Installazione su Google Chrome

## 1. Scaricare il pacchetto

Scaricare:

```text
wildix-meet-audio-bridge-v0.2.1.zip
```

e decomprimerlo in una posizione permanente.

Ad esempio:

### macOS

```text
~/Documents/Wildix Meet Audio Bridge/
```

### Windows

```text
C:\Users\<utente>\Documents\Wildix Meet Audio Bridge\
```

> Non eliminare la cartella dopo l'installazione: Chrome utilizza direttamente i file presenti nella directory.

## 2. Aprire la gestione delle estensioni

In Google Chrome aprire:

```text
chrome://extensions
```

## 3. Abilitare Modalità sviluppatore

Attivare:

```text
Modalità sviluppatore
```

in alto a destra.

## 4. Caricare l'estensione

Cliccare:

```text
Carica estensione non pacchettizzata
```

e selezionare la cartella estratta che contiene:

```text
manifest.json
```

Ad esempio:

```text
wildix-meet-audio-bridge-v0.2.1/
├── manifest.json
├── README.md
└── src/
```

Non selezionare direttamente la cartella `src`.

## 5. Configurare il Centralino e ricaricare Google Meet

Dopo l'installazione:

1. aprire le opzioni dell'estensione, salvare Interno e password e verificare **Collegato**;
2. ricaricare le schede Google Meet già aperte.

Non serve ricaricare o tenere aperta Wildix Collaboration: le Chiamate Wildix arrivano dal Centralino.

## Test

Con Google Meet inizialmente:

```text
Microfono: ON
Audio:     ON
```

far arrivare una chiamata Wildix.

Durante la chiamata:

```text
Segnale microfono verso Meet: silenziato
Pulsante microfono Meet:      invariato
Audio Meet:                  OFF
```

Quando la chiamata Wildix termina:

```text
Segnale microfono verso Meet: aperto
Pulsante microfono Meet:      come lasciato dall'utente
Audio Meet:                  stato precedente
```

Se il microfono Meet era già disattivato prima della telefonata, deve rimanere disattivato anche dopo la fine della chiamata.

Se durante la chiamata Wildix l'utente riattiva manualmente il microfono di Meet, gli altri partecipanti continuano a non sentirlo finché l'Interno è Occupato, anche se l'icona di Meet mostra il microfono acceso.

Il controllo viene inserito prima che Meet chieda il microfono. Dopo l'installazione o l'aggiornamento una notifica chiede di ricaricare le schede Meet già aperte: quelle riunioni non sono coperte fino al ricaricamento. Su macOS le notifiche di Google Chrome devono essere consentite in Impostazioni di Sistema → Notifiche.

# Aggiornamento dell'estensione

Quando viene pubblicata una nuova versione, ad esempio:

```text
v0.2.1
```

scaricare e decomprimere il nuovo ZIP.

È possibile sostituire i file nella cartella già utilizzata dall'estensione.

Successivamente aprire:

```text
chrome://extensions
```

e cliccare sul pulsante:

```text
Ricarica
```

della scheda **Wildix Meet Audio Bridge**.

Infine ricaricare le schede Google Meet già aperte, come richiesto dalla notifica dell'estensione.

Non aggiornare l'estensione durante una chiamata Wildix: Chrome cancella lo stato salvato e Meet resterebbe silenziato al termine della chiamata.

# Debug

Per controllare il funzionamento dell'estensione:

## Google Meet

Aprire gli strumenti sviluppatore della pagina Meet e controllare la Console.

## Centralino

Da `chrome://extensions` ispezionare `src/offscreen.html` per gli eventi di Chiamata Wildix. Non servono gli strumenti sviluppatore di Wildix Collaboration.

## Background dell'estensione

Aprire:

```text
chrome://extensions
```

e, nella scheda **Wildix Meet Audio Bridge**, cliccare sul link relativo al:

```text
service worker
```

per visualizzare la Console di `background.js`.

# Versioni

## v0.2.1

Correzione del microfono Meet che a fine chiamata non si riattivava o che continuava ad attivarsi e disattivarsi.

Modifiche:
- il pulsante del microfono viene cliccato una sola volta per ogni cambio di stato: un clic non applicato da Meet non viene più ripetuto, perché ogni clic in più inverte il microfono;
- notifica di Chrome quando Meet non applica il clic, per sistemare il microfono a mano;
- icona dell'estensione.

## v0.2.0

Nuova struttura dell'estensione per eliminare il comportamento instabile segnalato con la v0.1.3.

Modifiche:
- il background gestisce solo lo stato Wildix e l'audio delle schede Meet; il microfono è gestito interamente dalla pagina Meet;
- il microfono viene portato allo stato richiesto una sola volta per ogni cambio di stato Wildix: un clic è considerato recepito solo quando Meet mostra il nuovo stato, eliminando i doppi clic;
- se l'utente riattiva manualmente il microfono durante la chiamata, l'estensione non lo disattiva di nuovo;
- una chiamata in arrivo non attende più la fine del ripristino della chiamata precedente;
- il microfono Meet viene individuato tramite l'attributo `data-is-muted` e l'icona, indipendentemente dalla lingua di Meet (con le etichette italiane e inglesi come riserva);
- la chiamata Wildix viene rilevata anche dalle connessioni WebRTC del telefono nel browser, oltre che dal pulsante "Riaggancia";
- l'audio di una scheda uscita da Meet durante la chiamata viene comunque ripristinato;
- dopo un aggiornamento gli script vengono reiniettati nelle schede già aperte;
- test automatici con `node --test`.

## v0.1.3

Correzione del ripristino dello stato di Google Meet al termine della chiamata Wildix.

Modifiche:

- lo stato salvato di Meet non viene piu cancellato finche microfono e audio non risultano realmente ripristinati;
- retry multipli del ripristino al termine della chiamata;
- selezione del pulsante microfono limitata ai controlli visibili e abilitati;
- supporto a etichette Meet con testo aggiuntivo tramite selettori per prefisso;
- conservazione dello stato originale del microfono anche attraverso tentativi successivi;
- nuovo tentativo automatico quando Meet viene ricaricato e risulta ancora un restore pendente;
- limite temporale ai retry per evitare un unmute tardivo e inatteso.

## v0.1.2

Versione di robustezza per l'utilizzo con piu utenti.

Modifiche:

- stato Wildix occupato immediato e stato libero con debounce di 1 secondo;
- operazioni mute/unmute serializzate nel service worker per evitare race condition;
- verifica dello stato reale del microfono Meet dopo ogni comando;
- retry automatici sul microfono Meet;
- verifica dello stato reale dell'audio della scheda Meet;
- conservazione dello stato originale di microfono e audio per il ripristino;
- log con numero di versione e conferma delle singole operazioni.

## v0.1.1

Correzione del controllo del microfono Google Meet per evitare commutazioni ripetute durante una chiamata Wildix.

Modifiche:

- rimosso il MutationObserver che forzava continuamente il mute;
- limitata la ricerca del pulsante microfono ai controlli della propria chiamata Meet;
- mantenuto il ripristino dello stato precedente del microfono e dell'audio.

## v0.1.0

Prima versione funzionante.

Funzioni:

- rilevamento automatico chiamata Wildix;
- rilevamento già durante lo squillo;
- mute automatico del microfono Google Meet;
- mute automatico dell'audio della scheda Google Meet;
- ripristino dello stato precedente al termine della chiamata;
- compatibilità Chrome/macOS;
- architettura compatibile Chrome/Windows.