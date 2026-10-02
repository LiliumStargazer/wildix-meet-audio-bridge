(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

  const FREE_DEBOUNCE_MS = 1000;

  const HANGUP_SELECTORS = [
    '[role="dialog"] button[title="Riaggancia"]',
    '[role="dialog"] button[title="Hang up"]'
  ];

  let previousBusyState = null;
  let freeTimer = null;
  // Reported by wildix-rtc.js: a call is connected even if the UI changed.
  let rtcConnected = false;

  function isWildixBusy() {
    return rtcConnected || HANGUP_SELECTORS.some(selector =>
      document.querySelector(selector)
    );
  }

  function emitState(busy) {
    if (busy === previousBusyState) {
      return;
    }

    previousBusyState = busy;

    console.log(
      `${PREFIX} Wildix ${busy ? "OCCUPATO" : "LIBERO"}`
    );

    chrome.runtime.sendMessage({
      type: "WILDIX_STATE_CHANGED",
      busy
    }).catch(error => {
      console.warn(
        `${PREFIX} Impossibile notificare lo stato Wildix`,
        error
      );
    });
  }

  function cancelPendingFree() {
    if (freeTimer !== null) {
      clearTimeout(freeTimer);
      freeTimer = null;
    }
  }

  function checkWildixState() {
    if (isWildixBusy()) {
      cancelPendingFree();
      emitState(true);
      return;
    }

    if (previousBusyState === false || freeTimer !== null) {
      return;
    }

    freeTimer = setTimeout(() => {
      freeTimer = null;

      if (!isWildixBusy()) {
        emitState(false);
      }
    }, FREE_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(
    checkWildixState
  );

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["title", "aria-label"]
  });

  window.addEventListener("wildix-meet-bridge:rtc", event => {
    if (rtcConnected !== (event.detail === true)) {
      rtcConnected = event.detail === true;

      console.log(
        `${PREFIX} Chiamata WebRTC ${rtcConnected ? "connessa" : "chiusa"}`
      );
    }

    checkWildixState();
  });

  window.dispatchEvent(
    new CustomEvent("wildix-meet-bridge:rtc-query")
  );

  checkWildixState();

  console.log(
    `${PREFIX} Monitor Wildix avviato`
  );
})();