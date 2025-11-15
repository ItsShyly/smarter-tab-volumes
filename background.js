// ^^^ Background service worker for handling extension icon clicks and commands ^^^
// >>> This script is made by SHYLY

// vvv State Management vvv
// >>> Tracks if shift key is held down for toggling mute on icon click
let isShiftPressed = false;

// vvv Icon Management vvv
// >>> Updates extension icon based on tab mute state (on = unmuted, off = muted)
async function updateIconForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const isMuted = tab.mutedInfo?.muted || false;
    
    const iconPath = {
      16: isMuted ? 'off-16.png' : 'on-16.png',
      48: isMuted ? 'off-48.png' : 'on-48.png',
      128: isMuted ? 'off-128.png' : 'on-128.png'
    };
    
    await chrome.action.setIcon({ tabId: tabId, path: iconPath });
  } catch (error) {
    // >>> Tab might have been closed, ignore errors
  }
}

// vvv Message Handler vvv
// >>> Listens for shift key state from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'shift-key-state') {
    isShiftPressed = message.isPressed;
    
    // >>> When shift is pressed, disable popup so icon click can mute instead
    if (message.isPressed) {
      chrome.action.setPopup({ popup: '' });
    } else {
      // >>> delay to make sure shift is really released
      setTimeout(() => {
        if (!isShiftPressed) {
          chrome.action.setPopup({ popup: 'popup.html' });
        }
      }, 200);
    }
  }
});

// vvv Icon Click Handler vvv
// >>> When you click the extension icon while holding shift, it mutes/unmutes the tab
chrome.action.onClicked.addListener(async (tab) => {
  const currentlyMuted = tab.mutedInfo.muted;
  await chrome.tabs.update(tab.id, { muted: !currentlyMuted });
  await updateIconForTab(tab.id);
  
  // >>> Re-enable popup after muting
  setTimeout(() => {
    chrome.action.setPopup({ popup: 'popup.html' });
  }, 200);
});


// vvv Command Handler vvv
// >>> Keyboard shortcut (Ctrl+M) to toggle mute on current tab
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-mute-current-tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentlyMuted = tab.mutedInfo.muted;
    await chrome.tabs.update(tab.id, { muted: !currentlyMuted });
    await updateIconForTab(tab.id);
  }
});

// vvv Tab Removal Handler vvv
// >>> Clean up stored volumes when tabs are closed so we don't waste storage
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.local.get(['tabVolumes']);
  const tabVolumes = result.tabVolumes || {};
  
  if (tabVolumes[tabId] !== undefined) {
    delete tabVolumes[tabId];
    await chrome.storage.local.set({ tabVolumes: tabVolumes });
  }
});

// vvv Extension Installation Handler vvv
// >>> Sets up default storage when extension is first installed
chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    tabVolumes: {},
    websiteVolumes: {}
  };
  
  const existing = await chrome.storage.local.get(Object.keys(defaults));
  const toSet = {};
  
  // >>> Only set defaults if they don't exist yet (so i don't overwrite user data)
  for (const [key, value] of Object.entries(defaults)) {
    if (existing[key] === undefined) {
      toSet[key] = value;
    }
  }
  
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
});

// vvv Extension Startup Handler vvv
// >>> Make sure popup is enabled when browser starts
chrome.runtime.onStartup.addListener(() => {
  chrome.action.setPopup({ popup: 'popup.html' });
});

// vvv Tab Mute State Listener vvv
// >>> Update icon when tab mute state changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.mutedInfo !== undefined) {
    await updateIconForTab(tabId);
  }
});

// vvv Tab Update Listener vvv
// >>> This is the magic that makes volumes apply automatically when pages load
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;  // <<< Wait for page to fully load
  
  // >>> Extract domain from URL for website save state
  let domain;
  try {
    const urlObj = new URL(tab.url);
    domain = urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return;  // <<< Invalid URL, just bail out
  }
  
  // >>> Grab all stored volumes from storage
  const storage = await chrome.storage.local.get(['websiteVolumes', 'tabVolumes']);
  const websiteVolumes = storage.websiteVolumes || {};
  const tabVolumes = storage.tabVolumes || {};
  
  // >>> Figure out what volume to apply (synced > tab-specific > default 100%)
  const pattern = `${domain}/*`;
  const volumeToApply = websiteVolumes[pattern] ?? tabVolumes[tabId] ?? 100;
  
  // >>> Actually apply the volume to the tab
  await applyVolumeToTab(tabId, volumeToApply);
});

