# Occupato dagli eventi del Centralino, tramite WTAPI v1

Fino alla v0.2.1 l'estensione deduceva **Occupato** dalla pagina di Wildix Collaboration (pulsante "Riaggancia" e connessioni WebRTC). Quella deduzione oscillava durante la stessa chiamata e faceva attivare e disattivare Meet di continuo, in tutte le versioni. Abbiamo deciso che **Occupato** viene solo dagli eventi di chiamata del **Centralino** per l'**Interno** (`call_added` / `call_updated` / `call_terminated` del protocollo `urn:wildix:ami`), ricevuti dall'estensione stessa con la libreria WTAPI v1 e con interno e password dell'utente. Il vecchio rilevamento viene eliminato e non resta come riserva: due fonti in disaccordo sono la causa delle oscillazioni.

## Opzioni considerate

- **WTAPI v1 (scelta, per ora)**: è la libreria usata dal collega (`https://{centralino}/public/wtapi.js`). Accede con interno e password e non richiede interventi dell'amministratore. Wildix la dichiara superata, e l'accesso con password alle API è annunciato come deprecato dal Q3 2026: può smettere di funzionare con un aggiornamento del Centralino.
- **WTAPI v2 con OAuth 2.0 (migrazione prevista)**: usa lo stesso protocollo di eventi, ed è supportata da Wildix. L'estensione non conosce la password.
- **Webhook del Centralino**: scartati, perché richiedono un server nostro che inoltri gli eventi a ogni estensione.

## Conseguenze

- Il collegamento al Centralino parte da un'origine `chrome-extension://<id>`. Il Centralino accetta solo le origini autorizzate in **WMS → PBX → Security → CORS**, e il fatto che la v1 funzioni sulla piattaforma del collega non garantisce che funzioni anche dall'estensione. Se il Centralino rifiuta l'estensione, in via provvisoria l'estensione riscrive l'intestazione `Origin` verso l'indirizzo del Centralino. È un aggiramento di un controllo di sicurezza del Centralino, accettato solo fino alla migrazione alla v2, in cui l'origine dell'estensione va autorizzata dall'amministratore.
- Per migrare alla v2, nel Centralino un amministratore deve creare un'applicazione in **WMS → Settings → PBX → Integrations → Applications → OAuth 2.0**:
  - nome: `Wildix Meet Audio Bridge`;
  - Redirect URI: `https://<id-estensione>.chromiumapp.org/`;
  - l'`applicationId` ottenuto va configurato nell'estensione.

  Il login lo fa l'utente sulla pagina Wildix con le sue credenziali di Collaboration. Il permesso scade e va rinnovato periodicamente. Licenza minima: UC-Business o x-bees Standard.

## Fonti ufficiali (WTAPI v2 e API Wildix)

Consultate il 13/10/2026.

- [Documentazione WTAPI v2](https://webapi.wildix.com/v2/doc/): classi `WTAPI`, `TelephonyPlugin`, `TelephonyPlugin.Call` e il tutorial sul plugin di telefonia (eventi `call_added` / `call_updated` / `call_terminated`, stati `ring` / `up` / `hold`).
- [Pacchetto WTAPI v2](https://webapi.wildix.com/v2/wtapi.tar.gz): contiene `dist/wtapi.v2.js`. La copia consigliata da Wildix è quella servita dal Centralino, `https://{centralino}/public/wtapi.v2.js`.
- [WebAPI Admin Documentation](https://wildix.atlassian.net/wiki/spaces/DOC/pages/30281520): creazione dell'applicazione OAuth 2.0 in WMS, `applicationId`, Redirect URI e licenze richieste.
- [WMS API Authentication](https://wildix.atlassian.net/wiki/x/oBPOAQ): metodi di autenticazione alle API e avviso di deprecazione dal Q3 2026.
- [Tipi di token](https://wildix.atlassian.net/wiki/x/B4AfEQ): scadenza dei token OAuth2, S2S e Simple, e fine del Simple Token l'1/5/2027.
- [Domain Whitelist (Allow Origin) Configuration](https://wildix.atlassian.net/wiki/x/dAvOAQ): origini autorizzate in WMS → PBX → Security → CORS.
- [How to set up Webhook integration](https://wildix.atlassian.net/wiki/x/AYCODg) e [Webhooks](https://docs.wildix.com/docs/calls/webhooks): l'alternativa scartata.
- [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen) e [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests): dove far girare la libreria nell'estensione e le richieste verso il Centralino.
