const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const LogReader = require('./LogReader');
const { McAPI, HypixelAPI } = require('./api');
const { getRank, getPlusColor, getRankColor, getFormattedRank } = require('./misc');
const PlayerDataFetcher = require('./fetcher');

// Keep a global reference of the window object
let mainWindow;
let logReader;
let mcAPI;
let playerDataFetcher;
// Shared HypixelAPI instance for caching to work across all player lookups
let sharedHypixelAPI;

function createWindow() {
  // Initialize the Minecraft API
  mcAPI = new McAPI();

  // Initialize the Player Data Fetcher
  const apiKey = loadApiKey();
  playerDataFetcher = new PlayerDataFetcher(apiKey);

  // Initialize shared HypixelAPI instance for caching
  sharedHypixelAPI = new HypixelAPI(apiKey);

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 800,
    height: 460,
    minWidth: 800,
    minHeight: 460,
    maxWidth: 800,
    maxHeight: 460,
    frame: false, // Frameless window
    alwaysOnTop: true, // Always on top
    resizable: false, // Prevent resizing
    skipTaskbar: true, // Don't show in taskbar
    transparent: true, // Allow transparency
    backgroundColor: '#00000000', // Completely transparent background
    hasShadow: false, // Remove window shadow
    // Fix flickering when other windows overlap
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      backgroundThrottling: false // Prevent throttling when window is in background
    }
  });

  // Load the index.html
  mainWindow.loadFile('src/index.html');

  // Position the window appropriately for overlay
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const x = width - 800;
  const y = 23;

  mainWindow.setPosition(x, y);

  /* 
  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
  }
  */

  // Start in click-through mode
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Handle mouse enter/leave for header area
  ipcMain.on('mouse-enter-header', () => {
    console.log('Mouse entered header - enabling interaction');
    mainWindow.setIgnoreMouseEvents(false);
  });

  ipcMain.on('mouse-leave-header', () => {
    console.log('Mouse left header - enabling click-through');
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  // Handle focus window request from renderer
  ipcMain.on('focus-window', () => {
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.focus();
    }
  });

  // Handle blur window request from renderer
  ipcMain.on('blur-window', () => {
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // Handle close overlay request from renderer
  ipcMain.on('close-overlay', () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  // Handle window position request from renderer
  ipcMain.on('get-window-position', (event) => {
    if (mainWindow) {
      const pos = mainWindow.getPosition();
      event.sender.send('window-position-response', { x: pos[0], y: pos[1] });
    }
  });

  // Handle window movement from renderer
  ipcMain.on('move-window', (event, { x, y }) => {
    if (mainWindow) {
      mainWindow.setBounds({
        x: x,
        y: y,
        width: 800,
        height: 460
      }, false);
    }
  });


  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Check API key validity when window is created
  // Wait for renderer to be ready before checking API key validity
  mainWindow.webContents.once('dom-ready', () => {
    console.log('Renderer is ready, checking API key validity');
    checkApiKeyValidity();

  });

}

// Function to fetch player UUID and send it to renderer
async function fetchPlayerUUID(playerName) {
  try {
    console.log(`Fetching UUID for player: ${playerName}`);
    const uuid = await mcAPI.getUuid(playerName);
    console.log(`UUID fetch result for ${playerName}:`, uuid);
    if (uuid) {
      console.log(`PLAYER-UUID ASSOCIATION: ${playerName} -> ${uuid}`);
      if (mainWindow) {
        console.log(`Sending UUID for ${playerName} to renderer: ${uuid}`);
        mainWindow.webContents.send('player-uuid', { playerName, uuid });
      }
      // Fetch ALL player data (rank + stats) in ONE API call using shared instance
      fetchPlayerData(uuid, playerName);
    } else {
      console.warn(`No UUID found for player: ${playerName}`);
      console.log(`PLAYER-UUID ASSOCIATION: ${playerName} -> NULL`);
      if (mainWindow) {
        mainWindow.webContents.send('player-uuid', { playerName, uuid: null });
      }
    }
  } catch (error) {
    console.error(`Failed to fetch UUID for ${playerName}:`, error.message);
    console.log(`PLAYER-UUID ASSOCIATION: ${playerName} -> ERROR`);
    if (mainWindow) {
      mainWindow.webContents.send('player-uuid-error', { playerName, error: error.message });
    }
  }
}

// UNIFIED FUNCTION: Fetches ALL player data (rank + stats) in ONE API call
// This dramatically reduces API usage from 3 calls to 1 call per player
async function fetchPlayerData(uuid, playerName) {
  try {
    console.log(`[Unified] Fetching ALL data for player: ${playerName} (${uuid})`);

    // Check if shared API instance is initialized
    if (!sharedHypixelAPI) {
      const apiKey = await loadApiKey();
      if (!apiKey) {
        console.warn(`No API key available for ${playerName}`);
        if (mainWindow) {
          mainWindow.webContents.send('api-connection-status', { connected: false, reason: 'No API key available' });
          mainWindow.webContents.send('player-rank-info', { playerName, rankInfo: null, error: 'No API key available' });
        }
        return;
      }
      sharedHypixelAPI = new HypixelAPI(apiKey);
    }

    // Single API call - the cache in HypixelAPI will handle repeated requests
    const playerData = await sharedHypixelAPI.getPlayer(uuid);

    // Check if we got valid player data
    if (!playerData || playerData.error) {
      console.warn(`Failed to fetch player data for ${playerName}:`, playerData ? playerData.error : 'No data');
      if (playerData && playerData.error) {
        if (playerData.error.includes('API_KEY') || playerData.error.includes('INVALID') || playerData.error.includes('RATE_LIMIT')) {
          if (mainWindow) {
            mainWindow.webContents.send('api-connection-status', { connected: false, reason: playerData.error });
          }
        }
      }
      if (mainWindow) {
        mainWindow.webContents.send('player-rank-info', { playerName, rankInfo: null, error: playerData ? playerData.error : 'Failed to fetch player data' });
      }
      return;
    }

    // If we got valid data, update connection status to connected
    if (mainWindow) {
      mainWindow.webContents.send('api-connection-status', { connected: true, reason: 'API key valid' });
    }

    // Access player data correctly - Hypixel API returns data in player field
    const playerInfo = playerData.player || playerData;

    // ==================== EXTRACT RANK INFO ====================
    const rank = getRank(playerData);
    const rankColorCode = getRankColor(rank);
    let plusColorValue = null;

    if (rank === 'MVP+') {
      const playerInfoKeys = Object.keys(playerInfo);
      const rankPlusColorKey = playerInfoKeys.find(key => key.toLowerCase() === 'rankpluscolor');
      const plusColorKey = playerInfoKeys.find(key => key.toLowerCase() === 'pluscolor');
      plusColorValue = playerInfo.rankPlusColor || playerInfo.plusColor ||
        (rankPlusColorKey ? playerInfo[rankPlusColorKey] : null) ||
        (plusColorKey ? playerInfo[plusColorKey] : null);
    } else if (rank === 'MVP++') {
      const playerInfoKeys = Object.keys(playerInfo);
      const rankPlusColorKey = playerInfoKeys.find(key => key.toLowerCase() === 'rankpluscolor');
      const plusColorKey = playerInfoKeys.find(key => key.toLowerCase() === 'pluscolor');
      plusColorValue = playerInfo.rankPlusColor || playerInfo.plusColor ||
        (rankPlusColorKey ? playerInfo[rankPlusColorKey] : null) ||
        (plusColorKey ? playerInfo[plusColorKey] : null);
    }

    const plusColor = getPlusColor(rank, plusColorValue);

    // For MVP++, we also need the monthly rank color
    let monthlyRankColor = null;
    if (rank === 'MVP++') {
      const colorMap = {
        'RED': { mc: '§c', hex: '#FF5555' },
        'GOLD': { mc: '§6', hex: '#FFAA00' },
        'GREEN': { mc: '§a', hex: '#55FF55' },
        'YELLOW': { mc: '§e', hex: '#FFFF55' },
        'LIGHT_PURPLE': { mc: '§d', hex: '#FF55FF' },
        'WHITE': { mc: '§f', hex: '#F2F2F2' },
        'BLUE': { mc: '§9', hex: '#5555FF' },
        'DARK_GREEN': { mc: '§2', hex: '#00AA00' },
        'DARK_RED': { mc: '§4', hex: '#AA0000' },
        'DARK_AQUA': { mc: '§3', hex: '#00AAAA' },
        'DARK_PURPLE': { mc: '§5', hex: '#AA00AA' },
        'DARK_GRAY': { mc: '§8', hex: '#555555' },
        'BLACK': { mc: '§0', hex: '#000000' }
      };

      if (typeof playerInfo.monthlyRankColor === 'string') {
        const upperMonthlyRankColor = playerInfo.monthlyRankColor.toUpperCase();
        monthlyRankColor = colorMap[upperMonthlyRankColor] || { mc: '§6', hex: '#FFAA00' };
      } else {
        monthlyRankColor = { mc: '§6', hex: '#FFAA00' };
      }
    }

    const formattedRank = getFormattedRank(rank, plusColor.mc || '§7', monthlyRankColor ? monthlyRankColor.mc : null);

    const rankInfo = {
      rank: rank,
      rankColorCode: rankColorCode,
      plusColor: plusColor,
      monthlyRankColor: monthlyRankColor,
      formattedRank: formattedRank
    };

    // Send rank information to renderer
    if (mainWindow) {
      mainWindow.webContents.send('player-rank-info', { playerName, rankInfo, error: null });
    }

    // ==================== EXTRACT STATS INFO ====================
    const playerStats = extractStatsFromPlayerData(playerName, playerInfo);

    // Send player stats to renderer
    if (mainWindow) {
      mainWindow.webContents.send('player-stats', { playerName, stats: playerStats });
    }

    console.log(`[Unified] Successfully fetched all data for ${playerName} with 1 API call`);

  } catch (error) {
    console.error(`Failed to fetch data for ${playerName}:`, error.message);
    if (mainWindow) {
      mainWindow.webContents.send('api-connection-status', { connected: false, reason: error.message });
      mainWindow.webContents.send('player-rank-info', { playerName, rankInfo: null, error: error.message });
    }
  }
}

// Helper function to extract stats from player data (avoids second API call)
function extractStatsFromPlayerData(playerName, playerInfo) {
  const playerStats = {
    "Player": playerName,
    "Wins": 0,
    "Wins BB": 0,
    "Wins DE": 0,
    "Wins AA": 0,
    "Wins PR": 0,
    "Best AA": 0,
    "Kills": 0,
    "Deaths": 0,
    "K/D Ratio": 0,
    "Accuracy": "N/A",
    "PB DE": "N/A",
    "PB BB": "N/A",
    "PB AA": "N/A",
    "PB PR": "N/A"
  };

  try {
    // Get Arcade stats (Zombies mode)
    const arcadeStats = playerInfo.stats?.Arcade || {};

    // Calculate accuracy in percentage
    const bulletsHit = arcadeStats.bullets_hit_zombies || 0;
    const bulletsShot = arcadeStats.bullets_shot_zombies || 0;
    const accuracy = bulletsShot !== 0 ? (bulletsHit / bulletsShot) * 100 : 0;
    playerStats["Accuracy"] = bulletsShot !== 0 ? `${accuracy.toFixed(2)}%` : "N/A";

    // Calculate K/D Ratio
    const kills = arcadeStats.zombie_kills_zombies || 0;
    const deaths = arcadeStats.deaths_zombies || 0;
    const kdr = deaths !== 0 ? Math.round((kills / deaths) * 100) / 100 : kills;
    playerStats["K/D Ratio"] = kdr;

    // Set basic stats
    playerStats["Kills"] = kills;
    playerStats["Deaths"] = deaths;
    playerStats["Wins"] = arcadeStats.wins_zombies || 0;
    playerStats["Wins BB"] = arcadeStats.wins_zombies_badblood || 0;
    playerStats["Wins DE"] = arcadeStats.wins_zombies_deadend || 0;
    playerStats["Wins AA"] = arcadeStats.wins_zombies_alienarcadium || 0;
    playerStats["Wins PR"] = arcadeStats.wins_zombies_prison || 0;
    playerStats["Best AA"] = arcadeStats.best_round_zombies_alienarcadium || 0;

    // Get PB times
    playerStats["PB DE"] = formatZombiesTime(arcadeStats.fastest_time_30_zombies_deadend_normal);
    playerStats["PB BB"] = formatZombiesTime(arcadeStats.fastest_time_30_zombies_badblood_normal);
    playerStats["PB AA"] = formatZombiesTimeAA(arcadeStats.fastest_time_30_zombies_alienarcadium_normal);
    playerStats["PB PR"] = formatZombiesTime(arcadeStats.fastest_time_30_zombies_prison_normal);
  } catch (error) {
    console.error(`Error extracting stats for ${playerName}:`, error.message);
  }

  return playerStats;
}

// Format time helper (MM:SS)
function formatZombiesTime(seconds) {
  if (seconds === undefined || seconds === null) return "N/A";
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Format time helper for AA (HHh:MM)
function formatZombiesTimeAA(seconds) {
  if (seconds === undefined || seconds === null) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h:${minutes.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}`;
  }
}

// Keep legacy functions for backwards compatibility but they are no longer used
// Function to fetch player rank information from Hypixel API (DEPRECATED - use fetchPlayerData)
async function fetchPlayerRank(uuid, playerName) {
  console.warn('[DEPRECATED] fetchPlayerRank is deprecated, use fetchPlayerData instead');
  return fetchPlayerData(uuid, playerName);
}

// Function to fetch player stats from Hypixel API (DEPRECATED - use fetchPlayerData)
async function fetchPlayerStats(uuid, playerName) {
  console.warn('[DEPRECATED] fetchPlayerStats is deprecated, use fetchPlayerData instead');
  // Do nothing - stats are now fetched in fetchPlayerData
}

function startLogMonitoring() {
  // Load the saved log file path
  const logPath = loadLogPath();

  // Only start monitoring if a log path has been saved
  if (logPath) {
    try {
      logReader = new LogReader(logPath);

      // Send connection status update when log monitoring starts successfully
      if (mainWindow) {
        mainWindow.webContents.send('connection-status', { connected: true });
      }

      logReader.on('join', (playerName) => {
        if (mainWindow) {
          mainWindow.webContents.send('player-join', playerName);
          fetchPlayerUUID(playerName);
        }
      });

      logReader.on('leave', (playerName) => {
        if (mainWindow) {
          mainWindow.webContents.send('player-leave', playerName);
        }
      });

      logReader.on('reset', () => {
        if (mainWindow) {
          mainWindow.webContents.send('player-reset');
        }
      });

      console.log('Minecraft log monitoring started successfully');
    } catch (error) {
      console.error('Failed to start log monitoring:', error.message);
      // Send connection status update when log monitoring fails
      if (mainWindow) {
        mainWindow.webContents.send('connection-status', { connected: false });
      }

      if (error.code === 'ENOENT') {
        console.error('Minecraft log file not found. Please ensure the log file path is correct.');
      }
    }
  } else {
    // No log path saved, send disconnected status
    console.log('No log file path saved. Please set the log file path in settings.');
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', { connected: false });
    }
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();
  startLogMonitoring();
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (logReader) {
      const fs = require('fs');
      fs.unwatchFile(logReader.path);
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Keep a global reference of the settings window object
let settingsWindow;

// Function to create the settings window
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  // Get the position of the main window to position the settings window appropriately
  let settingsX = 100;
  let settingsY = 100;

  if (mainWindow) {
    const mainWindowPosition = mainWindow.getPosition();
    const mainWindowSize = mainWindow.getSize();

    // Position the settings window to the left of the main window if there's space
    // otherwise position it to the right
    if (mainWindowPosition[0] > 520) {
      settingsX = mainWindowPosition[0] - 520; // 500 width + 20px gap
      settingsY = mainWindowPosition[1];
    } else {
      settingsX = mainWindowPosition[0] + mainWindowSize[0] + 20; // 20px gap
      settingsY = mainWindowPosition[1];
    }
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600, // Increased further to ensure all content is fully visible
    x: settingsX,
    y: settingsY,
    resizable: false,
    frame: false,
    transparent: true, // Changed to true for consistency
    backgroundColor: '#00000000', // Transparent background like the main window
    hasShadow: false, // Remove shadow
    // Fix flickering when dragging over other windows
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      backgroundThrottling: false // Prevent throttling when window is in background
    }
  });

  // Load the settings.html file
  settingsWindow.loadFile('src/settings.html');

  // Handle window closed event
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Handle settings window position request from renderer
ipcMain.on('get-settings-window-position', (event) => {
  if (settingsWindow) {
    const pos = settingsWindow.getPosition();
    event.sender.send('settings-window-position-response', { x: pos[0], y: pos[1] });
  }
});

// Handle settings window movement from renderer - Improved version with debouncing
let moveTimeout = null;
ipcMain.on('move-settings-window', (event, { x, y }) => {
  if (!settingsWindow) return;

  // Clear previous timeout to debounce rapid movements
  if (moveTimeout) {
    clearTimeout(moveTimeout);
  }

  // Use immediate update for smooth movement but with position validation
  const validX = Math.max(0, Math.round(x));
  const validY = Math.max(0, Math.round(y));

  try {
    settingsWindow.setBounds({ x: validX, y: validY, width: 500, height: 600 }, false);
    event.sender.send('settings-window-moved', { x: validX, y: validY });
  } catch (error) {
    console.error('Error moving settings window:', error);
  }
});

// Function to get the path for storing user data
function getUserDataPath() {
  return path.join(app.getPath('userData'), 'hypixel-api-key.txt');
}

// Function to save API key to file
function saveApiKey(key) {
  const userDataPath = getUserDataPath();
  try {
    fs.writeFileSync(userDataPath, key, 'utf8');
    console.log('API key saved successfully');
    return true;
  } catch (error) {
    console.error('Failed to save API key:', error.message);
    return false;
  }
}

// Function to load API key from file
function loadApiKey() {
  const userDataPath = getUserDataPath();
  try {
    if (fs.existsSync(userDataPath)) {
      const key = fs.readFileSync(userDataPath, 'utf8');
      console.log('API key loaded successfully');
      return key;
    }
    return null;
  } catch (error) {
    console.error('Failed to load API key:', error.message);
    return null;
  }
}

// Function to get the path for storing log file path
function getLogPathFilePath() {
  return path.join(app.getPath('userData'), 'log-file-path.txt');
}

// Function to save log file path to file
function saveLogPath(logPath) {
  const logPathFilePath = getLogPathFilePath();
  try {
    fs.writeFileSync(logPathFilePath, logPath, 'utf8');
    console.log('Log file path saved successfully');
    return true;
  } catch (error) {
    console.error('Failed to save log file path:', error.message);
    return false;
  }
}

// Function to load log file path from file
function loadLogPath() {
  const logPathFilePath = getLogPathFilePath();
  try {
    if (fs.existsSync(logPathFilePath)) {
      const logPath = fs.readFileSync(logPathFilePath, 'utf8');
      console.log('Log file path loaded successfully');
      return logPath;
    }
    return null;
  } catch (error) {
    console.error('Failed to load log file path:', error.message);
    return null;
  }
}

// Function to check API key validity and update connection status
async function checkApiKeyValidity() {
  try {
    console.log('Checking API key validity');
    // Load the API key
    const apiKey = await loadApiKey();
    if (!apiKey) {
      console.log('No API key found');
      // Update connection status to reflect no API key
      if (mainWindow) {
        mainWindow.webContents.send('api-connection-status', { connected: false, reason: 'No API key available' });
      }
      return;
    }

    // Create HypixelAPI instance and test the key
    const hypixelAPI = new HypixelAPI(apiKey);
    const keyInfo = await hypixelAPI.getKeyInfo();

    // Check if we got valid response
    if (!keyInfo) {
      console.log('No response from Hypixel API');
      if (mainWindow) {
        mainWindow.webContents.send('api-connection-status', { connected: false, reason: 'No response from Hypixel API' });
      }
      return;
    }

    // Check if the response indicates success
    if (keyInfo.success === true) {
      console.log('API key is valid');
      if (mainWindow) {
        mainWindow.webContents.send('api-connection-status', { connected: true, reason: 'API key valid' });
      }
    } else {
      console.log('API key is invalid:', keyInfo.cause || 'Unknown error');
      if (mainWindow) {
        mainWindow.webContents.send('api-connection-status', { connected: false, reason: keyInfo.cause || 'Invalid API key' });
      }
    }
  } catch (error) {
    console.error('Failed to check API key validity:', error.message);
    if (mainWindow) {
      mainWindow.webContents.send('api-connection-status', { connected: false, reason: error.message || 'Failed to validate API key' });
    }
  }
}

// IPC handlers for settings window
ipcMain.on('open-settings-window', () => {
  createSettingsWindow();
});

ipcMain.on('close-settings-window', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.on('save-api-key', (event, apiKey) => {
  const success = saveApiKey(apiKey);
  if (success && mainWindow) {
    mainWindow.webContents.send('api-key-saved', apiKey);
  }
});

ipcMain.on('save-log-path', (event, logPath) => {
  const success = saveLogPath(logPath);
  if (success && event.sender) {
    event.sender.send('log-path-saved', logPath);
  }
});

ipcMain.on('get-saved-api-key', (event) => {
  const apiKey = loadApiKey();
  event.sender.send('saved-api-key-response', apiKey);
});

ipcMain.on('get-saved-log-path', (event) => {
  const logPath = loadLogPath();
  event.sender.send('saved-log-path-response', logPath);
});

ipcMain.on('test-api-key', async (event, apiKey) => {
  console.log('Testing API key in main process:', apiKey ? `${apiKey.substring(0, 8)}...` : 'null');
  try {
    const hypixelAPI = new HypixelAPI(apiKey);
    const keyInfo = await hypixelAPI.getKeyInfo();
    console.log('API key test result:', keyInfo);

    // Check if we got a valid response
    if (!keyInfo) {
      console.log('No response from Hypixel API');
      event.sender.send('api-key-test-result', {
        success: false,
        error: 'No response from Hypixel API'
      });
      return;
    }

    // Check if the response has the expected structure
    if (typeof keyInfo !== 'object') {
      console.log('Invalid response from Hypixel API:', keyInfo);
      event.sender.send('api-key-test-result', {
        success: false,
        error: 'Invalid response from Hypixel API'
      });
      return;
    }

    // Check for success field
    if (keyInfo.success === true) {
      console.log('API key test successful');
      event.sender.send('api-key-test-result', { success: true });
    } else {
      // Handle various error cases
      console.log('API key test failed:', keyInfo);
      let errorMessage = 'Invalid API key';

      // Use the cause if provided
      if (keyInfo.cause) {
        errorMessage = keyInfo.cause;
      }
      // Check for throttle error
      else if (keyInfo.throttle) {
        errorMessage = 'API key test throttled. Please try again later.';
      }

      event.sender.send('api-key-test-result', {
        success: false,
        error: errorMessage
      });
    }
  } catch (error) {
    console.error('API key test failed with error:', error);

    // Provide more specific error messages based on the error type
    let errorMessage = 'Connection failed';
    if (error.message) {
      // Check for network errors
      if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Unable to connect to Hypixel API. Please check your internet connection.';
      }
      // Check for timeout errors
      else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        errorMessage = 'Connection to Hypixel API timed out. Please try again.';
      }
      // Use the actual error message if it's more descriptive
      else if (error.message !== 'Connection failed') {
        errorMessage = error.message;
      }
    }

    event.sender.send('api-key-test-result', {
      success: false,
      error: errorMessage
    });
  }
});