# Silenziare Meet senza toccarne i controlli

Il pulsante microfono di Meet è un interruttore. Ogni clic perso o doppio inverte lo stato, e da qui vengono le segnalazioni "il microfono non torna com'era". Abbiamo deciso di non cliccarlo più: l'estensione inserisce un proprio controllo sul segnale del microfono che Meet riceve da Chrome e lo chiude mentre l'**Interno** è **Occupato**. Il pulsante di Meet resta indipendente, quindi a fine chiamata il microfono torna esattamente come l'utente l'ha lasciato, senza salvare né ripristinare nulla.

## Conseguenze

- Durante una **Chiamata Wildix** l'icona di Meet può mostrare il microfono acceso anche se gli altri partecipanti non sentono nulla.
- Il controllo va inserito prima che Meet chieda il microfono. Una riunione già aperta al momento dell'installazione o dell'aggiornamento dell'estensione non è coperta finché la scheda Meet non viene ricaricata, e l'estensione lo segnala con una notifica.
