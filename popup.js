// ^^^ Main popup logic for volume control and user interactions ^^^
// >>> This script is made by SHYLY

// vvv DOM Elements vvv
const currentTabSlider = document.getElementById('currentTabSlider');
const currentTabValue = document.getElementById('currentTabValue');
const currentTabSyncBtn = document.getElementById('currentTabSync');
const currentTabMuteBtn = document.getElementById('currentTabMuteBtn');
const otherTabsList = document.getElementById('otherTabsList');
const syncedVolumesList = document.getElementById('syncedVolumesList');
const allControlsHeader = document.getElementById('allControlsHeader');
const allControlsContent = document.getElementById('allControlsContent');

// vvv Helper Functions vvv
// >>> Extract domain from URL
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    // Remove www. prefix and return domain
    return urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

// >>> Get pattern for website (domain + path pattern)
function getWebsitePattern(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '');
    // Use /* for path pattern to match all pages on domain
    return `${domain}/*`;
  } catch (e) {
    return null;
  }
}

// vvv Volume Conversion Functions vvv
// >>> Convert slider value (0-400) directly to volume percentage (0-400%)
function sliderToVolume(sliderValue) {
  // >>> Direct linear mapping: slider value = volume percentage
  return Math.round(sliderValue);
}

// >>> Convert volume percentage (0-400%) to slider value (0-400)
function volumeToSlider(volume) {
  // >>> Direct linear mapping: volume percentage = slider value
  return Math.round(volume);
}

// vvv Mute Toggle Functions vvv
// >>> Toggle mute state for a tab
async function toggleTabMute(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const currentlyMuted = tab.mutedInfo.muted;
  await chrome.tabs.update(tabId, { muted: !currentlyMuted });
  return !currentlyMuted;
}

// >>> Create speaker icon button with mute toggle
function createSpeakerButton(tabId, isMuted = false) {
  const button = document.createElement('button');
  button.className = 'popup__icon-btn';
  button.title = isMuted ? 'Unmute tab' : 'Mute tab';
  if (isMuted) {
    button.classList.add('muted');
  }
  
  // >>> Speaker icon SVG (changes based on mute state)
  const updateIcon = (muted) => {
    if (muted) {
      // Muted speaker icon
      button.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>`;
    } else {
      // Unmuted speaker icon
      button.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>`;
    }
  };
  
  updateIcon(isMuted);
  
  button.addEventListener('click', async () => {
    const newMutedState = await toggleTabMute(tabId);
    updateIcon(newMutedState);
    button.title = newMutedState ? 'Unmute tab' : 'Mute tab';
    if (newMutedState) {
      button.classList.add('muted');
    } else {
      button.classList.remove('muted');
    }
  });
  
  return button;
}