// vvv Tab Activation Listener vvv
// >>> Apply volumes when you switch between tabs (same logic as page load)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateIconForTab(activeInfo.tabId);
  const tab = await chrome.tabs.get(activeInfo.tabId);
  
  // >>> Extract domain
  let domain;
  try {
    const urlObj = new URL(tab.url);
    domain = urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return;
  }
  
  // >>> Get stored volumes
  const storage = await chrome.storage.local.get(['websiteVolumes', 'tabVolumes']);
  const websiteVolumes = storage.websiteVolumes || {};
  const tabVolumes = storage.tabVolumes || {};
  
  // >>> Figure out volume (same priority as above)
  const pattern = `${domain}/*`;
  const volumeToApply = websiteVolumes[pattern] ?? tabVolumes[activeInfo.tabId] ?? 100;
  
  // >>> Apply it
  await applyVolumeToTab(activeInfo.tabId, volumeToApply);
});

// vvv Helper Function - Apply volume to a tab vvv
// >>> This is where the actual volume stuff happens - injects code into the page to control audio
async function applyVolumeToTab(tabId, volumePercent) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: true },  // <<< Run in all frames (main page + iframes)
    func: (volumePercent) => {
      // >>> Convert percentage to gain value (100% = 1.0, 200% = 2.0, 50% = 0.5)
      const gainValue = volumePercent / 100;
      
      // >>> Set up global volume controller if it doesn't exist yet
      if (!window.volumeController) {
        window.volumeController = {
          targetGain: gainValue,
          audioContext: null,      // <<< Web Audio API context (created only if needed)
          elements: new Map()      // <<< Track which audio elements we're controlling
        };
      } else {
        window.volumeController.targetGain = gainValue;
      }
      
      // >>> Give each audio/video element a unique ID so we can track it
      function getElementId(element) {
        if (!element._volumeControllerId) {
          element._volumeControllerId = `vc_${Date.now()}_${Math.random()}`;
        }
        return element._volumeControllerId;
      }
      
      // >>> Clean up Web Audio connections when we're done with an element
      function disconnectAudioControl(element) {
        const elemId = getElementId(element);
        const existing = window.volumeController.elements.get(elemId);
        
        if (existing?.gainNode) {
          try {
            existing.source.disconnect();
            existing.gainNode.disconnect();
          } catch (error) {
            // <<< Sometimes elements are already disconnected, that's fine
          }
        }
        
        window.volumeController.elements.delete(elemId);
      }
      
      // >>> Apply volume control to an audio/video element
      function setupAudioControl(element) {
        const elemId = getElementId(element);
        const existing = window.volumeController.elements.get(elemId);
        
        // >>> If volume is 100%, just remove any custom controls and let the website handle it
        if (window.volumeController.targetGain === 1.0) {
          if (existing) {
            disconnectAudioControl(element);
          }
          return;
        }
        
        // >>> If we already have Web Audio set up, just update the gain value
        if (existing?.gainNode) {
          existing.gainNode.gain.value = window.volumeController.targetGain;
          return;
        }
        
        // >>> If using fallback mode, just update the element's volume property
        if (existing?.fallback) {
          element.volume = Math.min(window.volumeController.targetGain, 1.0);
          return;
        }
        
        // >>> Try to set up Web Audio API (needed for volumes over 100%)
        try {
          // >>> Create audio context if we don't have one yet
          if (!window.volumeController.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            window.volumeController.audioContext = new AudioContext();
          }
          
          const ctx = window.volumeController.audioContext;
          
          // >>> Resume context if browser paused it (happens after user interaction)
          if (ctx.state === 'suspended') {
            ctx.resume();
          }
          
          // >>> Create audio graph: source -> gain -> speakers
          const source = ctx.createMediaElementSource(element);
          const gainNode = ctx.createGain();
          gainNode.gain.value = window.volumeController.targetGain;
          
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
          
          window.volumeController.elements.set(elemId, {
            gainNode: gainNode,
            source: source,
            fallback: false
          });
        } catch (error) {
          // >>> Web Audio failed (probably already connected), use fallback
          // >>> This only works up to 100% but it's better than nothing
          element.volume = Math.min(window.volumeController.targetGain, 1.0);
          window.volumeController.elements.set(elemId, { fallback: true });
        }
      }
      
      // >>> Apply volume to all existing audio/video elements on the page
      const mediaElements = document.querySelectorAll('audio, video');
      mediaElements.forEach(element => {
        setupAudioControl(element);
      });
      
      // >>> Watch for new audio/video elements added to the page (streaming sites do this)
      if (!window.volumeController.observer) {
        const observer = new MutationObserver(() => {
          document.querySelectorAll('audio, video').forEach(element => {
            setupAudioControl(element);
          });
        });
        
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
        
        window.volumeController.observer = observer;
      }
    },
    args: [volumePercent]
  });
}
