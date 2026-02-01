
const fetch = require("node-fetch"),
    sha1 = require("sha1"),
    fs = require("fs").promises,
    path = require("path"),
    { app } = require("electron")

class McAPI {
    constructor() {
        // Cache for UUID lookups to avoid repeated API calls
        this.uuidCache = new Map()
        // Cache expiration time (5 minutes)
        this.cacheExpiry = 5 * 60 * 1000
    }

    getStatus = async () => {
        const res = await fetch("https://status.mojang.com/check")

        const body = await res.text()
        let json = {}

        if (res.status == 200) {
            json = JSON.parse(body)
        }

        return { status: res.status, text: body, json }
    }

    getUuid = async (username) => {
        // Check cache first
        const cached = this.uuidCache.get(username)
        if (cached) {
            const now = Date.now()
            if (now - cached.timestamp < this.cacheExpiry) {
                return cached.uuid
            } else {
                // Remove expired cache entry
                this.uuidCache.delete(username)
            }
        }

        try {
            const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`)

            if (res.status === 200) {
                const json = await res.json()
                // Use the UUID directly without formatting
                if (json.id) {
                    // Cache the result
                    this.uuidCache.set(username, {
                        uuid: json.id,
                        timestamp: Date.now()
                    })
                    return json.id
                }
                return null
            } else if (res.status === 204) {
                // No content - player not found
                console.warn(`Player not found: ${username}`)
                // Cache the null result to avoid repeated requests
                this.uuidCache.set(username, {
                    uuid: null,
                    timestamp: Date.now()
                })
                return null
            } else {
                // Other error
                console.error(`Failed to fetch UUID for ${username}: ${res.status} ${res.statusText}`)
                return null
            }
        } catch (error) {
            console.error(`Error fetching UUID for ${username}:`, error.message)
            return null
        }
    }


    getHistory = async (uuid) => {
        const res = await fetch(`https://api.mojang.com/user/profiles/${uuid}/names`)

        const body = await res.text()
        let json = {}

        if (res.status == 200) {
            json = JSON.parse(body)
        }

        return json
    }

    getProfile = async (uuid) => {
        const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`)

        const body = await res.text()
        let json = {}

        if (res.status == 200) {
            try {
                json = JSON.parse(body)
            } catch {

            }
        }

        try {
            const texture = JSON.parse(Buffer.from(json.properties[0].value, "base64").toString("utf8"))
            const skinUrl = texture.textures.SKIN
            const capeUrl = texture.textures.CAPE

            let cape = undefined
            let skin = undefined
            let skinHash = undefined
            let capeHash = undefined

            if (skinUrl) {
                const skinRes = await fetch(skinUrl.url)

                skin = await skinRes.buffer()
                skinHash = sha1(skin)
            }

            if (capeUrl) {
                const capeRes = await fetch(capeUrl.url)

                cape = await capeRes.buffer()
                capeHash = sha1(cape)
            }

            if (cape && skin) {
                return { id: json.id, name: json.name, properties: json.properties, texture, cape, capeHash, skin, skinHash, success: true }
            } else if (skin) {
                return { id: json.id, name: json.name, properties: json.properties, texture, skin, skinHash, success: true }
            } else if (cape) {
                return { id: json.id, name: json.name, properties: json.properties, texture, cape, capeHash, success: true }
            } else {
                return { id: json.id, name: json.name, properties: json.properties, texture, cape, capeHash, skin, skinHash, success: true }
            }
        } catch {
            return { success: false }
        }
    }
}

class HypixelAPI {
    constructor(key) {
        this.key = key || null;
        // Cache for player data to avoid repeated API calls
        this.playerCache = new Map();
        // Cache expiration time (5 minutes)
        this.cacheExpiry = 5 * 60 * 1000;
        // Rate limiting - minimum delay between requests (100ms)
        this.minRequestDelay = 100;
        this.lastRequestTime = 0;
        // Track rate limit info from headers
        this.rateLimitRemaining = null;
        this.rateLimitReset = null;
    }

    // Method to load API key from file
    async loadApiKeyFromFile() {
        if (!this.key) {
            this.key = await loadApiKey();
        }
        return this.key;
    }

    // Sleep helper for throttling
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Throttle requests to avoid hitting rate limits
    async throttle() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestDelay) {
            const waitTime = this.minRequestDelay - timeSinceLastRequest;
            console.log(`[RateLimiter] Waiting ${waitTime}ms before next request`);
            await this.sleep(waitTime);
        }
        this.lastRequestTime = Date.now();
    }

    // Update rate limit info from response headers
    updateRateLimitInfo(headers) {
        const remaining = headers.get('RateLimit-Remaining');
        const reset = headers.get('RateLimit-Reset');
        if (remaining !== null) {
            this.rateLimitRemaining = parseInt(remaining, 10);
            console.log(`[RateLimiter] Remaining requests: ${this.rateLimitRemaining}`);
        }
        if (reset !== null) {
            this.rateLimitReset = parseInt(reset, 10);
            console.log(`[RateLimiter] Reset in: ${this.rateLimitReset}s`);
        }
        // If we're running low on requests, increase delay
        if (this.rateLimitRemaining !== null && this.rateLimitRemaining < 10) {
            console.log(`[RateLimiter] Low on requests, increasing delay`);
            this.minRequestDelay = 500; // Slow down to 500ms between requests
        } else if (this.rateLimitRemaining !== null && this.rateLimitRemaining > 50) {
            this.minRequestDelay = 100; // Normal speed
        }
    }

    getPlayer = async (uuid) => {
        // Check cache first
        const cached = this.playerCache.get(uuid);
        if (cached) {
            const now = Date.now();
            if (now - cached.timestamp < this.cacheExpiry) {
                console.log(`[Cache] Using cached data for UUID ${uuid} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
                return cached.data;
            } else {
                // Remove expired cache entry
                console.log(`[Cache] Expired cache for UUID ${uuid}, fetching fresh data`);
                this.playerCache.delete(uuid);
            }
        }

