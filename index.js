import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import fs from "fs";
import path from "path";

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
        "https://www.status-bot.xyz"
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

    const { servers, ping, guildIds } = req.body;

    botStats = {
        servers: servers || 0,
        ping: ping || 0,
        status: "online",
        guildIds: guildIds || [],
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
            isPremium: false,
            trackedUser: null,
            topUsers: []
        };
        return res.json(mockData);
    }

    const overview = serverData[guildId] || {
        memberCount: 0,
        isPremium: false,
        trackedUser: null,
        topUsers: []
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
        isPremium: isPremium || false,
        trackedUser: trackedUser || null,
        topUsers: topUsers || [],
        allUsers: allUsers || [],
        lastUpdated: new Date().toISOString()
    };

    res.json({ success: true, message: "Server data updated" });
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
        const fs = require('fs');
        const path = require('path');
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
        const fs = require('fs');
        const path = require('path');
        
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
            currency: currency_symbol || "💰",
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