// vvv Volume Application Functions vvv
// >>> Apply volume to a specific tab
async function applyVolumeToTab(tabId, volumePercent) {
  try {
    // >>> Inject and execute volume control script
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: (volumePercent) => {
        // >>> Calculate gain multiplier (100% = 1.0, 200% = 2.0, etc.)
        const gainValue = volumePercent / 100;
        
        // >>> Initialize volume controller if needed
        if (!window.volumeController) {
          window.volumeController = {
          targetGain: gainValue,
          audioContext: null,      // <<< Web Audio API context (created only if needed)
          elements: new Map()      // <<< Track which audio elements we're controlling
          };
        } else {
          window.volumeController.targetGain = gainValue;
        }
        
        // >>> Generate unique ID for element
        function getElementId(element) {
          if (!element._volumeControllerId) {
            element._volumeControllerId = `vc_${Date.now()}_${Math.random()}`;
          }
          return element._volumeControllerId;
        }
        
        // >>> Disconnect and cleanup audio control for an element
        function disconnectAudioControl(element) {
          const elemId = getElementId(element);
          const existing = window.volumeController.elements.get(elemId);
          
          if (existing && existing.gainNode) {
            try {
              // Disconnect the source from the gain node
              existing.source.disconnect();
              existing.gainNode.disconnect();
            } catch (error) {
            }
          }
          
          // Remove from tracking
          window.volumeController.elements.delete(elemId);
        }
        
        // >>> Setup audio control for an element
        function setupAudioControl(element) {
          const elemId = getElementId(element);
          const existing = window.volumeController.elements.get(elemId);
          
          // >>> If gain is 1.0 (100%), disconnect Web Audio and use native controls
          if (window.volumeController.targetGain === 1.0) {
            if (existing && (existing.gainNode || existing.fallback)) {
              disconnectAudioControl(element);
            }
            return;  // <<< Let website control volume naturally
          }
          
          // >>> If already setup with Web Audio, just update gain
          if (existing && existing.gainNode) {
            existing.gainNode.gain.value = window.volumeController.targetGain;
            return;
          }
          
          // >>> If already setup with fallback, update element volume
          if (existing && existing.fallback) {
            element.volume = Math.min(window.volumeController.targetGain, 1.0);
            return;
          }
          
          // >>> Try to setup Web Audio API
          try {
            // >>> Create audio context if needed
            if (!window.volumeController.audioContext) {
              const AudioContext = window.AudioContext || window.webkitAudioContext;
              window.volumeController.audioContext = new AudioContext();
            }
            
            const ctx = window.volumeController.audioContext;
            
            // >>> Resume context if suspended (user interaction requirement)
            if (ctx.state === 'suspended') {
              ctx.resume();
            }
            
            // >>> Create source and gain
            const source = ctx.createMediaElementSource(element);
            const gainNode = ctx.createGain();
            gainNode.gain.value = window.volumeController.targetGain;
            
            // >>> Connect audio graph
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            // >>> Store reference
            window.volumeController.elements.set(elemId, {
              gainNode: gainNode,
              source: source,
              fallback: false
            });
          } catch (error) {
            // >>> Fallback to direct volume control
            element.volume = Math.min(window.volumeController.targetGain, 1.0);
            window.volumeController.elements.set(elemId, {
              fallback: true
            });
          }
        }
        
        // >>> Process all media elements
        const mediaElements = document.querySelectorAll('audio, video');
        mediaElements.forEach(element => {
          setupAudioControl(element);
        });
        
        // >>> Setup observer for new elements (only once)
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
  } catch (error) {
    console.error('Error applying volume:', error);
  }
}

// >>> Get current active tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;                                // <<< Return active tab
}

// >>> Get all tabs with the same domain
async function getTabsWithSameDomain(domain) {
  const allTabs = await chrome.tabs.query({});
  return allTabs.filter(tab => {
    const tabDomain = extractDomain(tab.url);
    return tabDomain === domain;
  });
}

// >>> Get all other tabs (not current)
async function getOtherTabs() {
  const currentTab = await getCurrentTab();
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  return allTabs.filter(tab => tab.id !== currentTab.id);  // <<< Exclude current
}

// vvv Slider Update Functions vvv
// >>> Update current tab volume from slider
async function updateCurrentTabVolume() {
  const sliderValue = parseInt(currentTabSlider.value);
  const volumePercent = sliderToVolume(sliderValue);
  currentTabValue.textContent = `${volumePercent}%`;  // <<< Update display
  
  // Update slider fill
  updateSliderFill(currentTabSlider);
  
  const currentTab = await getCurrentTab();
  const domain = extractDomain(currentTab.url);
  
  // >>> Check if this website has a synced volume
  const isSynced = await VolumeSettings.isWebsiteSynced(domain);
  
  if (isSynced) {
    // >>> Update synced volume and apply to all tabs with same domain
    const pattern = getWebsitePattern(currentTab.url);
    await VolumeSettings.syncWebsiteVolume(pattern, volumePercent);
    
    // >>> Apply to all tabs with same domain
    const sameDomainTabs = await getTabsWithSameDomain(domain);
    for (const tab of sameDomainTabs) {
      await applyVolumeToTab(tab.id, volumePercent);
      // >>> Update tab volumes to match synced volume
      await VolumeSettings.syncTabVolume(tab.id, volumePercent);
    }
    
    // >>> Update synced volumes list
    await renderSyncedVolumes();
  } else {
    // >>> Only apply to current tab
    await applyVolumeToTab(currentTab.id, volumePercent);
    // >>> Sync tab-specific volume
    await VolumeSettings.syncTabVolume(currentTab.id, volumePercent);
  }
}

