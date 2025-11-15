// ^^^ Content script that automatically applies saved volumes ^^^ 
// >>> This script is made by SHYLY

(async function() {
  console.log('[Volume Injector] Loading...');
  
  // >>> Get current page domain
  function extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch (e) {
      return null;
    }
  }
  
  // >>> Get pattern (domain + path pattern)
  function getWebsitePattern(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace(/^www\./, '');
      return `${domain}/*`;
    } catch (e) {
      return null;
    }
  }
  
  const currentDomain = extractDomain(window.location.href);
  const currentPattern = getWebsitePattern(window.location.href);
  
  if (!currentDomain) return;
  
  // >>> Get stored volumes
  const storage = await chrome.storage.local.get(['websiteVolumes']);
  const websiteVolumes = storage.websiteVolumes || {};
  
  const savedVolume = websiteVolumes[currentPattern];
  
  console.log('[Volume Injector] Domain:', currentDomain);
  console.log('[Volume Injector] Pattern:', currentPattern);
  console.log('[Volume Injector] Saved volume:', savedVolume);
  
  if (savedVolume !== undefined) {
    console.log('[Volume Injector] Applying volume:', savedVolume);
    injectVolumeScript(savedVolume);
  }
  
  // >>> Listen for storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.websiteVolumes) {
      const newVolumes = changes.websiteVolumes.newValue || {};
      const newVolume = newVolumes[currentPattern];
      
      if (newVolume !== undefined) {
        console.log('[Volume Injector] Volume changed to:', newVolume);
        injectVolumeScript(newVolume);
      }
    }
  });
  
  // vvv Inject script into main world (not isolated) vvv
  // >>> This script injection is needed to access real AudioContext and media elements
  // >>> just using content scripts won't work, they run in an isolated world and cannot fully control audio
  function injectVolumeScript(volumePercent) {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        const volumePercent = ${volumePercent};
        const gainValue = volumePercent / 100;
        
        console.log('[Volume Injector - Main World] Applying volume:', volumePercent);
        
        if (!window.volumeController) {
          window.volumeController = {
            targetGain: gainValue,
            audioContext: null,
            elements: new Map(),
            initialized: false
          };
        } else {
          window.volumeController.targetGain = gainValue;
        }
        
        function getElementId(element) {
          if (!element._volumeControllerId) {
            element._volumeControllerId = 'vc_' + Date.now() + '_' + Math.random();
          }
          return element._volumeControllerId;
        }
        
        function disconnectAudioControl(element) {
          const elemId = getElementId(element);
          const existing = window.volumeController.elements.get(elemId);
          
          if (existing && existing.gainNode) {
            try {
              existing.source.disconnect();
              existing.gainNode.disconnect();
            } catch (error) {
              // Ignore
            }
          }
          
          window.volumeController.elements.delete(elemId);
        }
        
        function setupAudioControl(element) {
          const elemId = getElementId(element);
          const existing = window.volumeController.elements.get(elemId);
          
          if (window.volumeController.targetGain === 1.0) {
            if (existing && (existing.gainNode || existing.fallback)) {
              disconnectAudioControl(element);
            }
            return;
          }
          
          if (existing && existing.gainNode) {
            existing.gainNode.gain.value = window.volumeController.targetGain;
            return;
          }
          
          if (existing && existing.fallback) {
            element.volume = Math.min(window.volumeController.targetGain, 1.0);
            return;
          }
          
          try {
            if (!window.volumeController.audioContext) {
              const AudioContext = window.AudioContext || window.webkitAudioContext;
              window.volumeController.audioContext = new AudioContext();
            }
            
            const ctx = window.volumeController.audioContext;
            
            if (ctx.state === 'suspended') {
              ctx.resume();
            }
            
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
            
            console.log('[Volume Injector - Main World] Applied Web Audio to element');
          } catch (error) {
            element.volume = Math.min(window.volumeController.targetGain, 1.0);
            window.volumeController.elements.set(elemId, {
              fallback: true
            });
            console.log('[Volume Injector - Main World] Using fallback volume control');
          }
        }
        
        function applyToAllMedia() {
          const mediaElements = document.querySelectorAll('audio, video');
          mediaElements.forEach(element => {
            setupAudioControl(element);
          });
          return mediaElements.length;
        }
        
        // Apply immediately
        const found = applyToAllMedia();
        console.log('[Volume Injector - Main World] Found', found, 'media elements');
        
        // Retry for dynamically loaded content
        let retries = 0;
        const retryInterval = setInterval(function() {
          applyToAllMedia();
          retries++;
          if (retries >= 10) clearInterval(retryInterval);
        }, 500);
        
        // Set up observer (only once)
        if (!window.volumeController.initialized) {
          window.volumeController.initialized = true;
          
          const observer = new MutationObserver(function() {
            applyToAllMedia();
          });
          
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          } else {
            document.addEventListener('DOMContentLoaded', function() {
              observer.observe(document.body, { childList: true, subtree: true });
            });
          }
          
          // Media event listeners
          document.addEventListener('play', function(e) {
            if (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO') {
              setupAudioControl(e.target);
            }
          }, true);
          
          document.addEventListener('loadedmetadata', function(e) {
            if (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO') {
              setupAudioControl(e.target);
            }
          }, true);
          
          document.addEventListener('canplay', function(e) {
            if (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO') {
              setupAudioControl(e.target);
            }
          }, true);
          
          console.log('[Volume Injector - Main World] Observer and event listeners set up');
        }
      })();
    `;
    
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    
    console.log('[Volume Injector] Script injected into main world');
  }
})();
