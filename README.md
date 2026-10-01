# Wildix Meet Audio Bridge

Estensione Chrome che silenzia automaticamente Google Meet quando Wildix Collaboration sta gestendo una chiamata.

## Funzionamento

Quando Wildix riceve o gestisce una chiamata:

- disattiva il microfono di Google Meet;
- silenzia completamente l'audio della scheda Google Meet.

Quando la chiamata Wildix termina:

- ripristina lo stato precedente del microfono di Meet;
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
└── src/
    ├── background.js
    ├── meet.js
    └── wildix.js
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

## Creazione di una release

Prima di creare il pacchetto assicurarsi che tutte le modifiche siano state salvate su `main`.

Esempio per la versione `0.1.2`:

```bash
git add .
git commit -m "Release v0.1.1"
git push origin main
```

Creare quindi il tag:

```bash
git tag -a v0.1.2 -m "v0.1.2"
git push origin v0.1.2
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
  --prefix=wildix-meet-audio-bridge-v0.1.2/ \
  --output=dist/wildix-meet-audio-bridge-v0.1.2.zip \
  v0.1.2
```

Controllare il contenuto:

```bash
unzip -l dist/wildix-meet-audio-bridge-v0.1.2.zip
```

Il file risultante sarà:

```text
dist/wildix-meet-audio-bridge-v0.1.2.zip
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

Per le versioni distribuite ai colleghi è invece preferibile utilizzare sempre un tag (`v0.1.1`, `v0.1.2`, ecc.).

# Installazione su Google Chrome

## 1. Scaricare il pacchetto

Scaricare:

```text
wildix-meet-audio-bridge-v0.1.2.zip
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
wildix-meet-audio-bridge-v0.1.2/
├── manifest.json
├── README.md
└── src/
```

Non selezionare direttamente la cartella `src`.

## 5. Ricaricare Wildix e Google Meet

Dopo l'installazione:

1. ricaricare la pagina Google Meet;
2. chiudere e riaprire Wildix Collaboration oppure ricaricarlo.

## Test

Con Google Meet inizialmente:

```text
Microfono: ON
Audio:     ON
```

far arrivare una chiamata Wildix.

Durante la chiamata:

```text
Microfono Meet: OFF
Audio Meet:     OFF
```

Quando la chiamata Wildix termina:

```text
Microfono Meet: stato precedente
Audio Meet:     stato precedente
```

Se il microfono Meet era già disattivato prima della telefonata, deve rimanere disattivato anche dopo la fine della chiamata.

# Aggiornamento dell'estensione

Quando viene pubblicata una nuova versione, ad esempio:

```text
v0.1.2
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

Infine ricaricare Wildix e Google Meet.

# Debug

Per controllare il funzionamento dell'estensione:

## Google Meet

Aprire gli strumenti sviluppatore della pagina Meet e controllare la Console.

## Wildix

Aprire gli strumenti sviluppatore della pagina Wildix e controllare la Console.

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