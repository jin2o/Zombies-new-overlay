const { McAPI, HypixelAPI } = require('./api.js');

class PlayerDataFetcher {
    constructor(apiKey) {
        this.mcAPI = new McAPI();
        this.hypixelAPI = new HypixelAPI(apiKey);
    }

    /**
     * Get player UUID from Mojang API
     * @param {string} playerName - The player's name
     * @returns {Promise<string|null>} - Player UUID or null if not found
     */
    async getPlayerUUID(playerName) {
        try {
            return await this.mcAPI.getUuid(playerName);
        } catch (error) {
            console.error(`Error getting UUID for ${playerName}:`, error.message);
            return null;
        }
    }

    /**
     * Get player rank and stats from Hypixel API
     * @param {string} player - The player's name
     * @returns {Promise<Object>} - Player information object
     */
    async getPlayerRank(player) {
        const playerInfo = {
            "Player": player,
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
            const playerUUID = await this.getPlayerUUID(player);
            if (playerUUID === null) {
                console.log(`UUID not found for player ${player}`);
                return playerInfo;
            }

            const data = await this.hypixelAPI.getPlayer(playerUUID);
            if (data.error) {
                console.error(`Error fetching data for player ${player}:`, data.error);
                return playerInfo;
            }

            if (data.success) {
                const playerData = data.player;
                const rank = this.getRank(playerData);

                // Set player name with rank prefix
                if (playerData.monthlyPackageRank === "SUPERSTAR") {
                    playerInfo["Player"] = "[MVP++] " + player;
                } else if (rank === "MVP_PLUS") {
                    playerInfo["Player"] = "[MVP+] " + player;
                } else if (rank === "[MVP]") {
                    playerInfo["Player"] = "[MVP] " + player;
                } else if (rank === "VIP_PLUS") {
                    playerInfo["Player"] = "[VIP+] " + player;
                } else if (rank === "VIP") {
                    playerInfo["Player"] = "[VIP] " + player;
                }

                // Get Arcade stats (Zombies mode)
                const arcadeStats = playerData.stats?.Arcade || {};

                // Calculate accuracy in percentage
                const bulletsHit = arcadeStats.bullets_hit_zombies || 0;
                const bulletsShot = arcadeStats.bullets_shot_zombies || 0;
                const accuracy = bulletsShot !== 0 ? (bulletsHit / bulletsShot) * 100 : 0;
                playerInfo["Accuracy"] = bulletsShot !== 0 ? `${accuracy.toFixed(2)}%` : "N/A";

                // Calculate K/D Ratio
                const kills = arcadeStats.zombie_kills_zombies || 0;
                const deaths = arcadeStats.deaths_zombies || 0;
                const kdr = deaths !== 0 ? Math.round((kills / deaths) * 100) / 100 : kills;
                playerInfo["K/D Ratio"] = kdr;

                // Set basic stats
                playerInfo["Kills"] = kills;
                playerInfo["Deaths"] = deaths;
                playerInfo["Wins"] = arcadeStats.wins_zombies || 0;
                playerInfo["Wins BB"] = arcadeStats.wins_zombies_badblood || 0;
                playerInfo["Wins DE"] = arcadeStats.wins_zombies_deadend || 0;
                playerInfo["Wins AA"] = arcadeStats.wins_zombies_alienarcadium || 0;
                playerInfo["Wins PR"] = arcadeStats.wins_zombies_prison || 0;
                playerInfo["Best AA"] = arcadeStats.best_round_zombies_alienarcadium || 0;

                // Get PB times
                playerInfo["PB DE"] = this.getPBDE(playerData);
                playerInfo["PB BB"] = this.getPBBB(playerData);
                playerInfo["PB AA"] = this.getPBAA(playerData);
                playerInfo["PB PR"] = this.getPBPR(playerData);
            }
        } catch (error) {
            console.error(`Error while getting information for player ${player}:`, error.message);
        }

        return playerInfo;
    }

    /**
     * Get player rank from player data
     * @param {Object} playerInfo - Player data object
     * @returns {string} - Player rank
     */
    getRank(playerInfo) {
        return playerInfo.newPackageRank || playerInfo.rank || "";
    }

    /**
     * Get PB (Personal Best) time for Dead End map
     * @param {Object} playerData - Player data object
     * @returns {string} - Formatted time or "N/A"
     */
    getPBDE(playerData) {
        return this.getZombiesStats(playerData, "deadend", "normal");
    }

    /**
     * Get PB (Personal Best) time for Bad Blood map
     * @param {Object} playerData - Player data object
     * @returns {string} - Formatted time or "N/A"
     */
    getPBBB(playerData) {
        return this.getZombiesStats(playerData, "badblood", "normal");
    }
    
    /**
     * Get PB (Personal Best) time for Alien Arcadium map
     * @param {Object} playerData - Player data object
     * @returns {string} - Formatted time or "N/A"
     */
    getPBAA(playerData) {
        return this.getZombiesStats(playerData, "alienarcadium", "normal");
    }
    
    /**
     * Get PB (Personal Best) time for Prison map
     * @param {Object} playerData - Player data object
     * @returns {string} - Formatted time or "N/A"
     */
    getPBPR(playerData) {
        return this.getZombiesStats(playerData, "prison", "normal");
    }

    /**
     * Format time from seconds to MM:SS format
     * @param {number} seconds - Time in seconds
     * @returns {string} - Formatted time
     */
    formatTime(seconds) {
        if (seconds === undefined || seconds === null) return "N/A";
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Format time from seconds to HHh:MM format (for AA map)
     * @param {number} seconds - Time in seconds
     * @returns {string} - Formatted time
     */
    formatTimeAA(seconds) {
        if (seconds === undefined || seconds === null) return "N/A";
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h:${minutes.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}`;
        }
    }

    /**
     * Get zombies stats for a specific map and mode
     * @param {Object} data - Player data object
     * @param {string} mapName - Map name (e.g., "deadend", "badblood")
     * @param {string} mode - Game mode (e.g., "normal")
     * @returns {string} - Formatted time or "N/A"
     */
    getZombiesStats(data, mapName, mode) {
        const key = `fastest_time_30_zombies_${mapName.toLowerCase()}_${mode}`;
        const timeInSeconds = data.stats?.Arcade?.[key];
        // Use formatTimeAA for AA map, formatTime for others
        if (mapName.toLowerCase() === "alienarcadium") {
            return timeInSeconds !== undefined ? this.formatTimeAA(timeInSeconds) : "N/A";
        } else {
            return timeInSeconds !== undefined ? this.formatTime(timeInSeconds) : "N/A";
        }
    }

    /**
     * Divide two numbers, handling division by zero
     * @param {number} a - Dividend
     * @param {number} b - Divisor
     * @returns {number} - Result of division or 0 if divisor is 0
     */
    divide(a, b) {
        return b !== 0 ? a / b : 0;
    }
}

module.exports = PlayerDataFetcher;