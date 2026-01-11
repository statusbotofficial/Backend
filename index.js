import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Data persistence directory
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Bot stats storage
let botStats = {
    servers: 0,
    ping: 0,
    status: "offline",
    lastUpdated: null
};

// Server data storage (members, premium status, tracked users, leaderboards)
let serverData = {};

// Server channels storage
let serverChannels = {};

// Premium data cache (populated by bot)
let premiumCache = {};

// Known users who have logged into the website (for "send to all" distribution)
let knownUsers = {};

function loadKnownUsers() {
    try {
        const usersPath = path.join(__dirname, 'known_users.json');
        if (fs.existsSync(usersPath)) {
            knownUsers = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        }
    } catch (err) {
        console.log('Known users file not found, starting fresh');
        knownUsers = {};
    }
}

function saveKnownUsers() {
    try {
        const usersPath = path.join(__dirname, 'known_users.json');
        fs.writeFileSync(usersPath, JSON.stringify(knownUsers, null, 4));
    } catch (err) {
        console.error('Error saving known users:', err);
    }
}

function trackUser(userId) {
    if (!knownUsers[userId]) {
        knownUsers[userId] = { loginCount: 0, lastLogin: null };
    }
    knownUsers[userId].loginCount++;
    knownUsers[userId].lastLogin = new Date().toISOString();
    saveKnownUsers();
}

loadKnownUsers();

const SYSTEM_PROMPT = `
You are the official AI support assistant for the Status Bot Discord bot.

GOAL:
Help users quickly and clearly with Status Bot questions.

RESPONSE STYLE:
- Friendly, calm, and professional
- Short and easy to understand (1–3 sentences)
- Avoid technical jargon
- Do not repeat the user's question
- When referencing links, integrate them naturally in the sentence using HTML <a> tags.
  Example: "Join our <a href='https://discord.gg/Kd2MckVxED'>Support Server</a>."

RULES:
- Only use the information listed below
- Do NOT invent commands, features, or policies
- If unsure, say so and direct the user to the <a href='https://discord.gg/Kd2MckVxED'>support server</a>
- Never mention internal systems, APIs, tokens, code, files, or moderation processes
- Never claim access to private data or user information

SAFETY:
- If a message contains harassment, slurs, or harmful intent, respond calmly, refuse to engage, and encourage respectful behavior
- Redirect users to proper support if needed

KNOWN INFORMATION:
- <a href="https://discord.gg/Kd2MckVxED">Support server</a>
- <a href="https://discord.com/api/oauth2/authorize?client_id=1436123870158520411&permissions=8&scope=bot%20applications.commands">Invite link</a>
- <a href="https://status-bot.xyz">Website</a>
- <a href="https://status-bot.xyz/">Home page</a>
- <a href="https://status-bot.xyz/commands">Commands page</a>
- <a href="https://status-bot.xyz/premium">Premium page</a>
- <a href="https://status-bot.xyz/support">Support page</a>
- <a href="https://status-bot.xyz/status">Status page</a>
- <a href="https://status-bot.xyz/servers">Dashboard</a>
- <a href="https://status-bot.xyz/terms">Terms & Conditons</a>
- <a href="https://status-bot.xyz/privacy">Privacy policy</a>
- Dashboard is where the bot can be setup or change settings

PRIMARY SUPPORT:
Most help is provided through the Discord support server.
You are a helpful backup if staff are unavailable.

LANGUAGES:
You may translate or reply in other languages if the user requests it.
`;

app.use(cors({
    origin: [
        "https://status-bot.xyz",
        "https://www.status-bot.xyz",
        "https://status-bot-website.netlify.app"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "1mb" }));

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.options("*", cors());

app.post("/api/support/ai", async (req, res) => {
    try {
        const message = req.body?.message?.trim();

        if (!message || message.length > 500) {
            return res.status(400).json({
                reply: "Please enter a valid message under 500 characters."
            });
        }

        const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            temperature: 0.7,
            messages: [
                {
                    role: "system",
                    content: SYSTEM_PROMPT
                },
                {
                    role: "user",
                    content: message
                }
            ]
        });

        const reply =
            completion?.choices?.[0]?.message?.content ??
            "I'm not sure how to help with that. Please join the support Discord.";

        res.json({ reply });

    } catch (err) {
        console.error("AI error:", err);
        res.status(500).json({
            reply: "Something went wrong. Please try again later or join the support Discord."
        });
    }
});

app.get("/", (_, res) => {
    res.send("Status Bot Support API is running.");
});

// Endpoint for bot to POST stats
app.post("/api/bot-stats/update", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify the request is from your bot
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { servers, ping, guildIds, uptime } = req.body;

    botStats = {
        servers: servers || 0,
        ping: ping || 0,
        status: "online",
        guildIds: guildIds || [],
        uptime: uptime || 0,
        lastUpdated: new Date().toISOString()
    };

    res.json({ success: true, message: "Stats updated" });
});

// Endpoint for frontend to GET stats
app.get("/api/bot-stats", (_, res) => {
    res.json(botStats);
});

// Endpoint to get all bot guilds
app.get("/api/bot-guilds", (req, res) => {
    // This endpoint returns the list of servers the bot is in
    // The actual guild data is updated by the bot via the stats endpoint
    res.json({ 
        guilds: botStats.guildIds || []
    });
});

