(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

  // The mic button is a toggle: clicking again before Meet shows the previous
  // click flips it back, so a click only counts as lost after this long.
  const CLICK_SETTLE_MS = 2000;
  // Stop trying to restore after this long, so a mic found much later is
  // never unmuted unexpectedly.
  const RESTORE_TIMEOUT_MS = 15000;

  let busy = null;
  let originalMicMuted = null;
  let targetMicMuted = null;
  let deadline = Infinity;
  // Mic state when we last clicked, until Meet shows the click or it is lost.
  let clickedFrom = null;
  let clickCount = 0;

  const stateName = muted =>
    muted ? "MUTED" : "UNMUTED";

  function isUsableButton(button) {
    if (
      !button ||
      !button.isConnected ||
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    const style = window.getComputedStyle(button);

    if (
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      return false;
    }

    return button.getClientRects().length > 0;
  }

  function getControlRoots() {
    const roots = Array.from(
      document.querySelectorAll(
        '[role="region"][aria-label*="Controlli di chiamata"],' +
        '[role="region"][aria-label*="Call controls"]'
      )
    );

    return roots.length > 0
      ? roots
      : [document];
  }

  function findButton(selectors, matches = () => true) {
    for (const root of getControlRoots()) {
      for (const selector of selectors) {
        for (const button of root.querySelectorAll(selector)) {
          if (isUsableButton(button) && matches(button)) {
            return button;
          }
        }
      }
    }

    return null;
  }

  // Meet sets data-is-muted on both the mic and the camera button; the icon
  // name (mic / mic_off) tells them apart and, unlike aria-label, is never
  // translated.
  const hasMicIcon = button =>
    Array.from(button.querySelectorAll("i")).some(icon =>
      /^mic(_off)?$/.test(icon.textContent.trim())
    );

  function getMicState() {
    const micButton = findButton(
      ["button[data-is-muted]"],
      hasMicIcon
    );

    if (micButton) {
      return {
        muted: micButton.getAttribute("data-is-muted") === "true",
        button: micButton
      };
    }

    // Fallback if Meet drops data-is-muted: the Italian or English label.
    const muteButton = findButton([
      'button[aria-label^="Disattiva microfono"]',
      'button[aria-label^="Turn off microphone"]'
    ]);

    if (muteButton) {
      return {
        muted: false,
        button: muteButton
      };
    }

    const unmuteButton = findButton([
      'button[aria-label^="Attiva microfono"]',
      'button[aria-label^="Turn on microphone"]'
    ]);

    if (unmuteButton) {
      return {
        muted: true,
        button: unmuteButton
      };
    }

    return null;
  }

  const observer = new MutationObserver(reconcile);

  function stopDriving() {
    targetMicMuted = null;
    observer.disconnect();
  }

  // Drives the mic to `muted` once; afterwards the user is free to change it.
  function driveMicTo(muted, timeoutMs = Infinity) {
    targetMicMuted = muted;
    deadline = Date.now() + timeoutMs;

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "data-is-muted"]
    });

    reconcile();
  }

  function reconcile() {
    // Extension updated or reloaded: a freshly injected copy takes over.
    if (!chrome.runtime?.id) {
      stopDriving();
      return;
    }

    if (targetMicMuted === null) {
      return;
    }

    if (Date.now() > deadline) {
      console.warn(
        `${PREFIX} Ripristino microfono scaduto: lascio lo stato attuale`
      );

      originalMicMuted = null;
      stopDriving();
      return;
    }

    const mic = getMicState();

    if (!mic) {
      return;
    }

    if (clickedFrom !== null) {
      if (mic.muted === clickedFrom) {
        return;
      }

      clickedFrom = null;
    }

    if (busy && originalMicMuted === null) {
      originalMicMuted = mic.muted;

      console.log(
        `${PREFIX} Stato microfono iniziale: ${stateName(originalMicMuted)}`
      );
    }

    if (mic.muted === targetMicMuted) {
      console.log(
        `${PREFIX} Microfono Meet confermato ${stateName(targetMicMuted)}`
      );

      if (!busy) {
        originalMicMuted = null;
      }

      stopDriving();
      return;
    }

    console.log(
      `${PREFIX} Richiedo microfono Meet ${stateName(targetMicMuted)}`
    );

    clickedFrom = mic.muted;
    clickCount += 1;

    const click = clickCount;

    mic.button.click();

    setTimeout(() => {
      if (click === clickCount && clickedFrom !== null) {
        console.warn(
          `${PREFIX} Clic non recepito da Meet, ritento`
        );

        clickedFrom = null;
        reconcile();
      }
    }, CLICK_SETTLE_MS);
  }

  function onWildixBusy(nextBusy) {
    if (nextBusy === busy) {
      return;
    }

    busy = nextBusy;

    if (busy) {
      driveMicTo(true);
    } else if (originalMicMuted !== null) {
      driveMicTo(originalMicMuted, RESTORE_TIMEOUT_MS);
    } else {
      stopDriving();
    }
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "WILDIX_BUSY") {
      onWildixBusy(message.busy === true);
    }
  });

  chrome.runtime.sendMessage({
    type: "MEET_READY"
  }).catch(error => {
    console.warn(
      `${PREFIX} Impossibile notificare MEET_READY`,
      error
    );
  });

  console.log(
    `${PREFIX} Monitor Google Meet avviato`
  );
})();
