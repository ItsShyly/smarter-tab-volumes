// ^^^ Detect Shift key press for Shift+Click muting functionality ^^^
// >>> This script is made by SHYLY

// vvv Shift Key Detection vvv
let shiftPressed = false;

// >>> Listen for shift key down
document.addEventListener('keydown', (event) => {
  if (event.key === 'Shift' && !shiftPressed) {
    shiftPressed = true; // <<< Mark as pressed
    // >>> Notify background script
    chrome.runtime.sendMessage({ 
      type: 'shift-key-state', 
      isPressed: true 
    }).catch(() => {
    });
  }
});

// >>> Listen for shift key up
document.addEventListener('keyup', (event) => {
  if (event.key === 'Shift') {
    shiftPressed = false; // <<< Mark as released
    // >>> Notify background script
    chrome.runtime.sendMessage({ 
      type: 'shift-key-state', 
      isPressed: false 
    }).catch(() => {
    });
  }
});

// >>> Also reset on window blur (tab/windows switches)
window.addEventListener('blur', () => {
  if (shiftPressed) {
    shiftPressed = false; // <<< Reset shift state
    chrome.runtime.sendMessage({ 
      type: 'shift-key-state', 
      isPressed: false 
    }).catch(() => {
    });
  }
});
