if (typeof chrome !== "undefined") {
  chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel?.setPanelBehavior) {
      void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  });
}
