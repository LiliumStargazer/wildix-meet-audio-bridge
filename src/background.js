const VERSION = chrome.runtime.getManifest().version;
const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

const MEET_URL = "https://meet.google.com/*";

// Every state change goes through here. Each step is short (storage and tab
// audio only: the Meet mic is handled by meet.js), so nothing waits for long.
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

// wildixStates: Wildix tab id -> busy. originalTabMuted: Meet tab id -> tab
// audio muted before the call.
const getSessionState = () =>
  chrome.storage.session.get({
    wildixStates: {},
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

// Brings the Meet tabs in line with the Wildix state: tab audio here, the mic
// in meet.js once it receives WILDIX_BUSY.
async function syncMeetTabs() {
  const { wildixStates, originalTabMuted } =
    await getSessionState();

  const busy =
    Object.values(wildixStates).some(Boolean);

  const meetTabs =
    await chrome.tabs.query({ url: MEET_URL });

  if (busy) {
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
      busy
    }).catch(() => {
      // meet.js not loaded yet: it sends MEET_READY when it starts.
    });
  }
}

chrome.runtime.onMessage.addListener(
  (message, sender) => {
    const tabId = sender.tab?.id;

    if (!tabId) {
      return;
    }

    if (message.type === "WILDIX_STATE_CHANGED") {
      enqueueOperation(
        `Wildix tab ${tabId} -> ${message.busy ? "BUSY" : "FREE"}`,
        async () => {
          const { wildixStates } = await getSessionState();

          wildixStates[tabId] = message.busy === true;

          await chrome.storage.session.set({ wildixStates });
          await syncMeetTabs();
        }
      );
    }

    if (message.type === "MEET_READY") {
      enqueueOperation(
        `Meet tab ${tabId} ready`,
        syncMeetTabs
      );
    }
  }
);

chrome.tabs.onRemoved.addListener(tabId => {
  enqueueOperation(`Tab ${tabId} removed`, async () => {
    const { wildixStates, originalTabMuted } =
      await getSessionState();

    delete wildixStates[tabId];
    delete originalTabMuted[tabId];

    await chrome.storage.session.set({ wildixStates, originalTabMuted });
    await syncMeetTabs();
  });
});

// Tabs opened before an install or update keep running scripts that can no
// longer reach the extension: inject fresh ones so no reload is needed.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install" && reason !== "update") {
    return;
  }

  for (const { matches, js, world = "ISOLATED" } of chrome.runtime.getManifest().content_scripts) {
    for (const tab of await chrome.tabs.query({ url: matches })) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: js,
        world
      }).catch(error => {
        console.warn(
          `${PREFIX} Tab ${tab.id}: impossibile iniettare ${js}`,
          error
        );
      });
    }
  }
});

console.log(
  `${PREFIX} Service worker avviato`
);