// >>> Update other tab volume from slider
async function updateOtherTabVolume(tabId, sliderElement, valueElement) {
  const sliderValue = parseInt(sliderElement.value);
  const volumePercent = sliderToVolume(sliderValue);
  valueElement.textContent = `${volumePercent}%`;  // <<< Update display
  
  // Update slider fill
  updateSliderFill(sliderElement);
  
  await applyVolumeToTab(tabId, volumePercent);
  
  // >>> Sync individual tab volume
  await VolumeSettings.syncTabVolume(tabId, volumePercent);
}

// vvv Sync Button Toggle Functions vvv
// >>> Toggle current tab sync button
async function toggleCurrentTabSync() {
  const currentTab = await getCurrentTab();
  const domain = extractDomain(currentTab.url);
  const pattern = getWebsitePattern(currentTab.url);
  
  const isCurrentlySynced = await VolumeSettings.isWebsiteSynced(domain);
  
  if (isCurrentlySynced) {
    // >>> Turn OFF sync - remove website volume
    await VolumeSettings.removeWebsiteVolume(pattern);
    currentTabSyncBtn.setAttribute('data-active', 'false');
    
    // >>> Clear all tab volumes for this domain (they'll get default 100%)
    const sameDomainTabs = await getTabsWithSameDomain(domain);
    for (const tab of sameDomainTabs) {
      await VolumeSettings.removeTabVolume(tab.id);
    }
  } else {
    // >>> Turn ON sync - sync website volume
    const sliderValue = parseInt(currentTabSlider.value);
    const volumePercent = sliderToVolume(sliderValue);
    
    await VolumeSettings.syncWebsiteVolume(pattern, volumePercent);
    currentTabSyncBtn.setAttribute('data-active', 'true');
    
    // >>> Apply to all tabs with same domain
    const sameDomainTabs = await getTabsWithSameDomain(domain);
    for (const tab of sameDomainTabs) {
      await applyVolumeToTab(tab.id, volumePercent);
      await VolumeSettings.syncTabVolume(tab.id, volumePercent);
    }
  }
  
  // >>> Update synced volumes list
  await renderSyncedVolumes();
}