        await this.loadApiKeyFromFile();

        // Apply throttling before making the request
        await this.throttle();

        try {
            console.log(`[API] Fetching player data for UUID ${uuid}`);
            const res = await fetch(`https://api.hypixel.net/player?key=${this.key}&uuid=${uuid}`)

            // Update rate limit info from headers
            this.updateRateLimitInfo(res.headers);

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 404) {
                return { error: 'PLAYER_NOT_FOUND' };
            } else if (res.status === 429) {
                console.log(`[RateLimiter] Rate limit exceeded! Waiting before retry...`);
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }

                    // Cache the successful response
                    this.playerCache.set(uuid, {
                        data: json,
                        timestamp: Date.now()
                    });
                    console.log(`[Cache] Stored data for UUID ${uuid}`);
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json
        } catch (error) {
            console.error('Error fetching player data:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getGuild = async (uuid) => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/guild?key=${this.key}&player=${uuid}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 404) {
                return { error: 'GUILD_NOT_FOUND' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.guild
        } catch (error) {
            console.error('Error fetching guild data:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getPlayerCount = async () => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/playerCount?key=${this.key}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.playerCount
        } catch (error) {
            console.error('Error fetching player count:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getStatus = async (uuid) => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/status?key=${this.key}&uuid=${uuid}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 404) {
                return { error: 'PLAYER_NOT_FOUND' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.session
        } catch (error) {
            console.error('Error fetching status data:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getLeaderboards = async () => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/leaderboards?key=${this.key}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.leaderboards
        } catch (error) {
            console.error('Error fetching leaderboards:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getRecentGames = async (uuid) => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/recentGames?key=${this.key}&uuid=${uuid}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 404) {
                return { error: 'PLAYER_NOT_FOUND' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.recentGames
        } catch (error) {
            console.error('Error fetching recent games:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getGetWatchdogStats = async () => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/watchdogstats?key=${this.key}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.watchdogstats
        } catch (error) {
            console.error('Error fetching watchdog stats:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getFriends = async (uuid) => {
        await this.loadApiKeyFromFile();
        try {
            const res = await fetch(`https://api.hypixel.net/friends?key=${this.key}&uuid=${uuid}`)

            // Handle different HTTP status codes
            if (res.status === 403) {
                return { error: 'API_KEY_EXPIRED' };
            } else if (res.status === 404) {
                return { error: 'PLAYER_NOT_FOUND' };
            } else if (res.status === 429) {
                return { error: 'RATE_LIMIT_EXCEEDED' };
            } else if (res.status >= 500) {
                return { error: 'HYPIXEL_API_UNAVAILABLE' };
            } else if (res.status !== 200) {
                return { error: `HTTP_ERROR_${res.status}` };
            }

            const body = await res.text()
            let json = {}

            if (res.status == 200) {
                try {
                    json = JSON.parse(body)
                    // Check if Hypixel API returned success: false
                    if (json.success === false) {
                        return { error: json.cause || 'HYPIXEL_API_ERROR' };
                    }
                } catch (parseError) {
                    return { error: 'INVALID_RESPONSE' };
                }
            }

            return json.records
        } catch (error) {
            console.error('Error fetching friends data:', error.message);
            return { error: 'NETWORK_ERROR' };
        }
    }

    getKeyInfo = async () => {
        await this.loadApiKeyFromFile();

        // Add debugging
        console.log('Testing API key:', this.key ? `${this.key.substring(0, 8)}...` : 'null');
        console.log('API key length:', this.key ? this.key.length : 0);

        // Validate API key
        if (!this.key) {
            console.log('API key is null or undefined');
            return {
                success: false,
                cause: 'API key is missing'
            };
        }

        // Check if API key has the expected length (typically 36 characters for UUID-like keys)
        if (this.key.length < 30) {
            console.log('API key appears to be too short');
            return {
                success: false,
                cause: 'API key appears to be invalid (too short)'
            };
        }

        // Check for any special characters that might cause issues
        if (this.key.includes(' ') || this.key.includes('\n') || this.key.includes('\r')) {
            console.log('API key contains invalid characters (spaces or newlines)');
            return {
                success: false,
                cause: 'API key contains invalid characters'
            };
        }

        try {
            // Use AbortController for timeout instead of unsupported timeout option
            const controller = new AbortController();
            const timeout = setTimeout(() => {
                controller.abort();
            }, 10000); // 10 second timeout

            // Use the playerCount endpoint to validate the API key
            const url = `https://api.hypixel.net/playerCount?key=${this.key}`;
            console.log('API key test URL:', url);

            const res = await fetch(url, {
                signal: controller.signal
            });

            console.log('API key test fetch completed');
            console.log('API key test response object:', res);

            // Clear timeout if request completes
            clearTimeout(timeout);

            // Add debugging for response
            console.log('API key test response status:', res.status);
            console.log('API key test response headers:', [...res.headers.entries()]);

            const body = await res.text();
            console.log('API key test response body:', body);
            console.log('API key test response body length:', body.length);

            // Handle different HTTP status codes
            if (res.status === 400) {
                console.log('API key test failed: Invalid API key format');
                return {
                    success: false,
                    cause: 'Invalid API key format'
                };
            } else if (res.status === 403) {
                console.log('API key test failed: Invalid API key');
                return {
                    success: false,
                    cause: 'Invalid API key'
                };
            } else if (res.status === 429) {
                console.log('API key test failed: Rate limit exceeded');
                return {
                    success: false,
                    cause: 'Rate limit exceeded. Please try again later.'
                };
            } else if (res.status >= 500) {
                console.log('API key test failed: Hypixel API unavailable');
                return {
                    success: false,
                    cause: 'Hypixel API is currently unavailable. Please try again later.'
                };
            } else if (res.status !== 200) {
                console.log('API key test failed: HTTP Error', res.status);
                return {
                    success: false,
                    cause: `HTTP Error: ${res.status}`
                };
            }

            // Try to parse JSON response
            try {
                console.log('Attempting to parse JSON response');
                const json = JSON.parse(body);
                console.log('JSON parsed successfully:', json);

                // Check if the response indicates success
                if (json.success === true) {
                    // Return a success response that matches the expected format
                    return {
                        success: true,
                        record: {
                            key: this.key,
                            owner: 'Unknown', // We don't have owner info from playerCount endpoint
                            limit: 120, // Default rate limit
                            requestsInPastMin: 0 // We don't have this info from playerCount endpoint
                        }
                    };
                } else {
                    // If success is false, return the error
                    return {
                        success: false,
                        cause: json.cause || 'Invalid API key'
                    };
                }
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
                console.log('Response body that failed to parse:', body);
                return {
                    success: false,
                    cause: 'Invalid response from Hypixel API'
                };
            }
        } catch (error) {
            // Handle network errors, timeouts, etc.
            console.error('API key test failed with error:', error);
            return {
                success: false,
                cause: error.message || 'Connection failed'
            };
        }
    }
}

// Function to get the path for storing user data
function getUserDataPath() {
    // This will work in the main process, but we need a different approach for the renderer
    try {
        return path.join(app.getPath('userData'), 'hypixel-api-key.txt');
    } catch (error) {
        // Fallback for renderer process
        return path.join(require('os').homedir(), '.cubelify', 'hypixel-api-key.txt');
    }
}

// Function to load API key from file
async function loadApiKey() {
    const userDataPath = getUserDataPath();
    try {
        if (await fs.access(userDataPath).then(() => true).catch(() => false)) {
            const key = await fs.readFile(userDataPath, 'utf8');
            console.log('API key loaded successfully');
            return key.trim();
        }
        return null;
    } catch (error) {
        console.error('Failed to load API key:', error.message);
        return null;
    }
}

module.exports = {
    McAPI: McAPI,
    HypixelAPI: HypixelAPI,
    loadApiKey: loadApiKey
}