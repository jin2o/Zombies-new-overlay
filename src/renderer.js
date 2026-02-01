// Renderer process JavaScript for Zombies Overlay
console.log('Renderer process loaded');

// Minecraft color code to CSS class mapping
const minecraftColorMap = {
    '0': 'black',
    '1': 'dark-blue',
    '2': 'dark-green',
    '3': 'dark-aqua',
    '4': 'dark-red',
    '5': 'dark-purple',
    '6': 'gold',
    '7': 'gray',
    '8': 'dark-gray',
    '9': 'blue',
    'a': 'green',
    'b': 'aqua',
    'c': 'red',
    'd': 'light-purple',
    'e': 'yellow',
    'f': 'white'
};

// Function to get Minecraft color code based on player rank
function getRankColor(rank) {
    const rankColorMap = {
        'VIP': 'a',      // Green
        'VIP+': 'a',     // Green
        'MVP': 'b',      // Aqua (changed from '9' to 'b')
        'MVP+': 'b',     // Aqua (changed from '9' to 'b')
        'MVP++': '6',    // Gold
        'NON': '7',      // Gray
        'DEFAULT': '7'   // Gray for unknown ranks
    };

    // Normalize rank to uppercase for case-insensitive matching
    const normalizedRank = (rank || 'NON').toUpperCase();
    return rankColorMap[normalizedRank] || rankColorMap['DEFAULT'];
}

// Function to handle image loading errors and retries
function handleImageError(imgElement, uuid, playerName) {
    console.log(`Image load error for player ${playerName} with UUID ${uuid}`);

    // Fallback to Minotar if the primary URL fails
    const fallbackUrl = `https://minotar.net/helm/${uuid}/24.png`;
    console.log(`Retrying image load for ${playerName} with fallback URL: ${fallbackUrl}`);

    if (imgElement.src !== fallbackUrl) {
        imgElement.src = fallbackUrl;
        imgElement.onerror = function () {
            console.log(`Fallback attempt failed for ${playerName}, showing default head`);
            // Final fallback to a static default head or Minotar's Steve
            this.src = `https://minotar.net/helm/char/24.png`;
            this.onerror = null;
        };
    }
}

// Player management and display functionality
const { ipcRenderer } = require('electron');

// Store current players in the lobby
let currentPlayers = new Set();
// Store player UUIDs
let playerUUIDs = new Map();
// Store player rank information
let playerRanks = new Map();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, setting up IPC listeners');
    setupIPCListeners();
    initializePlayerDisplay();
    setupHeaderInteraction();
    setupDragFunctionality();
    // Set initial connection status to disconnected
    updateConnectionStatus(false);
});

// Set up header interaction for click-through management
function setupHeaderInteraction() {
    const overlayHeader = document.querySelector('.overlay-header');

    if (overlayHeader) {
        // Mouse enter header - enable interaction
        overlayHeader.addEventListener('mouseenter', () => {
            console.log('Mouse entered header area');
            ipcRenderer.send('mouse-enter-header');
        });

        // Mouse leave header - enable click-through
        overlayHeader.addEventListener('mouseleave', () => {
            console.log('Mouse left header area');
            ipcRenderer.send('mouse-leave-header');
        });

        // Click on header to focus window
        overlayHeader.addEventListener('click', (e) => {
            // Don't interfere with close button functionality
            if (!e.target.closest('.control-btn')) {
                console.log('Header clicked - focusing window');
                ipcRenderer.send('focus-window');
            }
        });
    }

    // Handle window blur to restore click-through
    window.addEventListener('blur', () => {
        console.log('Window lost focus - enabling click-through');
        ipcRenderer.send('blur-window');
    });
}

