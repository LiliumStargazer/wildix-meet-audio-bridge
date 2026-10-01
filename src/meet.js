(() => {
  let originalMicMuted = null;
  let managed = false;

  function getControlsRoot() {
    return (
      document.querySelector(
        '[role="region"][aria-label="Controlli di chiamata"]'
      ) ||
      document.querySelector(
        '[role="region"][aria-label="Call controls"]'
      ) ||
      document
    );
  }

  function getMicState() {
    const controls = getControlsRoot();

    const muteButton =
      controls.querySelector(
        'button[aria-label="Disattiva microfono"]'
      ) ||
      controls.querySelector(
        'button[aria-label="Turn off microphone"]'
      );

    if (muteButton) {
      return {
        muted: false,
        button: muteButton
      };
    }

    const unmuteButton =
      controls.querySelector(
        'button[aria-label="Attiva microfono"]'
      ) ||
      controls.querySelector(
        'button[aria-label="Turn on microphone"]'
      );

    if (unmuteButton) {
      return {
        muted: true,
        button: unmuteButton
      };
    }

    return null;
  }

  function muteMeetMic() {
    const mic = getMicState();

    if (!mic) {
      console.warn(
        "[Wildix Meet Audio Bridge] Pulsante microfono Meet non trovato"
      );

      return {
        ok: false,
        wasMuted: null
      };
    }

    if (!managed) {
      originalMicMuted = mic.muted;
      managed = true;
    }

    if (!mic.muted) {
      console.log(
        "[Wildix Meet Audio Bridge] Disattivo microfono Meet"
      );
      mic.button.click();
    }

    return {
      ok: true,
      wasMuted: originalMicMuted
    };
  }

  function restoreMeetMic(wasMuted) {
    const mic = getMicState();

    if (!mic) {
      console.warn(
        "[Wildix Meet Audio Bridge] Impossibile ripristinare il microfono Meet"
      );

      managed = false;
      originalMicMuted = null;
      return;
    }

    const targetMuted =
      typeof wasMuted === "boolean"
        ? wasMuted
        : originalMicMuted;

    if (targetMuted === false && mic.muted) {
      console.log(
        "[Wildix Meet Audio Bridge] Riattivo microfono Meet"
      );
      mic.button.click();
    }

    if (targetMuted === true && !mic.muted) {
      console.log(
        "[Wildix Meet Audio Bridge] Ripristino microfono Meet mutato"
      );
      mic.button.click();
    }

    managed = false;
    originalMicMuted = null;
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.type === "FORCE_MUTE_MEET") {
        sendResponse(muteMeetMic());
        return;
      }

      if (message.type === "RESTORE_MEET") {
        restoreMeetMic(message.wasMicMuted);
        sendResponse({ ok: true });
      }
    }
  );

  chrome.runtime.sendMessage({
    type: "MEET_READY"
  });

  console.log(
    "[Wildix Meet Audio Bridge] Monitor Google Meet avviato"
  );
})();