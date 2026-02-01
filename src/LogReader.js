"use strict"

const EventEmitter = require("events")
const fs = require("fs")

class LogReader extends EventEmitter {
    path
    constructor(path) {
        super()

        this.path = path
        this.watch()
    }

    watch = () => {
        let lastLog = []
        fs.watchFile(this.path, {persistent: true, interval: 4}, (curr, prev) => {
            const logFile = fs.readFileSync(this.path, {encoding: "utf8"})

            const logs = logFile.split("\n").filter(line => line.trim() !== "")
            
            console.log(`Log file changed. Previous lines: ${lastLog.length}, Current lines: ${logs.length}`);

            // Handle empty or reset file
            if (logs.length === 0 && lastLog.length > 0) {
                console.log("Log file is empty or reset");
                this.emit("reset")
                lastLog = []
                return
            }

            // Determine changed logs for this specific file change event
            let changedLogs = []
            
            // On first run, just initialize lastLog without processing any entries
            if (lastLog.length === 0) {
                lastLog = [...logs]
                console.log("Log reader initialized, monitoring new entries only");
                return
            }
            
            // Check if file has been reset (significantly reduced size)
            if (logs.length < lastLog.length * 0.5 && logs.length < 10) {
                console.log("Log file reset detected");
                this.emit("reset")
                lastLog = logs
                return
            }
            
            // Find new lines (those added compared to previous state)
            if (logs.length >= lastLog.length) {
                console.log(`Found ${logs.length - lastLog.length} new lines`);
                // Add only new lines
                for (let i = lastLog.length; i < logs.length; i++) {
                    changedLogs.push(logs[i])
                }
            }

            lastLog = [...logs]
            
            console.log(`Processing ${changedLogs.length} changed logs`);

            // Process each changed log line
            for (const latestLog of changedLogs) {
                console.log(`Processing log line: ${latestLog}`);
                if (/\[[^]*\] \[Client thread\/INFO\]: \[CHAT\] [^]*/.test(latestLog)) {
                    const message = latestLog.split("[CHAT] ")[1].trim()
                    console.log(`Extracted chat message: ${message}`);

                    // Check if message is empty or only spaces
                    if (message.trim() === '' || message.trim() === '-') {
                        this.emit("reset")
                        continue
                    }

                    // Handle server change
                    if (/Sending you to (.*)!/.test(message)) {
                        console.log(message)
                        this.emit("reset")
                        this.emit("server_change")
                        continue
                    }

                    // Handle clear command
                    if (/(.*): -clear/.test(message)) {
                        this.emit("reset")
                        this.emit("server_change")
                        continue
                    }
                    
                    // Handle -clear command (without prefix)
                    if (message === "-clear" || message === "-c") {
                        this.emit("reset")
                        this.emit("server_change")
                        continue
                    }

                    // Handle new ONLINE list (reset before adding)
                    if (/ONLINE: (.*?)/.test(message)) {
                        this.emit("reset")
                        this.emit("server_change")

                        // Extract the player list part and remove any trailing [number] pattern from mod
                        let playerList = message.split("ONLINE:")[1].trim();
                        // Remove any trailing [number] pattern that indicates duplicate count from mod
                        playerList = playerList.replace(/\s*\[\d+\]$/, '');
                        
                        // Split by comma to get individual player names
                        const players = playerList.split(",");
                        for (const player of players) {
                            const name = player.trim().replace(',', '');
                            // Skip empty names
                            if (name !== '') {
                                this.emit("join", name)
                            }
                        }
                        continue
                    }

                    // Handle single player join (standard format)
                    if (/(.*) joined \((\d)\/(\d)\)!/.test(message)) {
                        const name = message.split(" ")[0]
                        // Skip names that match the pattern [number]
                        if (!/^\[\d+\]$/.test(name)) {
                            console.log(`PLAYER JOIN DETECTED (standard format): ${name}`);
                            console.log(`Emitting join event for player: ${name}`);
                            this.emit("join", name)
                        }
                        continue
                    }
                    
                    // Handle single player join (alternative format: "player has joined")
                    // This handles cases like "player1 has joined" or "PlayerName has joined"
                    if (/(.+) has joined/.test(message)) {
                        // Extract player name from message like "player1 has joined"
                        const match = message.match(/(.+) has joined/);
                        if (match && match[1]) {
                            const name = match[1].trim();
                            // Skip names that match the pattern [number]
                            if (!/^\[\d+\]$/.test(name)) {
                                console.log(`PLAYER JOIN DETECTED (alternative format): ${name}`);
                                console.log(`Emitting join event for player: ${name}`);
                                this.emit("join", name);
                            }
                        }
                        continue;
                    }

                    // Handle -s command (specific addition)
                    if (/(.*): -s (.*?)/.test(message)) {
                        const name = message.split("-s ")[1]
                        if (name && name.trim() !== '') {
                            const trimmedName = name.trim();
                            // Skip names that match the pattern [number]
                            if (!/^\[\d+\]$/.test(trimmedName)) {
                                this.emit("join", trimmedName)
                            }
                        }
                        continue
                    }

                    // Handle failed attempts (should not add players)
                    if (/Can't find a player by the name of 'c'/.test(message)) {
                        // Ignore, not a relevant event
                        continue
                    }
                    
                    // Handle "Can't find a player by the name of" messages
                    if (/Can't find a player by the name of '(.+?)'/.test(message)) {
                        const match = message.match(/Can't find a player by the name of '(.+?)'/);
                        if (match && match[1]) {
                            // Remove any special characters at the end of player name
                            let playerName = match[1].trim();
                            
                            // Remove exclamation mark at the end if present
                            if (playerName.endsWith('!')) {
                                playerName = playerName.slice(0, -1);
                            }
                            
                            // Skip names that match the pattern [number]
                            if (/^\[\d+\]$/.test(playerName)) {
                                continue;
                            }
                            
                            // If player name is a special command, emit reset
                            if (playerName === '-clear' || playerName === '-c') {
                                this.emit("reset");
                                this.emit("server_change");
                            } else {
                                // Otherwise add player to list as normal player
                                this.emit("join", playerName);
                            }
                        }
                        continue;
                    }

                    if (/Can't find a player by the name of (.*?)-/.test(message)) {
                        const name = message.split("name of ")[1]
                        this.emit("leave", name.slice(1, -2)) // remove the '-'
                        continue
                    }

                    // Handle various quit/leave events
                    if (/(.*) has quit!/.test(message)) {
                        const name = message.split(" ")[0]
                        console.log(`Emitting leave event for player: ${name}`);
                        this.emit("leave", name)
                        continue
                    }

                    if (/(.*) left\./.test(message)) {
                        const name = message.split(" ")[0]
                        this.emit("leave", name)
                        continue
                    }

                    if (/(.*) was slain by .*/.test(message)) {
                        const name = message.split(" ")[0]
                        this.emit("leave", name)
                        continue
                    }

                    if (/(.*) fell out of the world.*/.test(message)) {
                        const name = message.split(" ")[0]
                        this.emit("leave", name)
                        continue
                    }

                    if (/(.*) disconnected\./.test(message)) {
                        const name = message.split(" ")[0]
                        this.emit("leave", name)
                        continue
                    }
                }
            }
        })
    }
}

module.exports = LogReader