// Make the overlay movable
function setupDragFunctionality() {
    const header = document.querySelector('.overlay-header');

    let isDragging = false;
    let initialMouseX, initialMouseY;
    let initialWindowX, initialWindowY;

    header.addEventListener('mousedown', (e) => {
        // Only start dragging if not clicking on control buttons
        if (!e.target.closest('.control-btn')) {
            console.log('Starting drag operation');
            isDragging = true;
            initialMouseX = e.screenX;
            initialMouseY = e.screenY;

            // Request initial window position from main process
            ipcRenderer.send('get-window-position');
            e.preventDefault();

            // Ensure we have interaction enabled during drag
            ipcRenderer.send('focus-window');
        }
    });

    // Listen for window position response from main process
    ipcRenderer.on('window-position-response', (event, { x, y }) => {
        if (isDragging) {
            initialWindowX = x;
            initialWindowY = y;
            console.log(`Initial window position: ${x}, ${y}`);
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging && initialWindowX !== undefined && initialWindowY !== undefined) {
            const deltaX = e.screenX - initialMouseX;
            const deltaY = e.screenY - initialMouseY;

            const newX = initialWindowX + deltaX;
            const newY = initialWindowY + deltaY;

            // Notify main process to move window
            ipcRenderer.send('move-window', { x: newX, y: newY });
            e.preventDefault();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            console.log('Drag operation completed');
            isDragging = false;
            initialWindowX = undefined;
            initialWindowY = undefined;

            // Re-enable click-through after dragging
            setTimeout(() => {
                ipcRenderer.send('mouse-leave-header');
            }, 100);
        }
    });

    // Close button functionality
    const closeButton = document.getElementById('close-button');
    if (closeButton) {
        closeButton.addEventListener('click', (e) => {
            console.log('Close button clicked');
            e.stopPropagation(); // Prevent header click event
            ipcRenderer.send('close-overlay');
        });
    }

    // Settings button functionality (if needed)
    const settingsButton = document.getElementById('settings-btn');
    if (settingsButton) {
        settingsButton.addEventListener('click', (e) => {
            console.log('Settings button clicked');
            e.stopPropagation(); // Prevent header click event
            // Send message to main process to open settings window
            ipcRenderer.send('open-settings-window');
        });
    }
}

// Set up IPC listeners for player events
function setupIPCListeners() {
    // Listen for player join events
    ipcRenderer.on('player-join', (event, playerName) => {
        console.log(`Player joined: ${playerName}`);
        addPlayer(playerName);
        updatePlayerDisplay();
    });

    // Listen for player UUID events
    ipcRenderer.on('player-uuid', (event, { playerName, uuid }) => {
        console.log(`Received UUID for ${playerName}: ${uuid}`);
        playerUUIDs.set(playerName, uuid);
        updatePlayerDisplay();
    });

    // Listen for player UUID error events
    ipcRenderer.on('player-uuid-error', (event, { playerName, error }) => {
        console.error(`UUID fetch error for ${playerName}:`, error);
        playerUUIDs.set(playerName, null);
        updatePlayerDisplay();
    });

    // Listen for player leave events
    ipcRenderer.on('player-leave', (event, playerName) => {
        console.log(`Player left: ${playerName}`);
        removePlayer(playerName);
        updatePlayerDisplay();
    });

    // Listen for reset events
    ipcRenderer.on('player-reset', () => {
        console.log('Resetting player list');
        resetPlayers();
        updatePlayerDisplay();
    });

    // Listen for player rank information events
    ipcRenderer.on('player-rank-info', (event, { playerName, rankInfo, error }) => {
        console.log(`Received rank information for ${playerName}:`, rankInfo, error);
        if (rankInfo) {
            playerRanks.set(playerName, rankInfo);
        } else {
            playerRanks.delete(playerName);
        }
        updatePlayerDisplay();
    });

    // Listen for connection status updates (log file monitoring)
    ipcRenderer.on('connection-status', (event, { connected }) => {
        console.log(`Log connection status update: ${connected ? 'Connected' : 'Disconnected'}`);
        updateConnectionStatus(connected, 'log');
    });

    // Listen for API connection status updates
    ipcRenderer.on('api-connection-status', (event, { connected, reason }) => {
        console.log(`API connection status update: ${connected ? 'Connected' : 'Disconnected'}, Reason: ${reason}`);
        updateConnectionStatus(connected, 'api', reason);
    });

    // Listen for player stats events
    ipcRenderer.on('player-stats', (event, { playerName, stats }) => {
        console.log(`Received stats for ${playerName}:`, stats);
        // Store player stats
        if (!window.playerStats) {
            window.playerStats = new Map();
        }
        window.playerStats.set(playerName, stats);
        updatePlayerDisplay();
    });

    // Listen for player stats error events
    ipcRenderer.on('player-stats-error', (event, { playerName, error }) => {
        console.error(`Stats fetch error for ${playerName}:`, error);
        // Remove player stats if there was an error
        if (window.playerStats) {
            window.playerStats.delete(playerName);
        }
        updatePlayerDisplay();
    });
}

// Initialize player display area
function initializePlayerDisplay() {
    const tableBody = document.getElementById('players-table-body');
    const playerCountElement = document.getElementById('player-count-badge');

    // Initialize player count (empty by default)
    if (playerCountElement) {
        playerCountElement.textContent = '';
    }

    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="7" class="no-players-table">No players online</td></tr>';
    }
}

// Add player to current players set
function addPlayer(playerName) {
    currentPlayers.add(playerName);
}

// Remove player from current players set
function removePlayer(playerName) {
    currentPlayers.delete(playerName);
    playerUUIDs.delete(playerName); // Clean up UUID cache
}