// vvv Other Tabs UI Functions vvv
// >>> Render other tabs list
async function renderOtherTabs() {
  const otherTabs = await getOtherTabs();
  otherTabsList.innerHTML = ''; // <<< Clear existing content
  
  // >>> Create control for each tab
  for (const tab of otherTabs) {
    // >>> Get synced volume for this tab
    const syncedVolume = await VolumeSettings.getTabVolume(tab.id);
    const volumePercent = syncedVolume !== null ? syncedVolume : 100;
    const sliderValue = volumeToSlider(volumePercent);
    
    // >>> Create tab item container
    const tabItem = document.createElement('div');
    tabItem.className = 'popup__tab-item';
    
    // >>> Create tab title
    const tabTitle = document.createElement('div');
    tabTitle.className = 'popup__tab-title';
    tabTitle.textContent = tab.title || 'Untitled Tab';
    tabItem.appendChild(tabTitle);
    
    // >>> Create controls container
    const controls = document.createElement('div');
    controls.className = 'popup__controls';
    
    // >>> Create icon button (favicon or speaker)
    const iconBtn = document.createElement('button');
    iconBtn.className = 'popup__icon-btn';
  iconBtn.title = tab.mutedInfo.muted ? 'Unmute tab' : 'Mute tab';
  
  if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
    // Use favicon if available
    const favicon = document.createElement('img');
    favicon.className = 'popup__tab-favicon';
    favicon.src = tab.favIconUrl;
    favicon.onerror = () => {
      // Fallback to speaker icon if favicon fails to load
      iconBtn.innerHTML = tab.mutedInfo.muted ? 
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>` :
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>`;
    };
    iconBtn.appendChild(favicon);
  } else {
    // Use speaker icon if no favicon
    iconBtn.innerHTML = tab.mutedInfo.muted ? 
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>` :
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>`;
  }
  
  if (tab.mutedInfo.muted) {
    iconBtn.classList.add('muted');
  }
  
  // Add click handler to toggle mute
  iconBtn.addEventListener('click', async () => {
    const newMutedState = await toggleTabMute(tab.id);
    iconBtn.title = newMutedState ? 'Unmute tab' : 'Mute tab';
    
    // Update icon
    if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
      // Keep favicon, just update opacity
      if (newMutedState) {
        iconBtn.classList.add('muted');
      } else {
        iconBtn.classList.remove('muted');
      }
    } else {
      // Update speaker icon
      iconBtn.innerHTML = newMutedState ? 
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>` :
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>`;
      if (newMutedState) {
        iconBtn.classList.add('muted');
      } else {
        iconBtn.classList.remove('muted');
      }
    }
  });
  
  // >>> Create slider container
  const sliderContainer = document.createElement('div');
  sliderContainer.className = 'popup__slider-container';
    
    // >>> Create slider wrapper
    const sliderWrapper = document.createElement('div');
    sliderWrapper.className = 'popup__slider-wrapper';
    
    // >>> Create slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'popup__slider';
    slider.min = '0';
    slider.max = '400';
    slider.step = '1';
    slider.value = sliderValue;
    
    // >>> Create value display
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'popup__value';
    valueDisplay.textContent = `${volumePercent}%`;
    
    updateSliderFill(slider);
    
    slider.addEventListener('input', () => {
      updateOtherTabVolume(tab.id, slider, valueDisplay);
    });
    
    sliderWrapper.appendChild(slider);
    sliderContainer.appendChild(sliderWrapper);
    sliderContainer.appendChild(valueDisplay);
    controls.appendChild(iconBtn);
    controls.appendChild(sliderContainer);
    tabItem.appendChild(controls);
    otherTabsList.appendChild(tabItem);
    
    await applyVolumeToTab(tab.id, volumePercent);
  }
  
  // >>> Show message if no other tabs
  if (otherTabs.length === 0) {
    const noTabsMsg = document.createElement('div');
    noTabsMsg.className = 'popup__hint';
    noTabsMsg.textContent = 'No other tabs in this window';
    noTabsMsg.style.textAlign = 'center';
    noTabsMsg.style.padding = '8px';
    otherTabsList.appendChild(noTabsMsg);
  }
}

