# Wildix Meet Audio Bridge

Estensione Chrome che silenzia automaticamente Google Meet quando l'Interno è Occupato, secondo gli eventi del Centralino Wildix.

Versione corrente: **v0.3.1**. [Scarica lo ZIP](https://github.com/LiliumStargazer/wildix-meet-audio-bridge/releases/download/v0.3.1/wildix-meet-audio-bridge-v0.3.1.zip).

## Funzionamento

Quando il Centralino segnala una Chiamata Wildix in entrata (già dallo squillo) o in uscita:

- chiude il segnale del microfono che Google Meet riceve da Chrome, senza toccare il pulsante microfono di Meet;
- silenzia completamente l'audio della scheda Google Meet.

Quando termina l'ultima Chiamata Wildix, anche se altre erano in attesa:

- riapre il segnale del microfono; il pulsante di Meet resta come l'utente l'ha lasciato, anche se lo ha cambiato durante la chiamata;
- ripristina lo **Stato precedente** dell'audio della scheda Meet: se era già silenziata, resta silenziata.

L'estensione non modifica il microfono o l'audio del sistema operativo e funziona interamente all'interno di Chrome.

Attualmente è configurata per:

- Centralino aziendale predefinito: `https://automaticmachines.wildixin.com/` (modificabile dalla finestrella)
- Google Meet: `https://meet.google.com/`

## Compatibilità

Richiede **Google Chrome 116 o successivo**, Google Meet e un Centralino Wildix raggiungibile via HTTPS che consenta l'accesso WTAPI v1 con Interno e password.

Testata con Google Chrome su macOS. L'architettura è compatibile anche con Google Chrome su Windows. Non serve installare o tenere aperta Wildix Collaboration.

## Struttura

```text
wildix-meet-audio-bridge/
├── manifest.json
├── README.md
├── icons/
│   ├── icon128.png     icona dell'estensione e delle notifiche
│   └── icon{16,32}-{red,green}.png  varianti per la barra di Chrome
├── src/
│   ├── background.js   stato Occupato/Libero e audio delle schede Meet
│   ├── centralino.js   collegamento, icona rossa/verde, badge e notifiche
│   ├── centralino-settings.js  validazione delle credenziali e dell'indirizzo
│   ├── offscreen.html  documento che ospita WTAPI
│   ├── offscreen.js    eventi del Centralino e chiamate attive
│   ├── wtapi.js        libreria WTAPI v1 inclusa
│   ├── popup.html      finestrella di accesso e configurazione
│   ├── popup.js        salvataggio, riepilogo e stato del collegamento
│   ├── meet-audio.js   controllo del segnale microfono prima degli script di Meet
│   └── meet.js         inoltro dello stato Occupato/Libero alla pagina Meet
└── test/
    ├── bridge.test.js     test audio e stato Occupato/Libero
    ├── centralino.test.js test collegamento, finestrella, icone e notifiche
    └── fake-wtapi.js      Centralino simulato condiviso dai test
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

### Primo accesso e credenziali ricordate

1. Cliccare sull'icona di **Wildix Meet Audio Bridge** nella barra di Chrome; se non è visibile, cercarla nel menu Estensioni (puzzle) e fissarla alla barra. Si apre la **finestrella**, non una pagina Opzioni.
2. Inserire **Interno** e password, le stesse credenziali di Wildix Collaboration. La password è mascherata.
3. L'indirizzo aziendale è già compilato sotto **Impostazioni avanzate**, inizialmente chiuse. Per cambiarlo, usare il solo indirizzo HTTPS del Centralino, senza percorsi o credenziali nell'URL.
4. Premere **Salva e collega** e concedere il permesso per l'indirizzo scelto, se Chrome lo richiede. Dati non validi o permesso negato mostrano un errore senza sovrascrivere la configurazione precedente.
5. Attendere **Collegato**: credenziali salvate o un tentativo avviato non indicano ancora che il collegamento sia riuscito.

Le credenziali restano in `chrome.storage.local`, solo nel profilo Chrome, senza cifratura e non accessibili ai content script; sono inviate solo al Centralino scelto.

Con credenziali salvate, la finestrella mostra Interno, stato corrente e **Modifica credenziali**, senza esporre la password nel riepilogo. La configurazione della vecchia pagina Opzioni viene riutilizzata, compreso un eventuale indirizzo personalizzato. **Modifica credenziali** apre il modulo senza interrompere il collegamento: solo un salvataggio valido applica la nuova configurazione. Non c'è un pulsante Esci.

Si può chiudere e riaprire la finestrella: il collegamento continua in background e non viene riavviato solo per consultare lo stato. Riparte automaticamente anche all'avvio di Chrome, senza reinserire le credenziali, e si riallinea dopo il riavvio del service worker. Wildix Collaboration non deve essere aperta.

### Icona, stato e riconnessione

- **Icona verde / Collegato**: l'estensione è effettivamente collegata al Centralino.
- **Icona rossa / Scollegato**, con badge **!**: il collegamento manca, anche se le credenziali sono presenti o il login è in corso.
- Con credenziali salvate e collegamento assente, la finestrella mostra **Scollegato — riconnessione automatica**, senza chiedere nuovamente la password per una perdita della rete.

**Collegato/Scollegato** è distinto da **Occupato/Libero**: durante una Chiamata Wildix l'icona resta verde se il collegamento è attivo. Lo stato è disponibile anche come testo e si aggiorna mentre la finestrella resta aperta. Il badge e le notifiche seguono i cambi del collegamento, senza una notifica per ogni tentativo fallito o riapertura della finestrella.

Una Chiamata Wildix presente nell'elenco WTAPI produce subito **Occupato**, anche senza un messaggio iniziale delle chiamate. Se il collegamento cade, lo stato **Occupato/Libero** resta invariato: Meet non viene riaperto durante una Chiamata Wildix già rilevata. L'estensione ritenta automaticamente dopo 5 secondi. Per cancellare un Occupato conservato durante lo scollegamento, attende un elenco completo delle chiamate dal Centralino, anche vuoto; nuove chiamate rilevate possono invece produrre subito Occupato. Finché è Scollegato, non può rilevare nuove Chiamate Wildix.

Gli eventi del Centralino sono l'unica fonte dello stato **Occupato/Libero** che comanda Meet: basta una chiamata attiva, in squillo, risposta o attesa, su qualunque dispositivo dell'Interno. Le chiamate sovrapposte mantengono Meet silenziato fino all'ultima chiusura. Nessuno script dell'estensione gira su Wildix Collaboration: il vecchio rilevamento da pulsanti e WebRTC è stato eliminato.

### Requisiti del Centralino e futura migrazione a WTAPI v2

La versione attuale richiede un Interno e una password validi per **WTAPI v1** e il permesso Chrome per l'indirizzo HTTPS del Centralino. Login ed eventi dall'estensione sono stati verificati sul Centralino aziendale nella [#4](https://github.com/LiliumStargazer/wildix-meet-audio-bridge/issues/4), senza bisogno di riscrivere l'intestazione `Origin`. Su un altro Centralino, l'accesso dall'origine `chrome-extension://<id>` va verificato con l'amministratore.

La libreria inclusa in `src/wtapi.js` è **WTAPI v1.0.2**, copia invariata di <https://automaticmachines.wildixin.com/public/wtapi.js>, scaricata il 13/10/2026 (Last-Modified: 22/06/2026). SHA-256: `384cefab95377c936f637450604862f1f6d23ecea07a68396b51a601e38d4da9`. Chrome non carica codice remoto; le risposte HTTP della libreria sono forzate a JSON per evitare valutazione di JavaScript remoto.

**WTAPI v1 è deprecata** e l'accesso con password è annunciato come deprecato dal Q3 2026: un aggiornamento del Centralino può impedirne il funzionamento. La versione attuale non implementa ancora WTAPI v2/OAuth 2.0.

Per la futura migrazione, un amministratore dovrà:

- creare un'applicazione **Wildix Meet Audio Bridge** in **WMS → Settings → PBX → Integrations → Applications → OAuth 2.0**;
- configurare il Redirect URI `https://<id-estensione>.chromiumapp.org/` e fornire l'`applicationId` alla futura implementazione dell'estensione;
- autorizzare l'origine dell'estensione in **WMS → PBX → Security → CORS**;
- verificare la licenza minima **UC-Business o x-bees Standard**.

Il login avverrà sulla pagina Wildix, senza salvare la password nell'estensione; l'autorizzazione OAuth richiederà rinnovi. Decisioni, limiti e fonti ufficiali Wildix sono raccolti nell'[ADR 0001](docs/adr/0001-occupato-dagli-eventi-del-centralino.md). Il controllo del microfono segue l'[ADR 0002](docs/adr/0002-silenziare-meet-senza-toccarne-i-controlli.md).

## Test automatici

I test eseguono il codice reale dell'estensione su API Chrome simulate e non richiedono dipendenze (Node.js 20 o successivo):

```bash
node --test
```

## Creazione di una release e dello ZIP

Prima del rilascio, aggiornare la versione in `manifest.json` e la sezione Versioni di questo README, eseguire i test e committare tutte le modifiche che devono entrare nel pacchetto su `main`. Esempio per la v0.3.1:

```bash
node --test
git add README.md manifest.json
git commit -m "Release v0.3.1"
git push origin main
git tag -a v0.3.1 -m "v0.3.1"
git push origin v0.3.1
```

Creare lo ZIP dal tag, non dai file locali non committati:

```bash
mkdir -p dist
git archive \
  --format=zip \
  --prefix=wildix-meet-audio-bridge-v0.3.1/ \
  --output=dist/wildix-meet-audio-bridge-v0.3.1.zip \
  v0.3.1
unzip -t dist/wildix-meet-audio-bridge-v0.3.1.zip
```

`dist/` è già esclusa da Git. Per pubblicare il pacchetto nella release GitHub, con la CLI `gh` autenticata:

```bash
gh release create v0.3.1 \
  dist/wildix-meet-audio-bridge-v0.3.1.zip \
  --verify-tag --title "v0.3.1" --generate-notes
```

### ZIP di test senza tag

Durante lo sviluppo è possibile creare un pacchetto dal commit corrente:

```bash
mkdir -p dist
git archive \
  --format=zip \
  --prefix=wildix-meet-audio-bridge-test/ \
  --output=dist/wildix-meet-audio-bridge-test.zip \
  HEAD
```

Anche questo comando esclude le modifiche non committate. Per i pacchetti distribuiti ai colleghi usare una release con tag.

# Installazione su Google Chrome

## 1. Scaricare il pacchetto

Scaricare lo ZIP dalla [release v0.3.1](https://github.com/LiliumStargazer/wildix-meet-audio-bridge/releases/tag/v0.3.1):

```text
wildix-meet-audio-bridge-v0.3.1.zip
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
wildix-meet-audio-bridge-v0.3.1/
├── manifest.json
├── README.md
└── src/
```

Non selezionare direttamente la cartella `src`.

## 5. Configurare il Centralino e ricaricare Google Meet

Dopo l'installazione:

1. cliccare sull'icona dell'estensione, inserire Interno e password nella finestrella e premere **Salva e collega**;
2. verificare **Collegato** e l'icona verde;
3. ricaricare le schede Google Meet già aperte, come richiesto dalla notifica.

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

Scaricare e decomprimere lo ZIP della nuova release, per esempio **v0.3.1**.

Sostituire i file nella cartella già utilizzata dall'estensione, senza rimuovere l'estensione da Chrome: in questo modo le credenziali salvate restano nel profilo. La vecchia pagina Opzioni è sostituita dalla finestrella al clic sull'icona.

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

Aprire `chrome://extensions` e abilitare **Modalità sviluppatore**.

- **Centralino**: nella scheda dell'estensione ispezionare il documento `src/offscreen.html` per vedere `call_added`, `call_updated` e `call_terminated`. Non servono gli strumenti sviluppatore di Wildix Collaboration.
- **Background**: cliccare su **service worker** per la console di `src/background.js`, con i cambi Occupato/Libero, Collegato/Scollegato ed eventuali errori su audio delle schede, icone e notifiche.
- **Finestrella**: cliccare sull'icona, poi con il tasto destro nella finestrella scegliere **Ispeziona** per la console di `src/popup.js`.
- **Google Meet**: aprire gli strumenti sviluppatore della pagina e controllare la Console per gli errori del controllo del microfono.

Se una notifica non appare, controllare anche che il sistema operativo consenta le notifiche di Chrome. Non pubblicare password o altri segreti in log e schermate.

# Versioni

## v0.3.1

Correzione del mancato silenziamento di Meet quando WTAPI riceve eventi di chiamata senza un messaggio iniziale `state`.

- Una Chiamata Wildix attiva produce subito Occupato e la chiusura dell'ultima chiamata osservata, partendo da Libero, ripristina Meet.
- Un Occupato conservato durante una perdita del collegamento non viene cancellato da un elenco ancora incompleto alla riconnessione.
- Test di regressione aggiunti; riproduzione verificata anche con la libreria WTAPI inclusa.

Dopo l'aggiornamento ricaricare l'estensione e tutte le schede Meet già aperte, fuori da una Chiamata Wildix.

## v0.3.0

Occupato dagli eventi del Centralino e Meet silenziato senza toccarne i controlli.

Modifiche:
- collegamento WTAPI v1 direttamente dall'estensione, indipendente da Wildix Collaboration;
- segnale del microfono verso Meet silenziato già dallo squillo e audio delle schede ripristinato allo Stato precedente a fine ultima Chiamata Wildix, senza clic sul pulsante microfono;
- finestrella al clic sull'icona, credenziali ricordate, riepilogo e Modifica credenziali, Centralino sotto Impostazioni avanzate;
- icona rossa/verde e testo per Scollegato/Collegato, badge di avviso e notifiche solo ai cambi del collegamento;
- riconnessione automatica, mantenimento di Occupato/Libero offline e riallineamento dopo riconnessione o riavvio del service worker;
- notifica per ricaricare le schede Meet dopo installazione o aggiornamento;
- gestione delle tracce microfono clonate, correzioni dei salvataggi concorrenti delle credenziali e dei percorsi delle immagini di icone e notifiche;
- test automatici e istruzioni di configurazione, debug e rilascio aggiornati.

**Dopo l'aggiornamento ricaricare l'estensione e tutte le schede Meet già aperte. Non aggiornare durante una Chiamata Wildix.**

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