// Endpoint to check if a user has premium (user-specific)
app.get("/api/user-premium/:userId", (req, res) => {
    const { userId } = req.params;
    
    try {
        let hasPremium = false;
        let expiryDate = null;
        
        // First check the premium cache (populated by bot)
        if (premiumCache[userId]) {
            const userPremiumInfo = premiumCache[userId];
            if (userPremiumInfo.active === true) {
                if (!userPremiumInfo.expiry || Date.now() / 1000 < userPremiumInfo.expiry) {
                    hasPremium = true;
                    expiryDate = userPremiumInfo.expiry ? new Date(userPremiumInfo.expiry * 1000).toISOString() : null;
                }
            }
        } else {
            // Fallback: Read premium data from file (for backward compatibility)
            const premiumDataPath = path.join(__dirname, 'premium_data.json');
            let premiumData = {};
            
            if (fs.existsSync(premiumDataPath)) {
                const rawData = fs.readFileSync(premiumDataPath, 'utf8');
                premiumData = JSON.parse(rawData);
            }
            
            // Check if user has premium
            const userPremiumInfo = premiumData[userId];
            if (userPremiumInfo) {
                // Check if premium is active
                if (userPremiumInfo.active === true) {
                    // Check if not expired
                    if (!userPremiumInfo.expiry || Date.now() / 1000 < userPremiumInfo.expiry) {
                        hasPremium = true;
                        expiryDate = userPremiumInfo.expiry ? new Date(userPremiumInfo.expiry * 1000).toISOString() : null;
                    }
                }
            }
        }
        
        res.json({ 
            userId: userId,
            hasPremium: hasPremium,
            expiryDate: expiryDate
        });
    } catch (error) {
        console.error('Error checking user premium:', error);
        res.json({ 
            userId: userId,
            hasPremium: false,
            expiryDate: null,
            error: 'Error reading premium data'
        });
    }
});

// Endpoint to get server overview data
app.get("/api/server-overview/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}` && !req.query.token) {
        // For now, return mock data if not authorized - in production, verify Discord token
        const mockData = serverData[guildId] || {
            memberCount: 0,
            userHasPremium: false,
            trackedUser: null,
            topUsers: [],
            allUsers: []
        };
        return res.json(mockData);
    }

    const overview = serverData[guildId] || {
        memberCount: 0,
        userHasPremium: false,
        trackedUser: null,
        topUsers: [],
        allUsers: []
    };

    res.json(overview);
});

// Endpoint to get full server leaderboard
app.get("/api/server-leaderboard/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}` && !req.query.token) {
        // For now, return mock data if not authorized
        const mockData = serverData[guildId] || {
            allUsers: []
        };
        return res.json(mockData);
    }

    const leaderboard = serverData[guildId] || {
        allUsers: []
    };

    res.json(leaderboard);
});

// Endpoint for bot to POST server data
app.post("/api/server-data/update", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify the request is from your bot
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { guildId, memberCount, isPremium, trackedUser, topUsers, allUsers } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    serverData[guildId] = {
        memberCount: memberCount || 0,
        userHasPremium: false,
        trackedUser: trackedUser || null,
        topUsers: topUsers || [],
        allUsers: allUsers || [],
        lastUpdated: new Date().toISOString()
    };

    res.json({ success: true, message: "Server data updated" });
});

// Endpoint for bot to sync premium data
app.post("/api/premium-data/sync", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify the request is from your bot
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { premiumData } = req.body;

    if (!premiumData) {
        return res.status(400).json({ error: "premiumData is required" });
    }

    // Update premium cache with all data from bot
    premiumCache = premiumData;
    
    res.json({ success: true, message: "Premium data synced" });
});

// ============ CHANNEL ENDPOINTS ============

// Get channels for a guild
app.get("/api/channels/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const channels = serverChannels[guildId] || [];
    res.json({ guildId, channels });
});

// Update channels for a guild (bot sends this)
app.post("/api/channels/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { channels } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    serverChannels[guildId] = channels || [];

    res.json({ 
        success: true, 
        message: "Channels updated",
        channels: serverChannels[guildId]
    });
});

// ============ USER RESOLUTION ENDPOINT ============

// Resolve a user reference (mention, username, or ID) to a Discord user ID
app.post("/api/resolve-user/:guildId", (req, res) => {
    const { guildId } = req.params;
    const { userReference } = req.body;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!userReference) {
        return res.status(400).json({ error: "userReference is required" });
    }

    try {
        let userId = null;
        const ref = userReference.trim();
        
        // Check if it's a mention like <@123456789>
        const mentionMatch = ref.match(/<@!?(\d+)>/);
        if (mentionMatch) {
            userId = mentionMatch[1];
        } 
        // Check if it's a numeric ID
        else if (/^\d+$/.test(ref)) {
            userId = ref;
        }
        // Check if it's @username or just username - simple fallback
        else if (ref.startsWith('@')) {
            // For now, ask user to use numeric ID since we can't access guild members from backend
            return res.status(400).json({ 
                error: "Username resolution unavailable",
                message: "Please use a numeric user ID or copy a proper Discord mention (right-click user > Copy User ID)"
            });
        } 
        // Plain username without @
        else if (/^[a-zA-Z0-9_]+$/.test(ref)) {
            // For now, ask user to use numeric ID since we can't access guild members from backend
            return res.status(400).json({ 
                error: "Username resolution unavailable",
                message: "Please use a numeric user ID or copy a proper Discord mention (right-click user > Copy User ID)"
            });
        }
        else {
            return res.status(400).json({ 
                error: "Invalid user reference",
                message: "Please use a Discord user mention format <@username> or numeric user ID"
            });
        }

        res.json({ 
            success: true, 
            userId: userId,
            userReference: ref
        });
    } catch (err) {
        console.error('Error resolving user:', err);
        res.status(500).json({ error: "Failed to resolve user", details: err.message });
    }
});