// vvv Synced Volumes UI Functions vvv
// >>> Render synced volumes list
async function renderSyncedVolumes() {
  const websiteVolumes = await VolumeSettings.getAllWebsiteVolumes();
  syncedVolumesList.innerHTML = ''; // <<< Clear existing content
  
  const entries = Object.entries(websiteVolumes);
  
  if (entries.length === 0) {
    // >>> Show message if no synced websites
    const noSyncedMsg = document.createElement('div');
    noSyncedMsg.className = 'popup__hint';
    noSyncedMsg.textContent = 'No synced websites';
    noSyncedMsg.style.textAlign = 'center';
    noSyncedMsg.style.padding = '8px';
    syncedVolumesList.appendChild(noSyncedMsg);
    return;
  }
  
  // >>> Create item for each synced website
  for (const [pattern, volume] of entries) {
    const item = document.createElement('div');
    item.className = 'popup__synced-item';
    
    // >>> Create header container for pattern and delete button
    const header = document.createElement('div');
    header.className = 'popup__synced-header';
    
    // >>> Create pattern display
    const patternText = document.createElement('div');
    patternText.className = 'popup__synced-pattern';
    patternText.textContent = pattern;
    
    // >>> Create controls container
    const controls = document.createElement('div');
    controls.className = 'popup__controls';
    
    // >>> Get domain and create speaker button
    const domain = pattern.split('/')[0];
    const domainTabs = await getTabsWithSameDomain(domain);
    const firstTab = domainTabs.length > 0 ? domainTabs[0] : null;
    const isMuted = firstTab ? firstTab.mutedInfo.muted : false;
  
  const speakerBtn = createSpeakerButton(firstTab ? firstTab.id : -1, isMuted);
  
  // Update speaker button click to mute/unmute all tabs with this domain
  speakerBtn.onclick = async () => {
    const tabs = await getTabsWithSameDomain(domain);
    if (tabs.length > 0) {
      const firstTabState = tabs[0].mutedInfo.muted;
      const newMutedState = !firstTabState;
      
      // Toggle all tabs with this domain
      for (const tab of tabs) {
        await chrome.tabs.update(tab.id, { muted: newMutedState });
      }
      
      // Update button appearance
      speakerBtn.title = newMutedState ? 'Unmute tabs' : 'Mute tabs';
      speakerBtn.innerHTML = newMutedState ? 
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>` :
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>`;
      if (newMutedState) {
        speakerBtn.classList.add('muted');
      } else {
        speakerBtn.classList.remove('muted');
      }
    }
  };
  
  // >>> Create slider container
  const sliderContainer = document.createElement('div');
  sliderContainer.className = 'popup__slider-container';
  
  // >>> Create slider wrapper
    const sliderWrapper = document.createElement('div');
    sliderWrapper.className = 'popup__slider-wrapper';
    
    // >>> Create slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'popup__slider';
    slider.min = '0';
    slider.max = '400';
    slider.step = '1';
    slider.value = volumeToSlider(volume);
    
    // >>> Create volume display
    const volumeText = document.createElement('span');
    volumeText.className = 'popup__value';
    volumeText.textContent = `${volume}%`;
    
    // >>> Initialize slider fill
    updateSliderFill(slider);
    
    // >>> Add slider input handler
    slider.addEventListener('input', async () => {
      const sliderValue = parseInt(slider.value);
      const volumePercent = sliderToVolume(sliderValue);
      volumeText.textContent = `${volumePercent}%`;
      
      // Update slider fill
      updateSliderFill(slider);
      
      // >>> Update synced website volume
      await VolumeSettings.syncWebsiteVolume(pattern, volumePercent);
      
      // >>> Get domain from pattern
      const domain = pattern.split('/')[0];
      
      // >>> Apply to all tabs with same domain
      const sameDomainTabs = await getTabsWithSameDomain(domain);
      for (const tab of sameDomainTabs) {
        await applyVolumeToTab(tab.id, volumePercent);
        await VolumeSettings.syncTabVolume(tab.id, volumePercent);
      }
      
      // >>> Update current tab slider if on this domain
      const currentTab = await getCurrentTab();
      const currentDomain = extractDomain(currentTab.url);
      if (currentDomain === domain) {
        currentTabSlider.value = volumeToSlider(volumePercent);
        currentTabValue.textContent = `${volumePercent}%`;
        updateSliderFill(currentTabSlider);
      }
    });
    
    sliderWrapper.appendChild(slider);
    sliderContainer.appendChild(sliderWrapper);
    sliderContainer.appendChild(volumeText);
    controls.appendChild(sliderContainer);
    
    // >>> Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'popup__delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove synced volume';
    
    // >>> Add delete handler
    deleteBtn.addEventListener('click', async () => {
      await VolumeSettings.removeWebsiteVolume(pattern);
      
      // >>> Get domain from pattern
      const domain = pattern.split('/')[0];
      
      // >>> Clear all tab volumes for this domain
      const sameDomainTabs = await getTabsWithSameDomain(domain);
      for (const tab of sameDomainTabs) {
        await VolumeSettings.removeTabVolume(tab.id);
        // >>> Reset to 100%
        await applyVolumeToTab(tab.id, 100);
      }
      
      // >>> Update current tab sync button if on this domain
      const currentTab = await getCurrentTab();
      const currentDomain = extractDomain(currentTab.url);
      if (currentDomain === domain) {
        currentTabSyncBtn.setAttribute('data-active', 'false');
        // >>> Reset slider to 100%
        currentTabSlider.value = volumeToSlider(100);
        currentTabValue.textContent = '100%';
        updateSliderFill(currentTabSlider);
      }
      
      // >>> Re-render synced volumes list
      await renderSyncedVolumes();
    });
    
    header.appendChild(patternText);
    header.appendChild(deleteBtn);
    controls.appendChild(speakerBtn);
    controls.appendChild(sliderContainer);
    item.appendChild(header);
    item.appendChild(controls);
    
    syncedVolumesList.appendChild(item);
  }
}

