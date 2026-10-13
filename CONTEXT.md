# Wildix Meet Audio Bridge

Silenzia Google Meet mentre l'utente è impegnato in una telefonata sul centralino Wildix, e lo riporta allo stato precedente quando la telefonata finisce.

## Linguaggio

**Interno**:
Il numero dell'utente sul centralino Wildix; è anche il nome utente con cui entra in Wildix Collaboration.
_Evitare_: utente, extension, numero

**Chiamata Wildix**:
Una telefonata in cui è coinvolto l'**Interno**: in entrata dal momento in cui squilla, in uscita dal momento in cui viene avviata, fino alla chiusura.
_Evitare_: chiamata, telefonata attiva

**Occupato**:
Stato dell'**Interno** quando ha almeno una **Chiamata Wildix**; altrimenti è **Libero**.
_Evitare_: busy, in chiamata

**Centralino**:
Il PBX Wildix dell'azienda: l'unica fonte di verità su quando l'**Interno** è **Occupato**.
_Evitare_: PBX, Wildix Collaboration (è solo un client del centralino)

**Silenziare Meet**:
Chiudere il segnale del microfono che Meet riceve da Chrome e silenziare l'audio della scheda Meet, senza mai toccare i controlli di Meet; il pulsante microfono di Meet resta come l'utente l'ha lasciato.
_Evitare_: mute, disattivare il microfono di Meet

**Stato precedente**:
L'audio della scheda Meet com'era prima che l'**Interno** diventasse **Occupato**; è lo stato da ripristinare quando torna **Libero**. Il microfono non ha uno stato precedente, perché **Silenziare Meet** non lo cambia.
_Evitare_: stato originale, stato salvato
