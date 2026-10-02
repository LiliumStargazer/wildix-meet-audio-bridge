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
├── icons/
│   └── icon128.png     icona dell'estensione e delle notifiche
├── src/
│   ├── background.js   stato Wildix globale e audio delle schede Meet
│   ├── meet.js         microfono di Google Meet
│   ├── wildix.js       rilevamento chiamata dall'interfaccia Wildix
│   └── wildix-rtc.js   rilevamento chiamata dalle connessioni WebRTC di Wildix
└── test/
    └── bridge.test.js  test automatici
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

## 5. Ricaricare Wildix e Google Meet

Dopo l'installazione:

1. ricaricare la pagina Google Meet;
2. chiudere e riaprire Wildix Collaboration oppure ricaricarlo.

Il ricaricamento di Wildix è necessario perché il rilevamento delle chiamate tramite WebRTC deve partire prima della pagina.

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

Se durante la chiamata Wildix l'utente riattiva manualmente il microfono di Meet, l'estensione non lo disattiva di nuovo.

L'estensione clicca il pulsante del microfono una sola volta per ogni cambio di stato. Se Meet non applica il clic, l'estensione non ritenta e mostra una notifica di Chrome che chiede di sistemare il microfono a mano. Su macOS le notifiche di Google Chrome devono essere consentite in Impostazioni di Sistema → Notifiche.

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

Infine ricaricare Wildix. Le schede Google Meet già aperte vengono aggiornate automaticamente.

Non aggiornare l'estensione durante una chiamata Wildix: Chrome cancella lo stato salvato e Meet resterebbe silenziato al termine della chiamata.

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