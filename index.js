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

const GUILD_DATA_FILE = path.join(DATA_DIR, "guild_data.json");
const GUILD_SETTINGS_FILE = path.join(DATA_DIR, "guild_settings.json");

// Helper functions for file-based persistence
function loadGuildData() {
    try {
        if (fs.existsSync(GUILD_DATA_FILE)) {
            return JSON.parse(fs.readFileSync(GUILD_DATA_FILE, "utf-8"));
        }
    } catch (err) {
        console.error("Error loading guild data:", err);
    }
    return {};
}

function saveGuildData(data) {
    try {
        fs.writeFileSync(GUILD_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error saving guild data:", err);
    }
}

function loadGuildSettings() {
    try {
        if (fs.existsSync(GUILD_SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(GUILD_SETTINGS_FILE, "utf-8"));
        }
    } catch (err) {
        console.error("Error loading guild settings:", err);
    }
    return {};
}

function saveGuildSettings(data) {
    try {
        fs.writeFileSync(GUILD_SETTINGS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error saving guild settings:", err);
    }
}

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
- <a href="https://status-bot.xyz/terms">Terms & Conditons</a>
- <a href="https://status-bot.xyz/privacy">Privacy policy</a>

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
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "1mb" }));

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.options("*", cors());

let botStats = { servers: 0, ping: 0, status: "offline" };
let botGuilds = []; // Store guild IDs where bot is active
let guildData = loadGuildData();
let guildSettings = loadGuildSettings();

app.post("/api/bot-stats", (req, res) => {
    try {
        botStats = req.body;
        
        // Also extract guild IDs if provided
        if (req.body.guild_ids && Array.isArray(req.body.guild_ids)) {
            botGuilds = req.body.guild_ids;
        } else if (req.body.guilds_data && typeof req.body.guilds_data === "object") {
            // If guilds_data provided, extract guild IDs from it
            botGuilds = Object.keys(req.body.guilds_data);
        }
        
        // Store comprehensive guild data from bot
        if (req.body.guilds_data && typeof req.body.guilds_data === "object") {
            guildData = { ...guildData, ...req.body.guilds_data };
            saveGuildData(guildData);
        }
        
        console.log("✓ Bot stats received:", botStats);
        res.json({ success: true });
    } catch (err) {
        console.error("Stats update error:", err);
        res.status(500).json({ error: "Failed to update stats" });
    }
});

app.get("/api/bot-stats", (req, res) => {
    res.json(botStats);
});

app.post("/api/bot-guilds", (req, res) => {
    try {
        const { guilds } = req.body;
        
        if (Array.isArray(guilds)) {
            botGuilds = guilds;
            console.log(`✓ Bot guilds updated: ${guilds.length} guilds`);
            res.json({ success: true, count: guilds.length });
        } else {
            res.status(400).json({ error: "Guilds must be an array" });
        }
    } catch (err) {
        console.error("Guild update error:", err);
        res.status(500).json({ error: "Failed to update guilds" });
    }
});

app.get("/api/bot-guilds", (req, res) => {
    res.json({ guilds: botGuilds });
});

// Get guild overview data
app.get("/api/guild/:guildId/overview", (req, res) => {
    const { guildId } = req.params;
    const data = guildData[guildId] || {};
    
    res.json({
        guildId,
        members: data.members || 0,
        memberCount: data.member_count || 0,
        premium: data.premium || false,
        trackedUser: data.tracked_user || null,
        trackedUserStatus: data.tracked_user_status || "unknown",
        botStatus: botStats.status || "offline"
    });
});