// Reset all players (for server change or clear)
function resetPlayers() {
    currentPlayers.clear();
    playerUUIDs.clear(); // Clean up UUID cache
    playerRanks.clear(); // Clean up rank cache
}

// Function to parse Minecraft formatting codes and convert to HTML with CSS classes
function parseMinecraftFormatting(text) {
    // Remove the initial § and split by §
    const parts = text.split('§');
    if (parts.length === 0) return '';

    let html = '';
    // Process each part
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.length === 0) continue;

        // First character is the color code
        const colorCode = part[0];
        // Rest is the text
        const textContent = part.substring(1);

        // Map Minecraft color codes to CSS classes
        const colorClasses = {
            '0': 'black',
            '1': 'dark-blue',
            '2': 'dark-green',
            '3': 'dark-aqua',
            '4': 'dark-red',
            '5': 'dark-purple',
            '6': 'gold',
            '7': 'gray',
            '8': 'dark-gray',
            '9': 'blue',
            'a': 'green',
            'b': 'aqua',
            'c': 'red',
            'd': 'light-purple',
            'e': 'yellow',
            'f': 'white'
        };

        // Get CSS class for color code
        const cssClass = colorClasses[colorCode] || 'gray';

        // Add span with CSS class
        html += `<span class="${cssClass}">${textContent}</span>`;
    }

    return html;
}

// Update the player display with current players list in table format
function updatePlayerDisplay() {
    const statsContent = document.getElementById('stats-content');
    const tableBody = document.getElementById('players-table-body');
    const playerCountElement = document.getElementById('player-count-badge');
    if (!statsContent || !tableBody) return;

    // Update player count (only show if there are players online)
    if (playerCountElement) {
        if (currentPlayers.size > 0) {
            playerCountElement.textContent = currentPlayers.size;
            playerCountElement.classList.add('show');
        } else {
            playerCountElement.textContent = '';
            playerCountElement.classList.remove('show');
        }
    }

    if (currentPlayers.size === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="no-players-table">No players online</td></tr>';
        return;
    }

    const sortedPlayers = Array.from(currentPlayers).sort();
    let tableHtml = '';

    sortedPlayers.forEach(player => {
        const uuid = playerUUIDs.get(player);
        console.log(`Generating player head for ${player}, UUID: ${uuid}`);

        const rankInfo = playerRanks.get(player);
        let rankHtml = '';

        // Get rank color for player name
        let rankColorClass = 'gray'; // Default color
        if (rankInfo && rankInfo.rank) {
            const rankColorCode = getRankColor(rankInfo.rank);
            rankColorClass = minecraftColorMap[rankColorCode] || 'gray';
        }

        // Generate formatted rank if available
        if (rankInfo && rankInfo.formattedRank) {
            rankHtml = parseMinecraftFormatting(rankInfo.formattedRank);
        }

        // Start table row
        tableHtml += '<tr>';

        // Player name column with head image
        tableHtml += '<td>';
        if (uuid) {
            const playerHeadUrl = `https://minecraftservery.eu/avatar/${uuid}/24`;
            const imgId = `player-head-${player.replace(/\s+/g, '-')}-${Date.now()}`;
            tableHtml += `<div class="table-player-name">
                            <img id="${imgId}"
                                 src="${playerHeadUrl}"
                                 class="table-player-head"
                                 alt="${player}"
                                 onerror="handleImageError(this, '${uuid}', '${player}');">`;

            // Add rank before player name
            if (rankHtml) {
                tableHtml += `<span class="rank-prefix">${rankHtml}</span>`;
            }

            // Add colored player name
            tableHtml += `<span class="${rankColorClass}">${player}</span>`;
            tableHtml += '</div>';
        } else if (uuid === null) {
            console.log(`UUID not found for ${player}, showing default head`);
            const defaultHeadUrl = `https://minotar.net/helm/char/24.png`;
            tableHtml += `<div class="table-player-name">
                            <img src="${defaultHeadUrl}" class="table-player-head" alt="${player}">`;

            // Add rank before player name
            if (rankHtml) {
                tableHtml += `<span class="rank-prefix">${rankHtml}</span>`;
            }

            // Add colored player name
            tableHtml += `<span class="${rankColorClass}">${player}</span>`;
            tableHtml += '</div>';
        } else {
            console.log(`Still fetching UUID for ${player}`);
            tableHtml += `<div class="table-player-name">
                            <div class="table-loading-head"></div>`;

            // Add rank before player name
            if (rankHtml) {
                tableHtml += `<span class="rank-prefix">${rankHtml}</span> `;
            }

            // Add colored player name
            tableHtml += `<span class="${rankColorClass}">${player}</span>`;
            tableHtml += '</div>';
        }
        tableHtml += '</td>';

        // Stats columns (using actual stats data)
        // Get player stats if available
        const playerStats = window.playerStats ? window.playerStats.get(player) : null;

        // Wins column
        const wins = playerStats && playerStats.Wins !== undefined ? playerStats.Wins : '0';
        tableHtml += `<td>${wins}</td>`;

        // Wins DE column
        const winsDE = playerStats && playerStats['Wins DE'] !== undefined ? playerStats['Wins DE'] : '0';
        const pbDE = playerStats && playerStats['PB DE'] !== undefined ? playerStats['PB DE'] : 'N/A';
        const winsDEDisplay = winsDE > 0 && pbDE !== 'N/A' ? `${winsDE} (PB ${pbDE})` : winsDE;
        tableHtml += `<td>${winsDEDisplay}</td>`;

        // Wins BB column
        const winsBB = playerStats && playerStats['Wins BB'] !== undefined ? playerStats['Wins BB'] : '0';
        const pbBB = playerStats && playerStats['PB BB'] !== undefined ? playerStats['PB BB'] : 'N/A';
        const winsBBDisplay = winsBB > 0 && pbBB !== 'N/A' ? `${winsBB} (PB ${pbBB})` : winsBB;
        tableHtml += `<td>${winsBBDisplay}</td>`;

        // Wins PR column (now correctly referring to Wins PR/Prison)
        const winsPR = playerStats && playerStats['Wins PR'] !== undefined ? playerStats['Wins PR'] : '0';
        const pbPR = playerStats && playerStats['PB PR'] !== undefined ? playerStats['PB PR'] : 'N/A';
        const winsPRDisplay = winsPR > 0 && pbPR !== 'N/A' ? `${winsPR} (PB ${pbPR})` : winsPR;
        tableHtml += `<td>${winsPRDisplay}</td>`;

        // Best AA column - if player reached round 105, show AA wins instead
        let bestAA = playerStats && playerStats['Best AA'] !== undefined ? playerStats['Best AA'] : '0';
        let bestAADisplay = bestAA;
        // Get AA wins and PB time
        const winsAA = playerStats && playerStats['Wins AA'] !== undefined ? playerStats['Wins AA'] : '0';
        const pbAA = playerStats && playerStats['PB AA'] !== undefined ? playerStats['PB AA'] : 'N/A';
        // If player reached round 105, show their AA wins with PB time if they have wins
        if (bestAA === 105) {
            if (winsAA > 0 && pbAA !== 'N/A') {
                bestAADisplay = winsAA + " wins (PB " + pbAA + ")";
            } else {
                bestAADisplay = winsAA + " wins";
            }
        } else {
            bestAADisplay = "round " + bestAA;
        }
        tableHtml += `<td>${bestAADisplay}</td>`;

        // Accuracy column
        const accuracy = playerStats && playerStats.Accuracy !== undefined ? playerStats.Accuracy : '0%';
        tableHtml += `<td>${accuracy}</td>`;

        // End table row
        tableHtml += '</tr>';
    });

    tableBody.innerHTML = tableHtml;

    // Refresh player head images after a short delay
    setTimeout(refreshPlayerHeadImages, 1000);
}

