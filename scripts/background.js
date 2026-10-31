chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting panel behavior:", error));

chrome.runtime.onInstalled.addListener(async () => {
  console.log("DCE Ticket Automator background service active (v0.6.7.5-beta).");
  
  const dceTabs = await chrome.tabs.query({
    url: [
      "https://*.alteram.co.za/*",
      "https://dcl.crmprod.alteram.co.za/*"
    ]
  });

  for (const tab of dceTabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["scripts/content_script.js"]
      });
    } catch (err) {
      // Ignore tabs where script injection is restricted
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SAVE_STEPS") {
    chrome.storage.local.get(["customMacroPresets", "activePresetKey"], (res) => {
      let presets = res.customMacroPresets || {};
      let activeKey = res.activePresetKey || "Default Workflow";
      
      if (presets[activeKey]) {
        presets[activeKey].steps = request.steps;
      }

      chrome.storage.local.set({
        savedMacroSteps: request.steps,
        customMacroPresets: presets
      }, () => {
        chrome.runtime.sendMessage({ action: "STEPS_UPDATED", steps: request.steps });
      });
    });
  }
});