// Get user's rank
app.get("/api/guild/:guildId/user/:userId/rank", (req, res) => {
    const { guildId, userId } = req.params;
    
    const data = guildData[guildId] || {};
    const xpUsers = data.xp_leaderboard || [];
    
    // Find user in leaderboard
    const userIndex = xpUsers.findIndex(u => String(u.user_id) === String(userId));
    
    if (userIndex === -1) {
        return res.json({
            rank: null,
            xp: 0,
            level: 0,
            xpNeeded: 100
        });
    }
    
    const user = xpUsers[userIndex];
    const currentXp = user.value || 0;
    const level = user.level || 0;
    
    res.json({
        rank: userIndex + 1,
        xp: currentXp,
        level: level
    });
});

// Get XP leaderboard
app.get("/api/guild/:guildId/leaderboard/xp", (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const data = guildData[guildId] || {};
    const xpUsers = data.xp_leaderboard || [];
    
    res.json({
        guildId,
        type: "xp",
        leaderboard: xpUsers.slice(offset, offset + limit),
        total: xpUsers.length
    });
});

// Get Economy leaderboard
app.get("/api/guild/:guildId/leaderboard/economy", (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const data = guildData[guildId] || {};
    const economyUsers = data.economy_leaderboard || [];
    
    res.json({
        guildId,
        type: "economy",
        leaderboard: economyUsers.slice(0, limit),
        total: economyUsers.length
    });
});

// Get Voice Minutes leaderboard
app.get("/api/guild/:guildId/leaderboard/voice", (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const data = guildData[guildId] || {};
    const xpUsers = data.xp_leaderboard || [];
    
    // Extract voice minutes from users
    const voiceUsers = xpUsers.map(user => ({
        ...user,
        value: user.voice_minutes || 0
    })).sort((a, b) => b.value - a.value);
    
    res.json({
        guildId,
        type: "voice",
        leaderboard: voiceUsers.slice(offset, offset + limit),
        total: voiceUsers.length
    });
});

// Get Messages leaderboard
app.get("/api/guild/:guildId/leaderboard/messages", (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const data = guildData[guildId] || {};
    const xpUsers = data.xp_leaderboard || [];
    
    console.log(`[MESSAGES] Guild ${guildId}: xpUsers count = ${xpUsers.length}`);
    if (xpUsers.length > 0) {
        console.log(`[MESSAGES] First user:`, JSON.stringify(xpUsers[0]));
    }
    
    // Extract message count from users (check multiple field names)
    const messageUsers = xpUsers.map(user => ({
        ...user,
        value: user.message_count || user.messages || 0
    })).sort((a, b) => b.value - a.value);
    
    console.log(`[MESSAGES] After mapping - first user value:`, messageUsers.length > 0 ? messageUsers[0].value : 'N/A');
    
    res.json({
        guildId,
        type: "messages",
        leaderboard: messageUsers.slice(offset, offset + limit),
        total: messageUsers.length
    });
});

// Get guild settings
app.get("/api/guild/:guildId/settings", (req, res) => {
    const { guildId } = req.params;
    const settings = guildSettings[guildId] || {};
    
    res.json({
        guildId,
        settings
    });
});

// Save guild settings
app.post("/api/guild/:guildId/settings", (req, res) => {
    try {
        const { guildId } = req.params;
        const { settings } = req.body;
        
        if (!settings || typeof settings !== "object") {
            return res.status(400).json({ error: "Invalid settings format" });
        }
        
        guildSettings[guildId] = {
            ...guildSettings[guildId],
            ...settings,
            lastUpdated: new Date().toISOString()
        };
        
        saveGuildSettings(guildSettings);
        
        res.json({ success: true, settings: guildSettings[guildId] });
    } catch (err) {
        console.error("Error saving settings:", err);
        res.status(500).json({ error: "Failed to save settings" });
    }
});