// Cache for guild members (with TTL of 5 minutes)
let guildMembersCache = {};
const MEMBERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Retry function with exponential backoff
async function fetchWithRetry(url, options, maxRetries = 5) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            
            // If it's a rate limit error, wait and retry
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || (Math.pow(2, attempt + 1) * 1000);
                const delayMs = parseInt(retryAfter);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            
            // If successful, return response
            if (response.ok) {
                return response;
            }
            
            // Other errors, just return the response
            return response;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt + 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError || new Error('Max retries exceeded');
}

// Get guild members list
app.get('/api/guild/:guildId/members', async (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        // Check if members are cached and cache is still valid
        if (guildMembersCache[guildId] && Date.now() - guildMembersCache[guildId].timestamp < MEMBERS_CACHE_TTL) {
            console.log(`✅ Returning cached members for guild ${guildId}`);
            return res.json({ members: guildMembersCache[guildId].data });
        }

        // Query Discord API to get guild members with retry logic
        const response = await fetchWithRetry(
            `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,
            {
                headers: {
                    'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
                }
            }
        );

        if (!response.ok) {
            console.error(`Discord API returned ${response.status} for guild ${guildId}`);
            return res.status(response.status).json({ error: "Failed to fetch guild members" });
        }

        const members = await response.json();
        
        // Map members to id and username
        const memberList = members.map(member => ({
            id: member.user.id,
            username: member.user.username,
            displayName: member.nick || member.user.username
        }));

        // Cache the members
        guildMembersCache[guildId] = {
            data: memberList,
            timestamp: Date.now()
        };

        res.json({ members: memberList });
    } catch (err) {
        console.error('Error fetching guild members:', err);
        res.status(500).json({ error: "Failed to fetch guild members", details: err.message });
    }
});

// ============ LEVELING SYSTEM ENDPOINTS ============

// Get leveling settings for a guild
app.get("/api/leveling/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // Initialize global storage if needed
    if (!global.levelingSettings) {
        global.levelingSettings = {};
    }

    // Return stored settings or defaults if not stored
    const defaultSettings = {
        enabled: false,
        xp_per_message: 10,
        vc_xp_per_minute: 2,
        level_up_message: "🎉 {user} has reached Level **{level}**!",
        level_up_channel: null,
        allowed_xp_channels: []
    };

    const settings = global.levelingSettings[guildId] || defaultSettings;
    res.json(settings);
});

// Save leveling settings for a guild
app.post("/api/leveling/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { enabled, xp_per_message, vc_xp_per_minute, level_up_message, level_up_channel, allowed_xp_channels } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    // Store settings in memory (in production, use a database)
    if (!global.levelingSettings) {
        global.levelingSettings = {};
    }

    global.levelingSettings[guildId] = {
        enabled: enabled || false,
        xp_per_message: xp_per_message || 10,
        vc_xp_per_minute: vc_xp_per_minute || 2,
        level_up_message: level_up_message || "🎉 {user} has reached Level **{level}**!",
        level_up_channel: level_up_channel || null,
        allowed_xp_channels: allowed_xp_channels || [],
        lastUpdated: new Date().toISOString()
    };

    res.json({ 
        success: true, 
        message: "Leveling settings saved", 
        settings: global.levelingSettings[guildId] 
    });
});

// Get leveling leaderboard for a guild
app.get("/api/leveling/:guildId/leaderboard", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // Return leaderboard data stored in serverData
    const leaderboard = serverData[guildId]?.allUsers || [];

    res.json({ 
        guildId,
        users: leaderboard
    });
});

// Get economy settings for a guild
app.get("/api/economy/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // Initialize global storage if needed
    if (!global.economySettings) {
        global.economySettings = {};
    }

    // Try to load from economy_data.json file first
    try {
        const economyFilePath = path.join(__dirname, 'economy_data.json');
        
        if (fs.existsSync(economyFilePath)) {
            const fileContent = fs.readFileSync(economyFilePath, 'utf8');
            const economyData = JSON.parse(fileContent);
            
            if (economyData.settings && economyData.settings[guildId]) {
                const botSettings = economyData.settings[guildId];
                // Convert bot format to API format
                const settings = {
                    enabled: botSettings.enabled || false,
                    per_message: botSettings.per_message || 10,
                    currency_symbol: botSettings.currency || "💰",
                    starting_amount: botSettings.start || 500
                };
                return res.json(settings);
            }
        }
    } catch (err) {
        console.error('Error reading economy_data.json:', err);
    }

    // Return defaults if file not found or guild not configured
    const defaultSettings = {
        enabled: false,
        per_message: 10,
        currency_symbol: "💰",
        starting_amount: 500
    };

    const settings = global.economySettings[guildId] || defaultSettings;
    res.json(settings);
});

// Save economy settings for a guild
app.post("/api/economy/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { enabled, per_message, currency_symbol, starting_amount } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    // Store settings in memory
    if (!global.economySettings) {
        global.economySettings = {};
    }

    global.economySettings[guildId] = {
        enabled: enabled || false,
        per_message: per_message || 10,
        currency_symbol: currency_symbol || "💰",
        starting_amount: starting_amount || 500,
        lastUpdated: new Date().toISOString()
    };

    // Also save to economy_data.json file with the correct key format for the bot
    try {
        // Try to read existing economy_data.json
        let economyData = { balances: {}, settings: {} };
        const economyFilePath = path.join(__dirname, 'economy_data.json');
        
        try {
            if (fs.existsSync(economyFilePath)) {
                const fileContent = fs.readFileSync(economyFilePath, 'utf8');
                economyData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new economy_data.json file');
        }
        
        // Update settings with the correct key names for the bot
        economyData.settings[guildId] = {
            currency_symbol: currency_symbol || "💰",
            start: starting_amount || 500,
            per_message: per_message || 10,
            enabled: enabled || false
        };
        
        // Save to file
        fs.writeFileSync(economyFilePath, JSON.stringify(economyData, null, 4));
        console.log(`✅ Economy settings saved to file for guild ${guildId}`);
    } catch (err) {
        console.error('Error saving economy settings to file:', err);
        // Don't fail the response, just log the error
    }

    res.json({ 
        success: true, 
        message: "Economy settings saved", 
        settings: global.economySettings[guildId] 
    });
});

app.post("/api/economy/:guildId/reset-balances", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
        // Read existing economy_data.json
        let economyData = { balances: {}, settings: {} };
        const economyFilePath = path.join(__dirname, 'economy_data.json');
        
        try {
            if (fs.existsSync(economyFilePath)) {
                const fileContent = fs.readFileSync(economyFilePath, 'utf8');
                economyData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Economy_data.json not found, creating new one');
        }

        // Get the current starting amount for this guild
        const startingAmount = economyData.settings[guildId]?.start || 500;

        // Reset all balances for this guild to the starting amount
        if (!economyData.balances[guildId]) {
            economyData.balances[guildId] = {};
        }

        // Get all users in this guild and reset their balances
        const users = Object.keys(economyData.balances[guildId]);
        users.forEach(userId => {
            economyData.balances[guildId][userId] = startingAmount;
        });

        // Save to file
        fs.writeFileSync(economyFilePath, JSON.stringify(economyData, null, 4));
        console.log(`✅ Economy balances reset for guild ${guildId}. All ${users.length} users set to ${startingAmount}`);

        res.json({ 
            success: true, 
            message: "All economy balances reset", 
            usersReset: users.length,
            startingAmount: startingAmount
        });
    } catch (err) {
        console.error('Error resetting economy balances:', err);
        res.status(500).json({ error: "Failed to reset balances", details: err.message });
    }
});

// ========== WELCOME SETTINGS ENDPOINTS ==========

// Get welcome settings for a guild
app.get("/api/welcome/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // Initialize global storage if needed
    if (!global.welcomeSettings) {
        global.welcomeSettings = {};
    }

    // Return stored settings or defaults if not stored
    const defaultSettings = {
        enabled: false,
        use_embed: false,
        channel_id: null,
        member_count_channel_id: null,
        text: "Welcome to our server, {user}!",
        title: "Welcome!",
        description: "Welcome to our server!",
        footer: "",
        thumbnail: "https://cdn.discordapp.com/embed/avatars/0.png",
        image: "",
        color: "#5170ff",
        member_goal: 0,
        fields: []
    };

    const settings = global.welcomeSettings[guildId] || defaultSettings;
    res.json(settings);
});

// Save welcome settings for a guild
app.post("/api/welcome/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { enabled, use_embed, channel_id, member_count_channel_id, text, title, description, footer, thumbnail, image, color, member_goal, fields } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    // Initialize global storage if needed
    if (!global.welcomeSettings) {
        global.welcomeSettings = {};
    }

    global.welcomeSettings[guildId] = {
        enabled: enabled || false,
        use_embed: use_embed || false,
        channel_id: channel_id || null,
        member_count_channel_id: member_count_channel_id || null,
        text: text || "Welcome to our server, {user}!",
        title: title || "Welcome!",
        description: description || "Welcome to our server!",
        footer: footer || "",
        thumbnail: thumbnail || "https://cdn.discordapp.com/embed/avatars/0.png",
        image: image || "",
        color: color || "#5170ff",
        member_goal: member_goal || 0,
        fields: fields || [],
        lastUpdated: new Date().toISOString()
    };

    res.json({ 
        success: true, 
        message: "Welcome settings saved", 
        settings: global.welcomeSettings[guildId] 
    });
});

// ========== STATUS TRACKING ENDPOINTS ==========

// Endpoint for bot to GET status data
app.get("/api/status-data", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        // Read status_data.json from backend
        let statusData = {};
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        if (fs.existsSync(statusFilePath)) {
            const fileContent = fs.readFileSync(statusFilePath, 'utf8');
            const parsed = JSON.parse(fileContent);
            // The file has a 'settings' key, but we need to convert it to the format the bot expects
            // Bot expects: { guildId: { userId: { config } } }
            // Backend stores: { settings: { guildId: { config } } }
            if (parsed.settings) {
                for (const [guildId, settings] of Object.entries(parsed.settings)) {
                    if (settings.user_id) {
                        statusData[guildId] = {
                            [settings.user_id]: settings
                        };
                    }
                }
            }
        }
        
        res.json({ 
            success: true, 
            statusData: statusData
        });
    } catch (err) {
        console.error('Error fetching status data:', err);
        res.status(500).json({ error: "Failed to fetch status data", details: err.message });
    }
});

app.get("/api/status/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
        // Try to read from status_data.json
        let statusData = { settings: {} };
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        try {
            if (fs.existsSync(statusFilePath)) {
                const fileContent = fs.readFileSync(statusFilePath, 'utf8');
                statusData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Status_data.json not found, creating new one');
        }

        const settings = statusData.settings[guildId] || {
            enabled: false,
            user_id: "",
            channel_id: "",
            delay_seconds: "60",
            offline_message: "User is currently offline",
            automatic: true,
            use_embed: true
        };

        res.json({ 
            success: true, 
            settings: settings 
        });
    } catch (err) {
        console.error('Error fetching status settings:', err);
        res.status(500).json({ error: "Failed to fetch settings", details: err.message });
    }
});

app.post("/api/status/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { enabled, user_id, channel_id, delay_seconds, offline_message, automatic, use_embed } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
        // Try to read existing status_data.json
        let statusData = { settings: {} };
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        try {
            if (fs.existsSync(statusFilePath)) {
                const fileContent = fs.readFileSync(statusFilePath, 'utf8');
                statusData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new status_data.json file');
        }

        // Get the OLD settings BEFORE updating (to get the message_id)
        const oldSettings = statusData.settings[guildId] || {};
        const oldMessageId = oldSettings.message_id;
        const oldChannelId = oldSettings.channel_id;
        
        // Retrieved old settings for guild

        // QUEUE DELETION BEFORE CLEARING MESSAGE ID
        // Queue a delete action for the old message (if one exists) - check that it's not empty string and not "undefined"
        if (oldMessageId && oldMessageId !== "" && oldMessageId !== "undefined" && oldChannelId && oldChannelId !== "" && oldChannelId !== "undefined") {
            // Attempting to queue deletion
            try {
                // Load pending posts file with proper structure
                let pendingPosts = { posts: [] };
                const pendingPath = path.join(__dirname, 'pending_posts.json');
                
                try {
                    if (fs.existsSync(pendingPath)) {
                        const fileContent = fs.readFileSync(pendingPath, 'utf8');
                        const parsed = JSON.parse(fileContent);
                        // Handle both array format and object format
                        if (Array.isArray(parsed)) {
                            pendingPosts = { posts: parsed };

                        } else if (parsed && typeof parsed === 'object' && parsed.posts) {
                            pendingPosts = parsed;

                        }
                    }
                } catch (err) {
                    console.log(`⚠️ Error reading pending_posts.json: ${err.message}, starting fresh`);
                    pendingPosts = { posts: [] };
                }
                
                // Ensure posts array exists
                if (!pendingPosts.posts) {
                    pendingPosts.posts = [];
                }
                
                // Add delete action to the BEGINNING so it processes first (before new post)
                const deleteAction = {
                    action: "delete",
                    guildId: guildId,
                    channelId: oldChannelId,
                    messageId: oldMessageId
                };
                pendingPosts.posts.unshift(deleteAction);

                
                fs.writeFileSync(pendingPath, JSON.stringify(pendingPosts, null, 4));

            } catch (err) {
                console.log(`⚠️ Error in delete queueing: ${err.message}`);
                console.error(err);
            }
        } else {
            if (!oldMessageId) {

            }
        }
        
        // Now update the settings with new values and clear the message_id
        statusData.settings[guildId] = {
            enabled: enabled !== undefined ? enabled : true,
            user_id: user_id || "",
            channel_id: channel_id || "",
            delay_seconds: delay_seconds || 30,
            offline_message: offline_message || "",
            automatic: automatic !== undefined ? automatic : false,
            use_embed: use_embed !== undefined ? use_embed : true,
            message_id: "", // Clear old message ID since new message will be posted
            created_at: oldSettings.created_at || new Date().toISOString()
        };
        
        // Save updated settings
        fs.writeFileSync(statusFilePath, JSON.stringify(statusData, null, 4));


        res.json({ 
            success: true, 
            message: "Status tracking settings saved", 
            settings: statusData.settings[guildId] 
        });
    } catch (err) {
        console.error('Error saving status settings:', err);
        res.status(500).json({ error: "Failed to save settings", details: err.message });
    }
});

// Store message ID for later deletion
app.post("/api/status/:guildId/message-id", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { messageId, channelId } = req.body;

    if (!guildId || !messageId || !channelId) {
        return res.status(400).json({ error: "guildId, messageId, and channelId are required" });
    }

    try {
        // Read existing status_data.json
        let statusData = { settings: {} };
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        try {
            if (fs.existsSync(statusFilePath)) {
                const fileContent = fs.readFileSync(statusFilePath, 'utf8');
                statusData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new status_data.json file');
        }

        // Get the OLD message ID BEFORE storing the new one (if it exists and is different)
        const oldSettings = statusData.settings[guildId] || {};
        const oldMessageId = oldSettings.message_id;
        const oldChannelId = oldSettings.channel_id;

        // Update the message ID for this guild
        if (statusData.settings[guildId]) {
            statusData.settings[guildId].message_id = messageId;
            statusData.settings[guildId].last_message_timestamp = new Date().toISOString();
        } else {
            console.warn(`⚠️ Guild ${guildId} settings not found when storing message ID`);
        }

        // Save to file
        fs.writeFileSync(statusFilePath, JSON.stringify(statusData, null, 4));


        res.json({ 
            success: true, 
            message: "Message ID stored" 
        });
    } catch (err) {
        console.error('Error storing message ID:', err);
        res.status(500).json({ error: "Failed to store message ID", details: err.message });
    }
});

app.get("/api/status/pending-posts", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        let pendingPosts = { posts: [] };
        const pendingPostsPath = path.join(__dirname, 'pending_posts.json');
        
        try {
            if (fs.existsSync(pendingPostsPath)) {
                const fileContent = fs.readFileSync(pendingPostsPath, 'utf8');
                pendingPosts = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('No pending posts found');
        }

        res.json(pendingPosts);
    } catch (err) {
        console.error('Error fetching pending posts:', err);
        res.status(500).json({ error: "Failed to fetch pending posts", details: err.message });
    }
});

app.post("/api/status/pending-posts/remove/:index", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { index } = req.params;

    try {
        let pendingPosts = { posts: [] };
        const pendingPostsPath = path.join(__dirname, 'pending_posts.json');
        
        try {
            if (fs.existsSync(pendingPostsPath)) {
                const fileContent = fs.readFileSync(pendingPostsPath, 'utf8');
                const parsed = JSON.parse(fileContent);
                // Handle both array format and object format
                if (Array.isArray(parsed)) {
                    pendingPosts = { posts: parsed };
                } else if (parsed && typeof parsed === 'object' && parsed.posts) {
                    pendingPosts = parsed;
                }
            }
        } catch (err) {
            console.log('No pending posts file');
        }

        // Remove the post at the given index
        if (index >= 0 && index < pendingPosts.posts.length) {
            pendingPosts.posts.splice(parseInt(index), 1);
            fs.writeFileSync(pendingPostsPath, JSON.stringify(pendingPosts, null, 4));
    
        }

        res.json({ success: true, message: "Post removed" });
    } catch (err) {
        console.error('Error removing pending post:', err);
        res.status(500).json({ error: "Failed to remove pending post", details: err.message });
    }
});

app.post("/api/status/:guildId/post", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    // Verify authorization
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { user_id, channel_id, offline_message, use_embed } = req.body;

    if (!guildId || !user_id || !channel_id) {
        return res.status(400).json({ error: "guildId, user_id, and channel_id are required" });
    }

    try {
        // Load pending posts file
        let pendingPosts = { posts: [] };
        const pendingPostsPath = path.join(__dirname, 'pending_posts.json');
        
        try {
            if (fs.existsSync(pendingPostsPath)) {
                const fileContent = fs.readFileSync(pendingPostsPath, 'utf8');
                const parsed = JSON.parse(fileContent);
                // Handle both array format (from delete queueing) and object format (from this endpoint)
                if (Array.isArray(parsed)) {
                    pendingPosts = { posts: parsed };
                } else if (parsed && typeof parsed === 'object' && parsed.posts) {
                    pendingPosts = parsed;
                } else {
                    pendingPosts = { posts: [] };
                }
            }
        } catch (err) {
            console.log('Creating new pending_posts.json file');
            pendingPosts = { posts: [] };
        }

        // Add new post request to posts array
        if (!pendingPosts.posts) {
            pendingPosts.posts = [];
        }
        pendingPosts.posts.push({
            guildId: guildId,
            userId: user_id,
            channelId: channel_id,
            offlineMessage: offline_message || 'User is currently offline',
            useEmbed: use_embed !== undefined ? use_embed : false,
            timestamp: new Date().toISOString()
        });

        // Save to file
        fs.writeFileSync(pendingPostsPath, JSON.stringify(pendingPosts, null, 4));


        res.json({ 
            success: true, 
            message: "Status post queued - bot will post immediately" 
        });
    } catch (err) {
        console.error('Error queueing status post:', err);
        res.status(500).json({ error: "Failed to queue status post", details: err.message });
    }
});

// ============ PREMIUM/TRIALS & NOTIFICATIONS SYSTEM ============

// Helper function to load/save premium data from bot
function loadPremiumData() {
    try {
        const premiumDataPath = path.join(__dirname, 'premium_data.json');
        if (fs.existsSync(premiumDataPath)) {
            return JSON.parse(fs.readFileSync(premiumDataPath, 'utf8'));
        }
    } catch (err) {
        console.log('Premium data file not found, using cache');
    }
    return premiumCache;
}

function savePremiumData(data) {
    try {
        const premiumDataPath = path.join(__dirname, 'premium_data.json');
        fs.writeFileSync(premiumDataPath, JSON.stringify(data, null, 4));
        // Also update cache
        Object.keys(data).forEach(key => {
            premiumCache[key] = data[key];
        });
    } catch (err) {
        console.error('Error saving premium data:', err);
    }
}

// Helper function to load/save notifications
let notificationsData = {};

function loadNotifications() {
    try {
        const notificationsPath = path.join(__dirname, 'notifications.json');
        if (fs.existsSync(notificationsPath)) {
            notificationsData = JSON.parse(fs.readFileSync(notificationsPath, 'utf8'));
        }
    } catch (err) {
        console.log('Notifications file not found, starting fresh');
        notificationsData = {};
    }
}

function saveNotifications() {
    try {
        const notificationsPath = path.join(__dirname, 'notifications.json');
        fs.writeFileSync(notificationsPath, JSON.stringify(notificationsData, null, 4));
    } catch (err) {
        console.error('Error saving notifications:', err);
    }
}

// Load notifications on startup
loadNotifications();

// Endpoint for bot to POST premium data (for syncing)
app.post("/api/premium/sync", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { premiumData } = req.body;
        if (premiumData && typeof premiumData === 'object') {
            savePremiumData(premiumData);
            res.json({ success: true, message: "Premium data synced" });
        } else {
            res.status(400).json({ error: "Invalid premium data" });
        }
    } catch (err) {
        console.error('Error syncing premium data:', err);
        res.status(500).json({ error: "Failed to sync premium data" });
    }
});

// Storage for global/broadcast gifts and notifications
let globalGifts = [];
let globalNotifications = [];

function loadGlobalData() {
    try {
        const globalPath = path.join(__dirname, 'global_data.json');
        if (fs.existsSync(globalPath)) {
            const data = JSON.parse(fs.readFileSync(globalPath, 'utf8'));
            globalGifts = data.gifts || [];
            globalNotifications = data.notifications || [];
        }
    } catch (err) {
        console.log('Global data file not found, starting fresh');
    }
}

function saveGlobalData() {
    try {
        const globalPath = path.join(__dirname, 'global_data.json');
        fs.writeFileSync(globalPath, JSON.stringify({
            gifts: globalGifts,
            notifications: globalNotifications
        }, null, 4));
    } catch (err) {
        console.error('Error saving global data:', err);
    }
}

loadGlobalData();

// Send a trial to a user
app.post("/api/trials/send", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId, durationDays, targetUsers, sendToAll } = req.body;
        
        if (!userId || !durationDays) {
            return res.status(400).json({ error: "userId and durationDays are required" });
        }

        const trialId = `trial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = Date.now();
        const expiresAt = createdAt + (durationDays * 24 * 60 * 60 * 1000);

        const trial = {
            id: trialId,
            durationDays,
            createdAt,
            expiresAt,
            claimed: false,
            claimedAt: null,
            isGlobal: sendToAll || (targetUsers && targetUsers.length === 0)
        };

        if (sendToAll || (targetUsers && targetUsers.length === 0)) {
            // Send individual copies to all known users
            const allUserIds = Object.keys(knownUsers);
            if (allUserIds.length === 0) {
                return res.status(400).json({ error: "No users have logged in yet. Send to specific user IDs instead." });
            }
            
            allUserIds.forEach(targetUserId => {
                if (!notificationsData[String(targetUserId)]) {
                    notificationsData[String(targetUserId)] = { notifications: [], gifts: [] };
                }
                notificationsData[String(targetUserId)].gifts.push({
                    ...trial,
                    userId: String(targetUserId)
                });
            });
            saveNotifications();
        } else if (targetUsers && Array.isArray(targetUsers) && targetUsers.length > 0) {
            // Store for specific users
            targetUsers.forEach(targetUserId => {
                if (!notificationsData[String(targetUserId)]) {
                    notificationsData[String(targetUserId)] = { notifications: [], gifts: [] };
                }
                notificationsData[String(targetUserId)].gifts.push({
                    ...trial,
                    userId: String(targetUserId)
                });
            });
            saveNotifications();
        } else {
            // Single user
            if (!notificationsData[String(userId)]) {
                notificationsData[String(userId)] = { notifications: [], gifts: [] };
            }
            notificationsData[String(userId)].gifts.push({
                ...trial,
                userId: String(userId)
            });
            saveNotifications();
        }

        res.json({ 
            success: true, 
            message: sendToAll ? `Trial sent to ${Object.keys(knownUsers).length} users!` : `Trial sent successfully`,
            trialId
        });
    } catch (err) {
        console.error('Error creating trial:', err);
        res.status(500).json({ error: "Failed to create trial", details: err.message });
    }
});

