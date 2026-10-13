importScripts("centralino.js");

const VERSION = chrome.runtime.getManifest().version;
const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

const MEET_URL = "https://meet.google.com/*";

// Serialize tab audio changes; Meet handles its microphone signal separately.
let operationQueue = Promise.resolve();

function enqueueOperation(label, operation) {
  const result = operationQueue.then(operation);

  operationQueue = result.catch(error => {
    console.error(
      `${PREFIX} Operazione fallita: ${label}`,
      error
    );
  });

  return result;
}

// originalTabMuted: Meet tab id -> tab audio before the Interno became Occupato.
const getSessionState = () =>
  chrome.storage.session.get({
    internoOccupato: false,
    originalTabMuted: {}
  });

async function setTabMuted(tabId, muted) {
  try {
    await chrome.tabs.update(tabId, { muted });

    console.log(
      `${PREFIX} Tab ${tabId}: audio ${muted ? "MUTED" : "UNMUTED"}`
    );
  } catch (error) {
    console.warn(
      `${PREFIX} Tab ${tabId}: impossibile modificare l'audio`,
      error
    );
  }
}

// Tab audio here; the microphone signal follows WILDIX_BUSY in Meet.
async function syncMeetTabs() {
  const { internoOccupato: isOccupato, originalTabMuted } =
    await getSessionState();

  const meetTabs =
    await chrome.tabs.query({ url: MEET_URL });

  if (isOccupato) {
    for (const tab of meetTabs) {
      if (!(tab.id in originalTabMuted)) {
        originalTabMuted[tab.id] =
          Boolean(tab.mutedInfo?.muted);

        await setTabMuted(tab.id, true);
      }
    }
  } else {
    // By saved id, so a tab that left Meet during the call is restored too.
    for (const [tabId, muted] of Object.entries(originalTabMuted)) {
      await setTabMuted(Number(tabId), muted);

      delete originalTabMuted[tabId];
    }
  }

  await chrome.storage.session.set({ originalTabMuted });

  for (const tab of meetTabs) {
    chrome.tabs.sendMessage(tab.id, {
      type: "WILDIX_BUSY",
      busy: isOccupato
    }).catch(() => {
      // meet.js not loaded yet: it sends MEET_READY when it starts.
    });
  }
}

chrome.runtime.onMessage.addListener(
  (message, sender) => {
    if (sender.url === chrome.runtime.getURL("src/offscreen.html") && !sender.tab &&
        message.type === "CENTRALINO_STATE_CHANGED" &&
        typeof message.occupato === "boolean" && Array.isArray(message.calls)) {
      enqueueCentralinoOperation(() => enqueueOperation("Stato del Centralino", async () => {
        const { centralinoConnectionId } = await chrome.storage.session.get("centralinoConnectionId");
        if (!centralinoConnectionId || message.connectionId !== centralinoConnectionId) {
          return;
        }
        const { internoOccupato } = await getSessionState();
        await chrome.storage.session.set({ internoOccupato: message.occupato });
        if (internoOccupato !== message.occupato) {
          console.log(`${PREFIX} Interno ${message.occupato ? "Occupato" : "Libero"}`, message.calls);
        }
        await syncMeetTabs();
      }));
      return;
    }

    const tabId = sender.tab?.id;
    if (tabId && message.type === "MEET_READY") {
      enqueueOperation(
        `Meet tab ${tabId} ready`,
        syncMeetTabs
      );
    }
  }
);

chrome.tabs.onRemoved.addListener(tabId => {
  enqueueOperation(`Tab ${tabId} removed`, async () => {
    const { originalTabMuted } = await getSessionState();
    delete originalTabMuted[tabId];

    await chrome.storage.session.set({ originalTabMuted });
    await syncMeetTabs();
  });
});

// A microphone already acquired by Meet cannot be intercepted retroactively.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install" && reason !== "update") {
    return;
  }

  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Ricarica Google Meet",
    message: "Ricarica le schede Google Meet già aperte per silenziare il microfono durante le chiamate Wildix."
  }).catch(error => {
    console.warn(`${PREFIX} Impossibile mostrare la notifica di ricaricamento Meet`, error);
  });
});

console.log(
  `${PREFIX} Service worker avviato`
);