// vvv Collapsible Section Functions vvv
// >>> Toggle collapsible section
function toggleSection(headerElement, contentElement) {
  const icon = headerElement.querySelector('.popup__expand-icon');
  const isCollapsed = contentElement.classList.contains('collapsed');
  
  if (isCollapsed) {
    // Expand
    contentElement.classList.remove('collapsed');
    icon.classList.add('expanded');
  } else {
    // Collapse
    contentElement.classList.add('collapsed');
    icon.classList.remove('expanded');
  }
}

// >>> Setup collapsible sections
function setupCollapsibleSections() {
  // All controls section (synced volumes + other tabs)
  allControlsHeader.addEventListener('click', () => {
    toggleSection(allControlsHeader, allControlsContent);
    
    // Load content when expanding
    if (!allControlsContent.classList.contains('collapsed')) {
      setTimeout(async () => {
        await renderSyncedVolumes();
        await renderOtherTabs();
      }, 50);
    }
  });
}

// vvv Initialization vvv
// >>> Load synced settings and apply on popup open
async function initializePopup() {
  const currentTab = await getCurrentTab();
  const domain = extractDomain(currentTab.url);
  
  // >>> Check if website has synced volume
  const isSynced = await VolumeSettings.isWebsiteSynced(domain);
  
  let volumePercent = 100;  // <<< Default to 100%
  
  if (isSynced) {
    // >>> Get synced website volume
    const pattern = await VolumeSettings.getWebsitePattern(domain);
    const syncedVolume = await VolumeSettings.getWebsiteVolume(pattern);
    volumePercent = syncedVolume;
    currentTabSyncBtn.setAttribute('data-active', 'true');
  } else {
    // >>> Check for tab-specific volume
    const syncedTabVolume = await VolumeSettings.getTabVolume(currentTab.id);
    if (syncedTabVolume !== null) {
      volumePercent = syncedTabVolume;
    }
    currentTabSyncBtn.setAttribute('data-active', 'false');
  }
  
  // >>> Set slider and display
  const sliderValue = volumeToSlider(volumePercent);
  currentTabSlider.value = sliderValue;
  currentTabValue.textContent = `${volumePercent}%`;
  
  // >>> Initialize current tab slider fill
  updateSliderFill(currentTabSlider);
  
  // >>> Apply volume to current tab
  await applyVolumeToTab(currentTab.id, volumePercent);
  
  // >>> Setup collapsible sections
  setupCollapsibleSections();
}

// >>> slider fill update
function updateSliderFill(slider) {
  const percent = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--value-percent', percent + '%');
}

// vvv Event Listeners vvv
currentTabSlider.addEventListener('input', updateCurrentTabVolume);
currentTabSyncBtn.addEventListener('click', toggleCurrentTabSync);

// >>> Initialize on popup open
initializePopup();

// vvv Current Tab Mute Button vvv
// >>> Setup current tab mute button
async function setupCurrentTabMuteButton() {
  const currentTab = await getCurrentTab();
  const isMuted = currentTab.mutedInfo.muted;
  
  // Set initial state
  if (isMuted) {
    currentTabMuteBtn.classList.add('muted');
    currentTabMuteBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    </svg>`;
    currentTabMuteBtn.title = 'Unmute tab';
  } else {
    currentTabMuteBtn.classList.remove('muted');
    currentTabMuteBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>`;
    currentTabMuteBtn.title = 'Mute tab';
  }
  
  // Add click handler
  currentTabMuteBtn.addEventListener('click', async () => {
    const newMutedState = await toggleTabMute(currentTab.id);
    
    if (newMutedState) {
      currentTabMuteBtn.classList.add('muted');
      currentTabMuteBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>`;
      currentTabMuteBtn.title = 'Unmute tab';
    } else {
      currentTabMuteBtn.classList.remove('muted');
      currentTabMuteBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>`;
      currentTabMuteBtn.title = 'Mute tab';
    }
  });
}

// And now initialize current tab mute button
setupCurrentTabMuteButton();