// Claim a trial (redeem gift)
// Storage for pending premium claims (bot will fetch and process these)
let pendingPremiumClaims = {};

function loadPendingClaims() {
    try {
        const claimsPath = path.join(__dirname, 'pending_premium_claims.json');
        if (fs.existsSync(claimsPath)) {
            pendingPremiumClaims = JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
        }
    } catch (err) {
        console.log('Pending claims file not found, starting fresh');
        pendingPremiumClaims = {};
    }
}

function savePendingClaims() {
    try {
        const claimsPath = path.join(__dirname, 'pending_premium_claims.json');
        fs.writeFileSync(claimsPath, JSON.stringify(pendingPremiumClaims, null, 4));
    } catch (err) {
        console.error('Error saving pending claims:', err);
    }
}

loadPendingClaims();

app.post("/api/trials/claim", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId, trialId } = req.body;
        
        if (!userId || !trialId) {
            return res.status(400).json({ error: "userId and trialId are required" });
        }

        // Check user-specific gifts first
        let trial = null;
        let isGlobal = false;

        const userNotifications = notificationsData[userId];
        if (userNotifications && userNotifications.gifts) {
            trial = userNotifications.gifts.find(g => g.id === trialId);
        }

        // If not found in user gifts, check global gifts
        if (!trial) {
            trial = globalGifts.find(g => g.id === trialId);
            isGlobal = !!trial;
        }

        if (!trial) {
            return res.status(404).json({ error: "Trial not found" });
        }

        if (trial.claimed) {
            return res.status(400).json({ error: "Trial already claimed" });
        }

        // Mark as claimed
        trial.claimed = true;
        trial.claimedAt = Date.now();

        // Create a pending claim for the bot to process
        const claimId = `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const expiryTime = Math.floor(Date.now() / 1000) + (trial.durationDays * 24 * 60 * 60);

        pendingPremiumClaims[claimId] = {
            userId: String(userId),
            trialId,
            durationDays: trial.durationDays,
            expiryTime,
            createdAt: Date.now(),
            processed: false,
            processedAt: null
        };

        // Save changes
        if (isGlobal) {
            saveGlobalData();
        } else {
            saveNotifications();
        }
        savePendingClaims();

        res.json({ 
            success: true, 
            message: "Trial claim submitted! Premium will be activated shortly.",
            claimId,
            premium: {
                active: true,
                expiry: expiryTime,
                duration_days: trial.durationDays
            }
        });
    } catch (err) {
        console.error('Error claiming trial:', err);
        res.status(500).json({ error: "Failed to claim trial", details: err.message });
    }
});

// Endpoint for bot to fetch pending premium claims
app.get("/api/premium/pending-claims", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const unprocessedClaims = Object.values(pendingPremiumClaims).filter(c => !c.processed);
        res.json({ claims: unprocessedClaims });
    } catch (err) {
        console.error('Error fetching pending claims:', err);
        res.status(500).json({ error: "Failed to fetch pending claims" });
    }
});

// Endpoint for bot to mark claim as processed
app.post("/api/premium/claim-processed", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { claimId } = req.body;
        
        if (!claimId || !pendingPremiumClaims[claimId]) {
            return res.status(404).json({ error: "Claim not found" });
        }

        pendingPremiumClaims[claimId].processed = true;
        pendingPremiumClaims[claimId].processedAt = Date.now();

        savePendingClaims();

        res.json({ success: true, message: "Claim marked as processed" });
    } catch (err) {
        console.error('Error marking claim as processed:', err);
        res.status(500).json({ error: "Failed to mark claim as processed" });
    }
});

// Get user's gifts (trials)
app.get("/api/user/:userId/gifts", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId } = req.params;
        
        // Track this user as known
        trackUser(userId);
        
        const now = Date.now();

        // Get user-specific gifts only
        let gifts = [];
        const userNotifications = notificationsData[userId];
        if (userNotifications && userNotifications.gifts) {
            gifts = userNotifications.gifts.filter(gift => gift.expiresAt > now && !gift.claimed);
        }

        res.json({ gifts });
    } catch (err) {
        console.error('Error fetching gifts:', err);
        res.status(500).json({ error: "Failed to fetch gifts" });
    }
});

// Send a notification to users
app.post("/api/notifications/send", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { title, message, type, targetUsers, sendToAll } = req.body;
        
        if (!title || !message || !type) {
            return res.status(400).json({ error: "title, message, and type are required" });
        }

        const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = Date.now();
        const expiresAt = createdAt + (7 * 24 * 60 * 60 * 1000); // 7 days

        const notification = {
            id: notificationId,
            title,
            message,
            type,
            createdAt,
            expiresAt,
            read: false,
            isGlobal: sendToAll || (targetUsers && targetUsers.length === 0)
        };

        if (sendToAll || (targetUsers && targetUsers.length === 0)) {
            // Store as global broadcast
            globalNotifications.push(notification);
            saveGlobalData();
        } else if (targetUsers && Array.isArray(targetUsers) && targetUsers.length > 0) {
            // Send to specific users
            targetUsers.forEach(userId => {
                if (!notificationsData[String(userId)]) {
                    notificationsData[String(userId)] = { notifications: [], gifts: [] };
                }
                notificationsData[String(userId)].notifications.push(notification);
            });
            saveNotifications();
        }

        res.json({ 
            success: true, 
            message: sendToAll ? "Notification broadcast to all users!" : `Notification sent successfully`,
            notificationId
        });
    } catch (err) {
        console.error('Error sending notification:', err);
        res.status(500).json({ error: "Failed to send notification", details: err.message });
    }
});

// Get user's notifications
app.get("/api/user/:userId/notifications", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId } = req.params;
        
        // Track this user as known
        trackUser(userId);
        
        const now = Date.now();

        // Get user-specific notifications
        let notifications = [];
        const userNotifications = notificationsData[userId];
        if (userNotifications && userNotifications.notifications) {
            notifications = userNotifications.notifications.filter(n => n.expiresAt > now && !n.read);
        }

        // Add global broadcast notifications
        const activeGlobalNotifications = globalNotifications.filter(n => n.expiresAt > now && !n.read);
        notifications = notifications.concat(activeGlobalNotifications);

        res.json({ notifications });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});

// Mark notification as read
app.post("/api/notifications/:notificationId/read", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { notificationId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const userNotifications = notificationsData[userId];
        if (!userNotifications) {
            return res.status(404).json({ error: "User not found" });
        }

        const notification = userNotifications.notifications.find(n => n.id === notificationId);
        if (!notification) {
            return res.status(404).json({ error: "Notification not found" });
        }

        notification.read = true;
        saveNotifications();

        res.json({ success: true, message: "Notification marked as read" });
    } catch (err) {
        console.error('Error marking notification as read:', err);
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
