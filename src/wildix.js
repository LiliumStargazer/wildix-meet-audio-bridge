(() => {
  const HANGUP_SELECTORS = [
    '[role="dialog"] button[title="Riaggancia"]',
    '[role="dialog"] button[title="Hang up"]'
  ];

  let previousBusyState = null;

  function isWildixBusy() {
    return HANGUP_SELECTORS.some(selector =>
      document.querySelector(selector)
    );
  }

  function checkWildixState() {
    const busy = isWildixBusy();

    if (busy === previousBusyState) {
      return;
    }

    previousBusyState = busy;

    console.log(
      `[Wildix Meet Audio Bridge] Wildix ${busy ? "OCCUPATO" : "LIBERO"}`
    );

    chrome.runtime.sendMessage({
      type: "WILDIX_STATE_CHANGED",
      busy
    });
  }

  const observer = new MutationObserver(checkWildixState);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["title", "aria-label"]
  });

  checkWildixState();

  console.log("[Wildix Meet Audio Bridge] Monitor Wildix avviato");
})();