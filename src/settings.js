// Settings window JavaScript for Zombies Overlay
console.log('Settings window loaded');

const { ipcRenderer } = require('electron');

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Settings DOM loaded, setting up event listeners');
    setupEventListeners();
    loadSavedApiKey();
    loadSavedLogPath();
});

let apiKeyTestTimeout;

// Set up event listeners for settings controls
function setupEventListeners() {
    // Close button functionality
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            console.log('Close settings button clicked');
            ipcRenderer.send('close-settings-window');
        });
    }
    
    // Toggle visibility button functionality
    const toggleVisibilityBtn = document.getElementById('toggle-visibility');
    if (toggleVisibilityBtn) {
        toggleVisibilityBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const apiKeyInput = document.getElementById('hypixel-api-key');
            if (apiKeyInput) {
                if (apiKeyInput.type === 'password') {
                    apiKeyInput.type = 'text';
                    toggleVisibilityBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
                } else {
                    apiKeyInput.type = 'password';
                    toggleVisibilityBtn.innerHTML = '<i class="fas fa-eye"></i>';
                }
            }
        });
    }
    
    // Save API key button functionality
    const saveApiKeyBtn = document.getElementById('save-api-key');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', () => {
            const apiKeyInput = document.getElementById('hypixel-api-key');
            if (apiKeyInput) {
                const apiKey = apiKeyInput.value.trim();
                if (apiKey) {
                    console.log('Saving API key');
                    ipcRenderer.send('save-api-key', apiKey);
                    const originalHTML = saveApiKeyBtn.innerHTML;
                    saveApiKeyBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                    saveApiKeyBtn.disabled = true;
                    setTimeout(() => {
                        saveApiKeyBtn.innerHTML = originalHTML;
                        saveApiKeyBtn.disabled = false;
                    }, 2000);
                }
            }
        });
    }
    
    // Auto-test API key when user types
    const apiKeyInput = document.getElementById('hypixel-api-key');
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', () => {
            const apiKey = apiKeyInput.value.trim();
            if (apiKey) {
                if (apiKeyTestTimeout) {
                    clearTimeout(apiKeyTestTimeout);
                }
                apiKeyTestTimeout = setTimeout(() => {
                    testApiKey(apiKey);
                }, 100);
            } else {
                const testResult = document.getElementById('api-test-result');
                if (testResult) {
                    testResult.classList.add('hidden');
                }
            }
        });
    }
    
    // Set up drag functionality with throttling
    
    // Save log file path button functionality
    const saveLogPathBtn = document.getElementById('save-log-path');
    if (saveLogPathBtn) {
        saveLogPathBtn.addEventListener('click', () => {
            const logPathInput = document.getElementById('log-file-path');
            if (logPathInput) {
                const logPath = logPathInput.value.trim();
                if (logPath) {
                    console.log('Saving log file path');
                    ipcRenderer.send('save-log-path', logPath);
                    const originalHTML = saveLogPathBtn.innerHTML;
                    saveLogPathBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                    saveLogPathBtn.disabled = true;
                    
                    // Update the input field to show the saved path
                    ipcRenderer.once('log-path-saved', (event, savedPath) => {
                        if (savedPath) {
                            logPathInput.value = savedPath;
                        }
                        // Reset button after a delay
                        setTimeout(() => {
                            saveLogPathBtn.innerHTML = originalHTML;
                            saveLogPathBtn.disabled = false;
                        }, 2000);
                    });
                }
            }
        });
    }
    setupDragFunctionality();
}