// Status Tracking Endpoints
// Set user to track
app.post("/api/guild/:guildId/status/set", (req, res) => {
    try {
        const { guildId } = req.params;
        const { user_id, delay, default_offline_message } = req.body;
        
        if (!user_id) {
            return res.status(400).json({ error: "User ID is required" });
        }
        
        // Create a request to the bot to set tracking
        // For now, we'll store it and the bot will handle it via api.py
        guildSettings[guildId] = guildSettings[guildId] || {};
        guildSettings[guildId].status_tracking = {
            user_id: user_id,
            delay: parseInt(delay) || 0,
            default_offline_message: default_offline_message || null,
            updated_at: new Date().toISOString()
        };
        
        saveGuildSettings(guildSettings);
        
        res.json({ success: true, message: "User tracking set" });
    } catch (err) {
        console.error("Error setting user tracking:", err);
        res.status(500).json({ error: "Failed to set user tracking" });
    }
});

// Start tracking (send message to channel)
app.post("/api/guild/:guildId/status/track", (req, res) => {
    try {
        const { guildId } = req.params;
        const { channel_id, automatic, embed } = req.body;
        
        if (!channel_id) {
            return res.status(400).json({ error: "Channel ID is required" });
        }
        
        guildSettings[guildId] = guildSettings[guildId] || {};
        guildSettings[guildId].status_track_config = {
            channel_id: channel_id,
            automatic: automatic === 'yes',
            embed: embed === 'yes',
            updated_at: new Date().toISOString()
        };
        
        saveGuildSettings(guildSettings);
        
        res.json({ success: true, message: "Tracking configuration saved" });
    } catch (err) {
        console.error("Error configuring tracking:", err);
        res.status(500).json({ error: "Failed to configure tracking" });
    }
});

// Update status manually
app.post("/api/guild/:guildId/status/update", (req, res) => {
    try {
        const { guildId } = req.params;
        const { status, reason } = req.body;
        
        if (!status || !['online', 'offline', 'maintenance'].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        
        guildSettings[guildId] = guildSettings[guildId] || {};
        guildSettings[guildId].status_override = {
            status: status,
            reason: reason || null,
            manual: true,
            updated_at: new Date().toISOString()
        };
        
        saveGuildSettings(guildSettings);
        
        res.json({ success: true, message: "Status updated" });
    } catch (err) {
        console.error("Error updating status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
});

// Reset status to automatic
app.post("/api/guild/:guildId/status/reset", (req, res) => {
    try {
        const { guildId } = req.params;
        
        // Wipe all status tracking settings for a fresh start
        if (guildSettings[guildId]) {
            delete guildSettings[guildId].status_tracking;
            delete guildSettings[guildId].status_track_config;
            delete guildSettings[guildId].status_override;
        }
        
        saveGuildSettings(guildSettings);
        
        res.json({ success: true, message: "Status settings cleared" });
    } catch (err) {
        console.error("Error resetting status:", err);
        res.status(500).json({ error: "Failed to reset status" });
    }
});

// Get guild channels
app.get("/api/guild/:guildId/channels", (req, res) => {
    try {
        const { guildId } = req.params;
        const guildData = loadGuildData();
        
        if (!guildData[guildId] || !guildData[guildId].channels) {
            return res.json({ channels: [] });
        }
        
        const channels = guildData[guildId].channels.map(channel => ({
            id: channel.id,
            name: channel.name,
            type: channel.type
        })).sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({ channels });
    } catch (err) {
        console.error("Error fetching guild channels:", err);
        res.status(500).json({ error: "Failed to fetch channels" });
    }
});

// Update guild channels (bot endpoint)
app.post("/api/guild/:guildId/channels", (req, res) => {
    try {
        const { guildId } = req.params;
        const { channels } = req.body;
        
        if (!Array.isArray(channels)) {
            return res.status(400).json({ error: "Channels must be an array" });
        }
        
        const guildData = loadGuildData();
        guildData[guildId] = guildData[guildId] || {};
        guildData[guildId].channels = channels;
        saveGuildData(guildData);
        
        res.json({ success: true, message: "Channels updated" });
    } catch (err) {
        console.error("Error updating guild channels:", err);
        res.status(500).json({ error: "Failed to update channels" });
    }
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