// Function to refresh player head images after a delay
function refreshPlayerHeadImages() {
    console.log('Refreshing player head images');
    const playerHeadImages = document.querySelectorAll('.table-player-head:not(.table-loading-head)');
    playerHeadImages.forEach(img => {
        if (!img.src.includes('8667ba71b85a4004af54457a9734eed7')) {
            const timestamp = Date.now();
            const url = new URL(img.src);
            url.searchParams.set('_', timestamp);
            img.src = url.toString();
            console.log(`Refreshed image: ${img.alt}`);
        }
    });
}

// Function to update the connection status indicator
function updateConnectionStatus(connected, type = 'log', reason = '') {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-text');

    if (statusIndicator && statusText) {
        if (connected && type === 'log') {
            // Log connection is good
            statusIndicator.classList.remove('offline');
            statusIndicator.classList.add('online');
            statusText.textContent = 'Connected';
            statusText.title = 'Log file monitoring active';
        } else if (connected && type === 'api') {
            // API connection is good
            statusIndicator.classList.remove('offline');
            statusIndicator.classList.add('online');
            statusText.textContent = 'API Connected';
            statusText.title = 'Hypixel API key valid';
        } else {
            // Disconnected
            statusIndicator.classList.remove('online');
            statusIndicator.classList.add('offline');

            if (type === 'api' && reason) {
                statusText.textContent = 'API Error';
                statusText.title = `API Error: ${reason}`;
            } else {
                statusText.textContent = 'Disconnected';
                statusText.title = 'Log file monitoring inactive';
            }
        }
    }
}