function setupDragFunctionality() {
  const settingsHeader = document.querySelector('.settings-header');
  if (!settingsHeader) return;

  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let lastConfirmedPos = { x: 0, y: 0 };
  let lastUpdate = 0;
  const UPDATE_THROTTLE = 16;

  // Receive updated position from main
  ipcRenderer.on('settings-window-moved', (event, { x, y }) => {
    lastConfirmedPos = { x, y };
  });

  // Request initial position once
  function getInitialPosition() {
    return new Promise((resolve) => {
      ipcRenderer.once('settings-window-position-response', (event, { x, y }) => {
        lastConfirmedPos = { x, y };
        resolve({ x, y });
      });
      ipcRenderer.send('get-settings-window-position');
    });
  }

  settingsHeader.addEventListener('mousedown', async (e) => {
    if (e.target.closest('.control-btn')) return;

    isDragging = true;
    dragStart = { x: e.screenX, y: e.screenY };
    lastConfirmedPos = await getInitialPosition();

    settingsHeader.classList.add('dragging');
    e.preventDefault();

    document.body.style.userSelect = 'none';
    document.body.style.pointerEvents = 'none';
    settingsHeader.style.pointerEvents = 'auto';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const now = Date.now();
    if (now - lastUpdate < UPDATE_THROTTLE) return;
    lastUpdate = now;

    const deltaX = e.screenX - dragStart.x;
    const deltaY = e.screenY - dragStart.y;

    const newX = Math.round(lastConfirmedPos.x + deltaX);
    const newY = Math.round(lastConfirmedPos.y + deltaY);

    ipcRenderer.send('move-settings-window', { x: newX, y: newY });
  });

  function stopDrag() {
    if (!isDragging) return;

    isDragging = false;
    settingsHeader.classList.remove('dragging');

    document.body.style.userSelect = '';
    document.body.style.pointerEvents = '';
    settingsHeader.style.pointerEvents = '';
  }

  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('mouseleave', stopDrag);
  window.addEventListener('blur', stopDrag);
}

// Function to test API key
function testApiKey(apiKey) {
    const testResult = document.getElementById('api-test-result');
    if (testResult) {
        testResult.classList.remove('hidden');
        testResult.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        testResult.className = 'api-test-result';
    }
    
    ipcRenderer.send('test-api-key', apiKey);
}

// Load saved API key when settings window opens
function loadSavedApiKey() {
    console.log('Requesting saved API key');
    ipcRenderer.send('get-saved-api-key');
}

// Listen for saved API key response from main process
ipcRenderer.on('saved-api-key-response', (event, apiKey) => {
    console.log('Received saved API key response');
    const apiKeyInput = document.getElementById('hypixel-api-key');
    if (apiKeyInput && apiKey) {
        apiKeyInput.value = apiKey;
    }
});

// Listen for API key test result from main process
ipcRenderer.on('api-key-test-result', (event, result) => {
    console.log('Received API key test result:', result);
    
    const testResult = document.getElementById('api-test-result');
    if (testResult) {
        testResult.classList.remove('hidden');
        
        if (result.success) {
            testResult.innerHTML = '<i class="fas fa-check-circle success"></i> Connection successful!';
            testResult.className = 'api-test-result success';
        } else {
            testResult.innerHTML = `<i class="fas fa-exclamation-triangle error"></i> ${result.error}`;
            testResult.className = 'api-test-result error';
        }
    }
});

// Function to get the default Minecraft log path based on the operating system
function getDefaultLogPath() {
    const os = require('os');
    const path = require('path');
    
    // Determine the operating system and set the appropriate path
    switch (os.platform()) {
        case 'win32':
            // Windows: %APPDATA%\.minecraft\logs\latest.log
            return path.join(process.env.APPDATA || '', '.minecraft', 'logs', 'latest.log');
        case 'darwin':
            // macOS: ~/Library/Application Support/minecraft/logs/latest.log
            return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft', 'logs', 'latest.log');
        default:
            // Linux and others: ~/.minecraft/logs/latest.log
            return path.join(os.homedir(), '.minecraft', 'logs', 'latest.log');
    }
}

// Load saved log file path when settings window opens
function loadSavedLogPath() {
    console.log('Requesting saved log file path');
    ipcRenderer.send('get-saved-log-path');
}

// Listen for saved log file path response from main process
ipcRenderer.on('saved-log-path-response', (event, logPath) => {
    console.log('Received saved log file path response');
    const logPathInput = document.getElementById('log-file-path');
    if (logPathInput) {
        if (logPath) {
            // Use the saved path if it exists
            logPathInput.value = logPath;
        } else {
            // Leave the input field empty if no saved path exists
            logPathInput.value = '';
        }
    }
});
