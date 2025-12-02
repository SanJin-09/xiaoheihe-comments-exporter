chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "XHH_EXPORT_COMMENTS" });
});

let pendingAnalyzerData = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "XHH_OPEN_ANALYZER") {
    pendingAnalyzerData = {
      csv: message.csv || "",
      filename: message.filename || "comments.csv"
    };
    chrome.tabs.create(
      { url: chrome.runtime.getURL("analyzer.html#auto") },
      (tab) => {
        if (!tab || !tab.id) return;
        const tabId = tab.id;
        const handleUpdated = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(handleUpdated);
            if (pendingAnalyzerData) {
              chrome.tabs.sendMessage(tabId, {
                type: "XHH_ANALYZE_DATA",
                csv: pendingAnalyzerData.csv,
                filename: pendingAnalyzerData.filename
              });
              pendingAnalyzerData = null;
            }
          }
        };
        chrome.tabs.onUpdated.addListener(handleUpdated);
      }
    );
    sendResponse({ status: "opening" });
    return true;
  }
  return false;
});
