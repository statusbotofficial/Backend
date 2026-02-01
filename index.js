// IMPORTS & CONFIGURATION
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}


// GLOBAL STATE VARIABLES
let botStats = {
    servers: 0,
    ping: 0,
    status: "offline",
    lastUpdated: null
};

let serverData = {};

let serverChannels = {};

let premiumCache = {};

let pendingDashboardGrants = {};

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


// SYSTEM PROMPTS
const SYSTEM_PROMPT = `
You are the official AI support assistant for Status Bot, a comprehensive Discord server management bot with advanced tracking, leveling, economy, and automation features.

PERSONALITY & RESPONSE STYLE:
- Be friendly, knowledgeable, and solution-focused
- Use a conversational tone while staying professional
- **KEEP RESPONSES CONCISE** - 1-3 sentences max with bullet points for lists
- Use emojis sparingly (1-2 max) to add personality
- Provide actionable solutions, not just explanations
- Always include relevant links when helpful

PRIMARY MISSION:
Help users successfully configure and use Status Bot's features through the web dashboard and bot commands.

STATUS BOT CORE FEATURES & DETAILED CAPABILITIES:

🎯 **STATUS TRACKING SYSTEM:**
- Track any Discord user's online/offline/idle/do not disturb status in real-time
- Custom offline messages and delay settings (0+ seconds)
- Automatic status updates or manual control
- Embed or plain text format options
- Message editing in designated channels
- Perfect for streamers, admins, or developers wanting to track a member's status

📈 **LEVELING SYSTEM:**
- Linear or custom XP progression (default: 10 XP per message)
- Voice chat XP earning (default: 2 XP per minute in VC)
- Customizable level-up messages with multiple placeholders
- Specific channels for XP earning (whitelist system)
- XP cooldown prevention (default: 60 seconds)
- Role rewards integration
- Full leaderboard with member rankings

💰 **ECONOMY SYSTEM:**
- Server-specific currency with custom symbols (💰 default)
- Configurable earning rates (default: 5 per message)
- Starting balance settings (default: 500)
- Balance multipliers for events/bonuses
- Daily interest rates for passive income
- Robbery mechanics with success rate settings (default: 50%)
- Work command reward multipliers
- Economy reset functionality for admins
- Individual balance management

👋 **WELCOME & LEAVE MESSAGES:**
- Rich embed or simple text formats
- Customizable colors, thumbnails, images, and fields
- Placeholders: {user}, {server_name}, {member_count}
- Member count tracking in channel names
- Member goal celebrations and tracking
- Designated channels for welcome/goodbye messages
- JSON field support for advanced embed customization

🛡️ **PREMIUM FEATURES:**
- Dashboard premium management
- Trial systems and gift codes
- Booster rewards integration
- Priority support access
- Advanced feature unlocks
- Automated premium tracking and expiration

⚙️ **DASHBOARD CONFIGURATION:**
- Web-based setup at status-bot.xyz/servers
- Discord OAuth login required
- Real-time server data sync
- Channel selection with live Discord integration
- User lookup and mention support
- Settings persistence and backup

🤖 **BOT COMMANDS & MANAGEMENT:**
- Slash command integration
- Automatic data synchronization
- Comprehensive logging system
- Error handling and user feedback

KEY CONFIGURATION AREAS:

**Status Tracking Setup:**
1. Enable status tracking in dashboard
2. Select user to track (by mention, ID, or username)
3. Choose notification channel
4. Set delay and offline message
5. Toggle embed/text format

**Leveling Configuration:**
1. Enable leveling system
2. Set XP rates (message + voice chat)
3. Configure level-up messages and channels
4. Restrict XP earning to specific channels
5. Set XP cooldown period

**Economy Setup:**
1. Enable economy features
2. Choose currency symbol and starting balance
3. Set earning rates and multipliers
4. Configure robbery settings
5. Manage member balances

**Welcome Messages:**
1. Enable welcome/leave systems
2. Design embed or text format
3. Set member count tracking
4. Configure member goals
5. Test message formatting

TROUBLESHOOTING COMMON ISSUES:

❌ **"Bot not responding"** → Check permissions, ensure bot is online, verify channel access
❌ **"Commands not working"** → Re-invite bot with proper permissions, check slash commands
❌ **"Dashboard won't load"** → Clear browser cache, check Discord login status, try incognito mode
❌ **"Settings not saving"** → Ensure you have Manage Server permission, check browser console
❌ **"XP not tracking"** → Verify XP is enabled, check channel whitelist, confirm cooldown settings
❌ **"Welcome messages not appearing"** → Check channel selection, verify bot permissions, test message format

HELPFUL RESOURCES:
- 🌐 <a href='https://status-bot.xyz'>Main Website</a>
- ⚙️ <a href='https://status-bot.xyz/servers'>Server Dashboard</a> (requires Discord login)
- 📋 <a href='https://status-bot.xyz/commands'>Commands List</a>
- 💎 <a href='https://status-bot.xyz/premium'>Premium Features</a>
- 📄 <a href='https://status-bot.xyz/docs'>Documentation</a>
- 👾 <a href='https://discord.gg/Kd2MckVxED'>Support Server</a>
- 🖋️ <a href='https://status-bot.xyz/terms'>Terms of Service</a>
- 🔒 <a href='https://status-bot.xyz/privacy'>Privacy Policy</a>

BOT INVITE: <a href='https://discord.com/api/oauth2/authorize?client_id=1436123870158520411&permissions=8&scope=bot%20applications.commands'>Add Status Bot</a>

RESPONSE EXAMPLES:

**Setup Question:** "😊 Yes! Go to the <a href='https://status-bot.xyz/servers'>Dashboard</a>, select your server, and enable leveling in the XP section."

**Feature Question:** "📈 The leveling system gives 10 XP per message by default. You can adjust this in the dashboard under Leveling Settings."

**Troubleshooting:** "🔧 Try re-inviting the bot with full permissions: <a href='https://discord.com/api/oauth2/authorize?client_id=1436123870158520411&permissions=8&scope=bot%20applications.commands'>Invite Link</a>"

IMPORTANT GUIDELINES:
- Do NOT invent features, commands, or capabilities
- Do NOT claim to have access to user data or server configs
- Do NOT share internal system details, API info, or code
- Provide specific configuration steps when possible
- Always mention dashboard login requirement for settings
- Explain permission requirements clearly
- Direct to support server for complex technical issues
- Never guess about features - only provide confirmed information
- Respect user privacy and data protection
- Respond calmly to any harassment or disrespect
- Politely decline to engage with inappropriate content
- Encourage respectful behavior
- Never pretend to have powers you don't have

ESCALATION TRIGGERS:
- Complex permission errors → <a href='https://discord.gg/Kd2MckVxED'>Support Server</a>
- Feature requests → <a href='https://discord.gg/Kd2MckVxED'>Support Server</a>
- Billing/premium issues → <a href='https://discord.gg/Kd2MckVxED'>Support Server</a>
- Technical bugs → <a href='https://discord.gg/Kd2MckVxED'>Support Server</a>

LANGUAGES:
You may respond in other languages if the user speaks it. Maintain the same friendly tone and helpful approach.

Remember: You're the expert on Status Bot! Help users succeed with clear, actionable guidance. 🚀
`;


// MIDDLEWARE & UTILITIES


app.use(cors({
    origin: [
        "https://status-bot.xyz",
        "https://www.status-bot.xyz",
        "https://status-bot.xyz"
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));


// REQUEST DEDUPLICATION
const pendingRequests = new Map();

async function deduplicateRequest(key, fn) {
    // If this request is already being made, wait for it instead of making a duplicate
    if (pendingRequests.has(key)) {
        console.log(`⏳ Request ${key} already pending, waiting for result...`);
        return pendingRequests.get(key);
    }
    
    // Create the promise for this request
    const promise = fn().then(result => {
        pendingRequests.delete(key);
        return result;
    }).catch(error => {
        pendingRequests.delete(key);
        throw error;
    });
    
    // Store it so duplicate requests wait for it
    pendingRequests.set(key, promise);
    return promise;
}

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.options("*", cors());


// AUTHENTICATION & TOKEN CACHE
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours - Discord tokens are valid for much longer

async function verifyDiscordToken(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    
    if (!authHeader.startsWith('Bearer ')) {
        console.error('❌ Missing Bearer prefix in auth header');
        return res.status(401).json({ error: "Unauthorized - Invalid format" });
    }

    const token = authHeader.substring(7);
    console.log('🔐 Verifying token, first 20 chars:', token.substring(0, 20) + '...');
    
    if (token === process.env.BACKEND_SECRET || token === "status-bot-stats-secret-key") {
        req.user = { isBot: true };
        return next();
    }
    
    // Check token cache first
    if (tokenCache.has(token)) {
        const cached = tokenCache.get(token);
        if (Date.now() - cached.timestamp < TOKEN_CACHE_TTL) {
            // If token was previously invalid, fail fast
            if (cached.invalid) {
                return res.status(401).json({ error: "Unauthorized - Token previously invalid" });
            }
            console.log('✅ Token verified from cache for:', cached.user.username);
            req.user = cached.user;
            return next();
        } else {
            tokenCache.delete(token);
        }
    }
    
    try {
        console.log('📡 Making Discord API call to verify token...');
        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Discord API status:', userRes.status);

        if (!userRes.ok) {
            const errorText = await userRes.text();
            console.error('❌ Discord API rejected token:', userRes.status, errorText);
            
            // Cache invalid token to prevent repeated API calls
            tokenCache.set(token, { invalid: true, timestamp: Date.now() });
            
            return res.status(401).json({ error: "Unauthorized - Token invalid or expired" });
        }

        const user = await userRes.json();
        console.log('✅ Token verified for:', user.username);
        
        // Cache the verified token
        tokenCache.set(token, { user, timestamp: Date.now() });
        
        req.user = user;
        next();
    } catch (error) {
        console.error('❌ Network error verifying token:', error.message);
        return res.status(401).json({ error: "Unauthorized - Network error" });
    }
}


// AI SUPPORT ENDPOINTS

// Content moderation function
function containsInappropriateContent(text) {
    const inappropriateTerms = [
        'nigger', 'nigga', 'nga', 'faggot', 'fag', 'tranny', 'retard', 'retarded', 'kike', 'spic', 'chink', 'gook', 'wetback', 'kkk', 'stalin',
        'kill yourself', 'kys', 'suicide', 'self harm', 'nazi', 'hitler', 'kim jong un', 'holocaust denial', 'white power', 'white supremacy',
        'terrorist', 'bomb threat', '9/11', 'school shooting', 'mass shooting', 'rape', 'child porn', 'cp', 'pedophile', 'pedo',
    ];

    const lowerText = text.toLowerCase();
    
    return inappropriateTerms.some(term => {
        return lowerText.includes(term.toLowerCase());
    });
}

// Send webhook to Discord when inappropriate content is detected
async function sendModerationWebhook(userMessage, userInfo) {
    const webhookUrl = 'https://discord.com/api/webhooks/1465754742474145900/rahHGOMkbJu2tqFEWzfiAsonqD5OvwlztLa0JaHcHQwyKM2h0dFwlX-cu20Rf5aqYIG3';
    
    const embed = {
        title: '🚨 Inappropriate Content Detected',
        description: `A user has been detected saying inappropriate content in AI Support.`,
        color: 0xff0000, // Red color
        fields: [
            {
                name: '👤 User',
                value: userInfo ? `**Username:** ${userInfo.username}\n**User ID:** ${userInfo.id}` : 'Unknown User',
                inline: false
            },
            {
                name: '💬 Message',
                value: `\`\`\`${userMessage}\`\`\``,
                inline: false
            },
            {
                name: '📅 Timestamp',
                value: new Date().toLocaleString(),
                inline: true
            }
        ],
        footer: {
            text: 'Status Bot Moderation System'
        }
    };

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                embeds: [embed]
            })
        });
    } catch (error) {
        console.error('Failed to send moderation webhook:', error);
    }
}

app.post("/api/support/ai", async (req, res) => {
    try {
        const message = req.body?.message?.trim();
        const user = req.body?.user;

        if (!message || message.length > 500) {
            return res.status(400).json({
                reply: "Please enter a valid message under 500 characters."
            });
        }

        // Check for inappropriate content before processing
        if (containsInappropriateContent(message)) {
            // Send webhook notification
            await sendModerationWebhook(message, user);
            
            // Return appropriate response without processing through AI
            return res.json({
                reply: "I cannot assist with inappropriate or harmful content. Please keep our conversation respectful and appropriate. If you need help with Status Bot features, I'm happy to help!"
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

// Health check endpoint
app.get("/api/health", async (req, res) => {
    try {
        const health = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            discord: {
                token: process.env.DISCORD_BOT_TOKEN ? "✅ Present" : "❌ Missing",
                rateLimitStats: {
                    totalRequests: global.apiRequestCount || 0,
                    rateLimitHits: global.rateLimitHits || 0,
                    lastRateLimit: global.lastRateLimit || null
                }
            },
            cache: {
                guildMembersEntries: Object.keys(guildMembersCache || {}).length,
                premiumCacheEntries: Object.keys(premiumCache || {}).length
            }
        };
        
        res.json(health);
    } catch (error) {
        res.status(500).json({
            status: "unhealthy",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});


// BOT STATS ENDPOINTS
app.post("/api/bot-stats/update", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { servers, ping, guildIds } = req.body;

    botStats = {
        ...botStats,
        servers: servers || botStats.servers,
        ping: ping || botStats.ping,
        status: "online",
        guildIds: guildIds || botStats.guildIds,
        lastUpdated: new Date().toISOString()
    };

    res.json({ success: true, message: "Stats updated" });
});

app.post("/api/bot-stats/uptime", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { uptime } = req.body;

    botStats = {
        ...botStats,
        uptime: uptime || botStats.uptime,
        lastUptimeUpdate: new Date().toISOString()
    };

    res.json({ success: true, message: "Uptime updated" });
});

app.get("/api/bot-stats", (_, res) => {
    res.json(botStats);
});

app.get("/api/bot-guilds", (req, res) => {
    res.json({ 
        guilds: botStats.guildIds || []
    });
});


// PREMIUM ENDPOINTS
app.get("/api/user-premium/:userId", (req, res) => {
    const { userId } = req.params;
    
    try {
        let hasPremium = false;
        let expiryDate = null;
        
        if (premiumCache[userId]) {
            const userPremiumInfo = premiumCache[userId];
            if (userPremiumInfo.active === true) {
                if (!userPremiumInfo.expiry || Date.now() / 1000 < userPremiumInfo.expiry) {
                    hasPremium = true;
                    expiryDate = userPremiumInfo.expiry ? new Date(userPremiumInfo.expiry * 1000).toISOString() : null;
                }
            }
        } else {
            const premiumDataPath = path.join(__dirname, 'premium_data.json');
            let premiumData = {};
            
            if (fs.existsSync(premiumDataPath)) {
                const rawData = fs.readFileSync(premiumDataPath, 'utf8');
                premiumData = JSON.parse(rawData);
            }
            
            const userPremiumInfo = premiumData[userId];
            if (userPremiumInfo) {
                if (userPremiumInfo.active === true) {
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


// SERVER DATA ENDPOINTS
app.get("/api/server-overview/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}` && !req.query.token) {
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

app.get("/api/server-leaderboard/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}` && !req.query.token) {
        const mockData = serverData[guildId] || {
            allUsers: [],
            memberCount: 0
        };
        return res.json(mockData);
    }

    const leaderboard = serverData[guildId] || {
        allUsers: [],
        memberCount: 0
    };

    res.json(leaderboard);
});

app.post("/api/server-data/update", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
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

app.post("/api/premium-data/sync", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { premiumData } = req.body;

    if (!premiumData) {
        return res.status(400).json({ error: "premiumData is required" });
    }

    const transformedCache = {};
    for (const [userId, premiumInfo] of Object.entries(premiumData)) {
        transformedCache[userId] = {
            active: premiumInfo.active || false,
            expiresAt: premiumInfo.expiry || null,  // Bot stores as 'expiry', we use 'expiresAt'
            source: premiumInfo.source || 'unknown',
            reason: premiumInfo.source === 'server_booster' || premiumInfo.source === 'booster' ? 'Server Booster' : 
                    premiumInfo.source === 'gift' ? 'Gifted' :
                    premiumInfo.source === 'trial' ? 'Trial' :
                    premiumInfo.source === 'patreon' ? 'Patreon' :
                    premiumInfo.source === 'dashboard' ? 'Dashboard' :
                    'Unknown',
            duration_days: premiumInfo.duration_days || null,
            is_gift: premiumInfo.is_gift || false
        };
    }
    
    for (const [userId, userCache] of Object.entries(transformedCache)) {
        premiumCache[userId] = userCache;
    }
    
    res.json({ success: true, message: "Premium data synced" });
});

app.post("/api/premium/grant", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId, durationDays = 30 } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const createdAt = Date.now();
        const premiumExpiresAt = durationDays > 0 ? createdAt + (durationDays * 24 * 60 * 60 * 1000) : null;
        const premiumExpiresAtSeconds = Math.floor((premiumExpiresAt || createdAt) / 1000);

        const userIdStr = String(userId);
        const purchaseId = `purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const purchase = {
            id: purchaseId,
            name: durationDays > 0 ? `${durationDays} Day Status Bot Premium` : "Permanent Status Bot Premium",
            code: purchaseId,
            durationDays: durationDays,
            createdAt,
            premiumExpiresAt: premiumExpiresAt,
            claimed: true,
            claimedAt: createdAt,
            type: 'purchase',
            isGlobal: false
        };

        if (!notificationsData[userIdStr]) {
            notificationsData[userIdStr] = { notifications: [], gifts: [] };
        }
        notificationsData[userIdStr].gifts.push({
            ...purchase,
            userId: userIdStr
        });

        if (!premiumCache[userIdStr]) {
            premiumCache[userIdStr] = {
                active: false,
                expiresAt: null
            };
        }
        premiumCache[userIdStr].active = true;
        premiumCache[userIdStr].expiresAt = premiumExpiresAtSeconds;
        premiumCache[userIdStr].reason = "Dashboard";
        premiumCache[userIdStr].source = "dashboard";
        premiumCache[userIdStr].duration_days = durationDays;

        const grantId = `grant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        pendingDashboardGrants[grantId] = {
            grantId,
            userId: userIdStr,
            source: "dashboard",
            expiryTime: premiumExpiresAtSeconds,
            durationDays,
            createdAt: Date.now()
        };

        saveNotifications();

        console.log(`✓ Premium granted to user ${userId} (expires: ${premiumExpiresAt ? new Date(premiumExpiresAt).toISOString() : 'Never'})`);

        res.json({ 
            success: true, 
            message: `Premium granted to user ${userId}`,
            expiresAt: premiumExpiresAt ? new Date(premiumExpiresAt).toISOString() : "Permanent",
            duration_days: durationDays,
            purchaseId
        });
    } catch (err) {
        console.error('Error granting premium:', err);
        res.status(500).json({ error: "Failed to grant premium", details: err.message });
    }
});

app.get("/api/premium-data", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        // Normalize the data to use 'expiry' field name consistently
        const normalizedCache = {};
        for (const [userId, data] of Object.entries(premiumCache)) {
            normalizedCache[userId] = {
                ...data,
                expiry: data.expiry || data.expiresAt  // Use 'expiry' field name consistently
            };
        }
        
        res.json({ premiumCache: normalizedCache });
    } catch (err) {
        console.error('Error fetching premium data:', err);
        res.status(500).json({ error: "Failed to fetch premium data" });
    }
});

app.post("/api/premium-data/get", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const botFormat = {};
        for (const [userId, cacheData] of Object.entries(premiumCache)) {
            botFormat[userId] = {
                active: cacheData.active || false,
                source: cacheData.source || 'unknown',
                expiry: cacheData.expiry || cacheData.expiresAt || null,
                duration_days: cacheData.duration_days || null,
                activated_at: new Date().toISOString()
            };
        }
        res.json({ premiumData: botFormat });
    } catch (err) {
        console.error('Error fetching premium data for bot:', err);
        res.status(500).json({ error: "Failed to fetch premium data" });
    }
});

app.get("/api/logged-in-users", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const users = Object.entries(knownUsers).map(([userId, data]) => ({
            id: userId,
            loginCount: data.loginCount || 0,
            lastLogin: data.lastLogin || null
        }));
        res.json({ users });
    } catch (err) {
        console.error('Error fetching logged-in users:', err);
        res.status(500).json({ error: "Failed to fetch logged-in users" });
    }
});

app.get("/api/premium/pending-dashboard-grants", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const grants = Object.values(pendingDashboardGrants);
        res.json({ grants: grants });
    } catch (err) {
        console.error('Error fetching pending grants:', err);
        res.status(500).json({ error: "Failed to fetch pending grants" });
    }
});

app.post("/api/premium/grant-processed", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { grantId } = req.body;
        if (grantId && pendingDashboardGrants[grantId]) {
            delete pendingDashboardGrants[grantId];
            res.json({ success: true });
        } else {
            res.status(400).json({ error: "Grant not found" });
        }
    } catch (err) {
        console.error('Error marking grant as processed:', err);
        res.status(500).json({ error: "Failed to mark grant as processed" });
    }
});

app.get("/api/channels/:guildId", (req, res) => {
    const { guildId } = req.params;

    const channels = serverChannels[guildId] || [];
    res.json({ guildId, channels });
});

app.post("/api/channels/:guildId", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
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


// USER & MEMBER ENDPOINTS
app.post("/api/resolve-user/:guildId", (req, res) => {
    const { guildId } = req.params;
    const { userReference } = req.body;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!userReference) {
        return res.status(400).json({ error: "userReference is required" });
    }

    try {
        let userId = null;
        const ref = userReference.trim();
        
        const mentionMatch = ref.match(/<@!?(\d+)>/);
        if (mentionMatch) {
            userId = mentionMatch[1];
        } 
        else if (/^\d+$/.test(ref)) {
            userId = ref;
        }
        else if (ref.startsWith('@')) {
            return res.status(400).json({ 
                error: "Username resolution unavailable",
                message: "Please use a numeric user ID or copy a proper Discord mention (right-click user > Copy User ID)"
            });
        } 
        else if (/^[a-zA-Z0-9_]+$/.test(ref)) {
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

let guildMembersCache = {};
const MEMBERS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours - members don't change often

// Initialize global tracking variables
global.apiRequestCount = global.apiRequestCount || 0;
global.rateLimitHits = global.rateLimitHits || 0;
global.lastRateLimit = global.lastRateLimit || null;

async function fetchWithRetry(url, options, maxRetries = 3) { // Reduced from 5 to 3
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            global.apiRequestCount++;
            const response = await fetch(url, options);
            
            if (response.status === 429) {
                global.rateLimitHits++;
                global.lastRateLimit = new Date().toISOString();
                
                const retryAfter = response.headers.get('Retry-After');
                const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(Math.pow(2, attempt + 1) * 1000, 30000);
                
                // Cap retry delay at 5 minutes (300,000ms) to prevent extremely long waits
                const cappedDelayMs = Math.min(retryAfterMs, 300000);
                
                console.warn(`⚠️ Rate limited on attempt ${attempt + 1}/${maxRetries}. Discord wants ${retryAfterMs}ms, capping at ${cappedDelayMs}ms...`);
                
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, cappedDelayMs));
                    continue;
                } else {
                    // If this is the last attempt and we're still rate limited, fail fast
                    console.error(`💥 Rate limited on final attempt. Discord API likely overwhelmed.`);
                    throw new Error(`Rate limited: Discord requested ${retryAfterMs}ms delay, too long to wait`);
                }
            }
            
            if (response.ok) {
                if (attempt > 0) {
                    console.log(`✅ Request succeeded on attempt ${attempt + 1}/${maxRetries}`);
                }
                return response;
            }
            
            // For non-429 errors, still return the response (let caller handle it)
            console.warn(`⚠️ API returned ${response.status} on attempt ${attempt + 1}/${maxRetries}`);
            if (attempt === maxRetries - 1) {
                return response; // Return even if not ok, let caller handle
            }
            
        } catch (err) {
            lastError = err;
            console.error(`❌ Network error on attempt ${attempt + 1}/${maxRetries}:`, err.message);
            
            if (attempt < maxRetries - 1) {
                const delay = Math.min(Math.pow(2, attempt + 1) * 1000, 10000); // Cap at 10s
                console.log(`⏳ Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    console.error(`💥 All ${maxRetries} attempts failed for ${url}`);
    throw lastError || new Error(`Max retries (${maxRetries}) exceeded`);
}

app.get('/api/guild/:guildId/members', async (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        if (guildMembersCache[guildId] && Date.now() - guildMembersCache[guildId].timestamp < MEMBERS_CACHE_TTL) {
            console.log(`✅ Returning cached member info for guild ${guildId}`);
            const cached = guildMembersCache[guildId].data;
            return res.json({ 
                members: cached.members || [], 
                memberCount: cached.memberCount || 0,
                onlineCount: cached.onlineCount || 0,
                guildName: cached.guildName || ''
            });
        }

        // Use deduplication to prevent duplicate API calls if multiple requests arrive simultaneously
        const guildData = await deduplicateRequest(`members_${guildId}`, async () => {
            console.log(`🔍 Fetching guild members for ${guildId}...`);
            
            // First get guild info for member count
            const guildResponse = await fetchWithRetry(
                `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
                {
                    headers: {
                        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
                    }
                }
            );

            if (!guildResponse.ok) {
                throw new Error(`Discord API error: ${guildResponse.status}`);
            }

            const guild = await guildResponse.json();

            // Then fetch actual members (limited to first 1000 to avoid massive responses)
            const membersResponse = await fetchWithRetry(
                `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,
                {
                    headers: {
                        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
                    }
                }
            );

            let members = [];
            if (membersResponse.ok) {
                const membersData = await membersResponse.json();
                members = membersData.map(member => ({
                    id: member.user.id,
                    username: member.user.username,
                    displayName: member.nick || member.user.global_name || member.user.username,
                    avatar: member.user.avatar 
                        ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
                        : null
                }));
                console.log(`✅ Fetched ${members.length} guild members`);
            } else {
                console.log(`⚠️ Could not fetch members: ${membersResponse.status} (likely missing GUILD_MEMBERS intent)`);
            }
            
            return {
                members,
                memberCount: guild.approximate_member_count || members.length,
                onlineCount: guild.approximate_presence_count || 0,
                guildName: guild.name,
                guildId: guild.id
            };
        });

        guildMembersCache[guildId] = {
            data: guildData,
            timestamp: Date.now()
        };

        // Return the actual member list
        res.json({ 
            members: guildData.members,
            memberCount: guildData.memberCount,
            onlineCount: guildData.onlineCount,
            guildName: guildData.guildName
        });
    } catch (err) {
        console.error('Error fetching guild members:', err);
        
        // Handle rate limit errors specifically
        if (err.message.includes('Rate limited') || err.message.includes('too long to wait')) {
            return res.status(429).json({ 
                error: "Discord API overwhelmed", 
                message: "Discord API is severely rate limited. Please wait before trying again.",
                retryAfter: 300 // Suggest 5 minutes
            });
        }
        
        res.status(500).json({ error: "Failed to fetch guild members", details: err.message });
    }
});


// LEVELING ENDPOINTS
app.get("/api/leveling/:guildId/settings", (req, res) => {
    const { guildId } = req.params;

    try {
        let xpSettings = {};
        const xpSettingsPath = path.join(__dirname, 'xp_settings.json');
        
        if (fs.existsSync(xpSettingsPath)) {
            const fileContent = fs.readFileSync(xpSettingsPath, 'utf8');
            xpSettings = JSON.parse(fileContent);
        }

        const defaultSettings = {
            enabled: false,
            xp_per_message: 10,
            vc_xp_per_minute: 2,
            level_up_message: "🎉 {user} reached level {level}!",
            level_up_channel: null,
            allowed_xp_channels: [],
            leveling_type: 'linear'
        };

        let settings = defaultSettings;
        if (xpSettings[guildId]) {
            settings = xpSettings[guildId];
        }

        res.json(settings);
    } catch (err) {
        console.error('Error loading leveling settings:', err);
        res.json({
            enabled: false,
            xp_per_message: 10,
            vc_xp_per_minute: 2,
            level_up_message: "🎉 {user} reached level {level}!",
            level_up_channel: null,
            allowed_xp_channels: [],
            leveling_type: 'linear'
        });
    }
});

app.post("/api/leveling/:guildId/settings", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;

    const { enabled, xpPerMessage, voiceXp, xpCooldown, levelUpMessage, levelUpChannel, allowedChannels, leveling_type } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    if (!global.levelingSettings) {
        global.levelingSettings = {};
    }

    global.levelingSettings[guildId] = {
        enabled: enabled || false,
        xp_per_message: xpPerMessage || 10,
        vc_xp_per_minute: voiceXp || 10,
        xp_cooldown: xpCooldown || 60,
        level_up_message: levelUpMessage || "🎉 {user} has reached Level {level}!",
        level_up_channel: levelUpChannel || null,
        allowed_xp_channels: allowedChannels ? (typeof allowedChannels === 'string' ? allowedChannels.split(',').map(s => s.trim()) : allowedChannels) : [],
        leveling_type: leveling_type || 'linear',
        lastUpdated: new Date().toISOString()
    };

    try {
        let xpSettings = {};
        const xpSettingsPath = path.join(__dirname, 'xp_settings.json');
        
        try {
            if (fs.existsSync(xpSettingsPath)) {
                const fileContent = fs.readFileSync(xpSettingsPath, 'utf8');
                xpSettings = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new xp_settings.json file');
        }
        
        xpSettings[guildId] = {
            enabled: enabled || false,
            leveling_type: leveling_type || 'linear',
            xp_per_message: xpPerMessage || 10,
            vc_xp_per_minute: voiceXp || 10,
            xp_cooldown: xpCooldown || 60,
            level_up_message: levelUpMessage || "🎉 {user} has reached Level {level}!",
            level_up_channel: levelUpChannel || null,
            allowed_xp_channels: allowedChannels ? (typeof allowedChannels === 'string' ? allowedChannels.split(',').map(s => s.trim()) : allowedChannels) : []
        };
        
        fs.writeFileSync(xpSettingsPath, JSON.stringify(xpSettings, null, 4));
        console.log(`✅ Leveling settings saved to xp_settings.json for guild ${guildId}:`, xpSettings[guildId]);
    } catch (err) {
        console.error('Error saving leveling settings to file:', err);
    }

    res.json({ 
        success: true, 
        message: "Leveling settings saved", 
        settings: global.levelingSettings[guildId] 
    });
});

app.get("/api/leveling/:guildId/leaderboard", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const leaderboard = serverData[guildId]?.allUsers || [];

    res.json({ 
        guildId,
        users: leaderboard
    });
});


// ECONOMY ENDPOINTS
app.get("/api/economy/:guildId/settings", (req, res) => {
    const { guildId } = req.params;

    try {
        let economyData = { settings: {} };
        const economyFilePath = path.join(__dirname, 'economy_data.json');
        
        if (fs.existsSync(economyFilePath)) {
            const fileContent = fs.readFileSync(economyFilePath, 'utf8');
            economyData = JSON.parse(fileContent);
        }

        const defaultSettings = {
            enabled: false,
            per_message: 5,
            currency_symbol: "💰",
            start: 500,
            balance_multiplier: 1.0,
            daily_interest_rate: 0,
            robbery_chance: 50,
            work_reward_multiplier: 1.0
        };

        let settings = defaultSettings;
        if (economyData.settings && economyData.settings[guildId]) {
            settings = economyData.settings[guildId];
        }

        res.json(settings);
    } catch (err) {
        console.error('Error loading economy settings:', err);
        res.json({
            enabled: false,
            per_message: 5,
            currency_symbol: "💰",
            start: 500,
            balance_multiplier: 1.0,
            daily_interest_rate: 0,
            robbery_chance: 50,
            work_reward_multiplier: 1.0
        });
    }
});

app.post("/api/economy/:guildId/settings", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;

    const { enabled, currencyPerMessage, currencySymbol, startingAmount, balanceMultiplier, dailyInterestRate, robberyChance, workRewardMultiplier } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    if (!global.economySettings) {
        global.economySettings = {};
    }

    global.economySettings[guildId] = {
        enabled: enabled || false,
        per_message: currencyPerMessage || 10,
        currency_symbol: currencySymbol || "💰",
        start: startingAmount || 500,
        balance_multiplier: balanceMultiplier || 1.0,
        daily_interest_rate: dailyInterestRate || 0,
        robbery_chance: robberyChance || 50,
        work_reward_multiplier: workRewardMultiplier || 1.0,
        lastUpdated: new Date().toISOString()
    };

    try {
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
        
        economyData.settings[guildId] = {
            enabled: enabled || false,
            per_message: currencyPerMessage || 10,
            currency_symbol: currencySymbol || "💰",
            start: startingAmount || 500,
            balance_multiplier: balanceMultiplier || 1.0,
            daily_interest_rate: dailyInterestRate || 0,
            robbery_chance: robberyChance || 50,
            work_reward_multiplier: workRewardMultiplier || 1.0
        };
        
        fs.writeFileSync(economyFilePath, JSON.stringify(economyData, null, 4));
        console.log(`✅ Economy settings saved to economy_data.json for guild ${guildId}:`, economyData.settings[guildId]);
    } catch (err) {
        console.error('Error saving economy settings to file:', err);
    }

    res.json({ 
        success: true, 
        message: "Economy settings saved", 
        settings: global.economySettings[guildId] 
    });
});

app.post("/api/economy/:guildId/reset-balances", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;
    
    console.log(`🔄 Reset balances requested for guild ${guildId}`);

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
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

        const startingAmount = economyData.settings[guildId]?.start || 500;
        console.log(`📊 Guild ${guildId} starting amount: ${startingAmount}`);

        if (!economyData.balances[guildId]) {
            economyData.balances[guildId] = {};
        }

        const users = Object.keys(economyData.balances[guildId]);
        console.log(`👥 Found ${users.length} users in guild ${guildId}`);
        
        users.forEach(userId => {
            economyData.balances[guildId][userId] = startingAmount;
        });

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


// WELCOME ENDPOINTS
app.get("/api/welcome/:guildId/settings", (req, res) => {
    const { guildId } = req.params;

    try {
        let welcomeData = {};
        const welcomeFilePath = path.join(__dirname, 'welcome_data.json');
        
        if (fs.existsSync(welcomeFilePath)) {
            const fileContent = fs.readFileSync(welcomeFilePath, 'utf8');
            welcomeData = JSON.parse(fileContent);
        }

        const defaultSettings = {
            enabled: false,
            use_embed: false,
            channel_id: null,
            message_text: 'Welcome to {server_name}, {user}!',
            embed_title: 'Welcome!',
            embed_description: '',
            embed_footer: 'Thanks for joining!',
            embed_thumbnail: '',
            embed_image: '',
            embed_color: '#5170ff',
            embed_fields: '[]',
            member_count_channel_id: null,
            member_goal_channel_id: null,
            member_goal: 0
        };

        let settings = defaultSettings;
        
        if (welcomeData[guildId]) {
            settings = welcomeData[guildId];
        }

        res.json(settings);
    } catch (err) {
        console.error('Error reading welcome settings:', err);
        res.json({
            enabled: false,
            use_embed: false,
            channel_id: null,
            message_text: 'Welcome to {server_name}, {user}!',
            embed_title: 'Welcome!',
            embed_description: '',
            embed_footer: 'Thanks for joining!',
            embed_thumbnail: '',
            embed_image: '',
            embed_color: '#5170ff',
            embed_fields: '[]',
            member_count_channel_id: null,
            member_goal_channel_id: null,
            member_goal: 0
        });
    }
});

app.post("/api/welcome/:guildId/settings", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;

    const { enabled, use_embed, channel_id, message_text, embed_title, embed_description, embed_footer, embed_thumbnail, embed_image, embed_color, embed_fields, member_count_channel_id, member_goal_channel_id, member_goal } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    if (!global.welcomeSettings) {
        global.welcomeSettings = {};
    }

    global.welcomeSettings[guildId] = {
        enabled: enabled === true,
        use_embed: use_embed === true,
        channel_id: channel_id || null,
        message_text: message_text || "Welcome to {server_name}, {user}!",
        embed_title: embed_title ?? "Welcome!",
        embed_description: embed_description || "",
        embed_footer: embed_footer || "",
        embed_thumbnail: embed_thumbnail || "",
        embed_image: embed_image || "",
        embed_color: embed_color || "#5170ff",
        embed_fields: embed_fields || "[]",
        member_count_channel_id: member_count_channel_id || null,
        member_goal_channel_id: member_goal_channel_id || null,
        member_goal: member_goal || 0,
        lastUpdated: new Date().toISOString()
    };

    try {
        let welcomeData = {};
        const welcomeFilePath = path.join(__dirname, 'welcome_data.json');
        
        try {
            if (fs.existsSync(welcomeFilePath)) {
                const fileContent = fs.readFileSync(welcomeFilePath, 'utf8');
                welcomeData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new welcome_data.json file');
        }
        
        welcomeData[guildId] = {
            enabled: enabled === true,
            use_embed: use_embed === true,
            channel_id: channel_id || null,
            message_text: message_text || "Welcome to {server_name}, {user}!",
            embed_title: embed_title ?? "Welcome!",
            embed_description: embed_description || "",
            embed_footer: embed_footer || "",
            embed_thumbnail: embed_thumbnail || "",
            embed_image: embed_image || "",
            embed_color: embed_color || "#5170ff",
            embed_fields: embed_fields || "[]",
            member_count_channel_id: member_count_channel_id || null,
            member_goal_channel_id: member_goal_channel_id || null,
            member_goal: member_goal || 0
        };
        
        fs.writeFileSync(welcomeFilePath, JSON.stringify(welcomeData, null, 4));
        console.log(`✅ Welcome settings saved to file for guild ${guildId}:`, JSON.stringify(welcomeData[guildId], null, 2));
    } catch (err) {
        console.error('Error saving welcome settings to file:', err);
    }

    res.json({ 
        success: true, 
        message: "Welcome settings saved", 
        settings: global.welcomeSettings[guildId]
    });
});

app.post("/api/welcome/:guildId/member-goals", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;
    const { enabled, member_count_channel_id, member_goal_channel_id, member_goal } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
        let welcomeData = {};
        const welcomeFilePath = path.join(__dirname, 'welcome_data.json');
        
        try {
            if (fs.existsSync(welcomeFilePath)) {
                const fileContent = fs.readFileSync(welcomeFilePath, 'utf8');
                welcomeData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new welcome_data.json file');
        }
        
        if (!welcomeData[guildId]) {
            welcomeData[guildId] = {};
        }
        
        welcomeData[guildId].member_count_channel_id = member_count_channel_id || null;
        welcomeData[guildId].member_goal_channel_id = member_goal_channel_id || null;
        welcomeData[guildId].member_goal = member_goal || 0;
        
        fs.writeFileSync(welcomeFilePath, JSON.stringify(welcomeData, null, 4));
        console.log(`✅ Member goals settings saved to file for guild ${guildId}`);
    } catch (err) {
        console.error('Error saving member goals settings to file:', err);
    }

    res.json({ 
        success: true, 
        message: "Member goals settings saved"
    });
});

// LEAVE MESSAGE ENDPOINTS
app.get("/api/leave/:guildId/settings", (req, res) => {
    const { guildId } = req.params;

    try {
        let leaveData = {};
        const leaveFilePath = path.join(__dirname, 'leave_data.json');
        
        if (fs.existsSync(leaveFilePath)) {
            const fileContent = fs.readFileSync(leaveFilePath, 'utf8');
            leaveData = JSON.parse(fileContent);
        }

        const defaultSettings = {
            enabled: false,
            use_embed: false,
            channel_id: null,
            message_text: 'Goodbye {user}!',
            embed_title: 'Member Left',
            embed_description: '',
            embed_footer: '',
            embed_thumbnail: '',
            embed_image: '',
            embed_color: '#5170ff',
            embed_fields: '[]'
        };

        let settings = defaultSettings;
        
        if (leaveData[guildId]) {
            settings = leaveData[guildId];
        }

        res.json(settings);
    } catch (err) {
        console.error('Error reading leave settings:', err);
        res.json({
            enabled: false,
            use_embed: false,
            channel_id: null,
            message_text: 'Goodbye {user}!',
            embed_title: 'Member Left',
            embed_description: '',
            embed_footer: '',
            embed_thumbnail: '',
            embed_image: '',
            embed_color: '#5170ff',
            embed_fields: '[]'
        });
    }
});

app.post("/api/leave/:guildId/settings", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;

    const { enabled, use_embed, channel_id, message_text, embed_title, embed_description, embed_footer, embed_thumbnail, embed_image, embed_color, embed_fields } = req.body;

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    if (!global.leaveSettings) {
        global.leaveSettings = {};
    }

    global.leaveSettings[guildId] = {
        enabled: enabled === true,
        use_embed: use_embed === true,
        channel_id: channel_id || null,
        message_text: message_text || "Goodbye {user}!",
        embed_title: embed_title ?? "Member Left",
        embed_description: embed_description || "",
        embed_footer: embed_footer || "",
        embed_thumbnail: embed_thumbnail || "",
        embed_image: embed_image || "",
        embed_color: embed_color || "#5170ff",
        embed_fields: embed_fields || "[]",
        lastUpdated: new Date().toISOString()
    };

    try {
        let leaveData = {};
        const leaveFilePath = path.join(__dirname, 'leave_data.json');
        
        try {
            if (fs.existsSync(leaveFilePath)) {
                const fileContent = fs.readFileSync(leaveFilePath, 'utf8');
                leaveData = JSON.parse(fileContent);
            }
        } catch (err) {
            console.log('Creating new leave_data.json file');
        }
        
        leaveData[guildId] = {
            enabled: enabled === true,
            use_embed: use_embed === true,
            channel_id: channel_id || null,
            message_text: message_text || "Goodbye {user}!",
            embed_title: embed_title ?? "Member Left",
            embed_description: embed_description || "",
            embed_footer: embed_footer || "",
            embed_thumbnail: embed_thumbnail || "",
            embed_image: embed_image || "",
            embed_color: embed_color || "#5170ff",
            embed_fields: embed_fields || "[]"
        };
        
        fs.writeFileSync(leaveFilePath, JSON.stringify(leaveData, null, 4));
        console.log(`✅ Leave settings saved to file for guild ${guildId}:`, JSON.stringify(leaveData[guildId], null, 2));
    } catch (err) {
        console.error('Error saving leave settings to file:', err);
    }

    res.json({ 
        success: true, 
        message: "Leave settings saved", 
        settings: global.leaveSettings[guildId]
    });
});

// STATUS TRACKING ENDPOINTS
app.get("/api/status-data", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        let statusData = {};
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        if (fs.existsSync(statusFilePath)) {
            const fileContent = fs.readFileSync(statusFilePath, 'utf8');
            const parsed = JSON.parse(fileContent);
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

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
        let statusData = { settings: {} };
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        if (fs.existsSync(statusFilePath)) {
            const fileContent = fs.readFileSync(statusFilePath, 'utf8');
            statusData = JSON.parse(fileContent);
        }

        const defaultSettings = {
            enabled: false,
            user_id: null,
            channel_id: null,
            delay_seconds: 0,
            offline_message: "User is currently offline",
            automatic: false,
            use_embed: true,
            message_id: null
        };

        let settings = defaultSettings;
        if (statusData.settings && statusData.settings[guildId]) {
            settings = statusData.settings[guildId];
        }

        res.json(settings);
    } catch (err) {
        console.error('Error fetching status settings:', err);
        res.json({
            enabled: false,
            user_id: null,
            channel_id: null,
            delay_seconds: 0,
            offline_message: "User is currently offline",
            automatic: false,
            use_embed: true,
            message_id: null
        });
    }
});

app.get("/api/status-data", (req, res) => {
    // Endpoint for bot to fetch all status tracking data
    try {
        const statusFilePath = path.join(__dirname, 'status_data.json');
        
        if (fs.existsSync(statusFilePath)) {
            const fileContent = fs.readFileSync(statusFilePath, 'utf8');
            const statusData = JSON.parse(fileContent);
            res.json(statusData);
        } else {
            res.json({});
        }
    } catch (err) {
        console.error('Error fetching status data:', err);
        res.json({});
    }
});

app.post("/api/status/:guildId/settings", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;

    const { enabled, user_id, channel_id, delay_seconds, automatic, use_embed, offline_message, userToTrack, trackingChannel, delay, useEmbed, offlineMessage } = req.body;
    
    // Support both camelCase and snake_case for backward compatibility
    const userId = user_id || userToTrack || "";
    const channelId = channel_id || trackingChannel || "";
    const delayValue = delay_seconds !== undefined ? delay_seconds : (delay || 30);
    const useEmbedValue = use_embed !== undefined ? use_embed : useEmbed;
    const offlineMsg = offline_message || offlineMessage || "User is currently offline";

    if (!guildId) {
        return res.status(400).json({ error: "guildId is required" });
    }

    try {
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

        const oldSettings = statusData.settings[guildId] || {};
        const oldMessageId = oldSettings.message_id;
        const oldChannelId = oldSettings.channel_id;
        
        // QUEUE DELETION BEFORE CLEARING MESSAGE ID if channel/message changed
        if (oldMessageId && oldMessageId !== "" && oldMessageId !== "undefined" && oldChannelId && oldChannelId !== "" && oldChannelId !== "undefined") {
            if (oldChannelId !== channelId) {
                try {
                    let pendingPosts = { posts: [] };
                    const pendingPath = path.join(__dirname, 'pending_posts.json');
                    
                    try {
                        if (fs.existsSync(pendingPath)) {
                            const fileContent = fs.readFileSync(pendingPath, 'utf8');
                            const parsed = JSON.parse(fileContent);
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
                    
                    if (!pendingPosts.posts) {
                        pendingPosts.posts = [];
                    }
                    
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
                }
            }
        }
        
        statusData.settings[guildId] = {
            enabled: enabled === true,
            user_id: userId,
            channel_id: channelId,
            delay_seconds: delayValue,
            offline_message: offlineMsg,
            automatic: automatic === true,
            use_embed: useEmbedValue === true,
            message_id: "", // Always post new message
            created_at: oldSettings.created_at || new Date().toISOString()
        };
        
        fs.writeFileSync(statusFilePath, JSON.stringify(statusData, null, 4));
        console.log(`✅ Status settings saved to status_data.json for guild ${guildId}:`, statusData.settings[guildId]);

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

app.post("/api/status/:guildId/message-id", (req, res) => {
    const { guildId } = req.params;
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { messageId, channelId } = req.body;

    if (!guildId || !messageId || !channelId) {
        return res.status(400).json({ error: "guildId, messageId, and channelId are required" });
    }

    try {
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

        const oldSettings = statusData.settings[guildId] || {};
        const oldMessageId = oldSettings.message_id;
        const oldChannelId = oldSettings.channel_id;

        if (statusData.settings[guildId]) {
            statusData.settings[guildId].message_id = messageId;
            statusData.settings[guildId].last_message_timestamp = new Date().toISOString();
        } else {
            console.warn(`⚠️ Guild ${guildId} settings not found when storing message ID`);
        }

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
                if (Array.isArray(parsed)) {
                    pendingPosts = { posts: parsed };
                } else if (parsed && typeof parsed === 'object' && parsed.posts) {
                    pendingPosts = parsed;
                }
            }
        } catch (err) {
            console.log('No pending posts file');
        }

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
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { user_id, channel_id, offline_message, use_embed } = req.body;

    if (!guildId || !user_id || !channel_id) {
        return res.status(400).json({ error: "guildId, user_id, and channel_id are required" });
    }

    try {
        let pendingPosts = { posts: [] };
        const pendingPostsPath = path.join(__dirname, 'pending_posts.json');
        
        try {
            if (fs.existsSync(pendingPostsPath)) {
                const fileContent = fs.readFileSync(pendingPostsPath, 'utf8');
                const parsed = JSON.parse(fileContent);
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

app.post("/api/status/:guildId/force-update", verifyDiscordToken, (req, res) => {
    const { guildId } = req.params;
    const { user_id } = req.body;
    
    console.log('🔄 Force update request received:', {
        guildId,
        user_id,
        hasGuildId: !!guildId,
        hasUserId: !!user_id
    });

    if (!guildId || !user_id) {
        console.log('❌ Missing required parameters for force update');
        return res.status(400).json({ error: "guildId and user_id are required" });
    }

    try {
        // Queue an immediate status update by sending it to the pending posts
        if (!global.statusPendingPosts) {
            global.statusPendingPosts = [];
        }

        // Load settings from global cache or from file
        let statusSettings = global.statusSettings ? global.statusSettings[guildId] : null;
        
        if (!statusSettings) {
            // Try loading from file if not in memory
            try {
                const statusFilePath = path.join(__dirname, 'status_data.json');
                if (fs.existsSync(statusFilePath)) {
                    const fileContent = fs.readFileSync(statusFilePath, 'utf8');
                    const statusData = JSON.parse(fileContent);
                    statusSettings = statusData[guildId];
                }
            } catch (err) {
                // File read failed, continue without it
            }
        }
        
        if (!statusSettings || !statusSettings.enabled) {
            return res.status(400).json({ error: "Status tracking not enabled for this guild" });
        }

        // Add to pending posts with high priority
        global.statusPendingPosts.unshift({
            guildId: guildId,
            userId: user_id,
            channelId: statusSettings.channel_id,
            useEmbed: statusSettings.use_embed,
            offlineMessage: statusSettings.offline_message,
            timestamp: Date.now()
        });

        res.json({ 
            success: true, 
            message: "Status update queued - will be processed by the bot",
            status: "queued"
        });
    } catch (err) {
        console.error('Error force updating status:', err);
        res.status(500).json({ error: "Failed to queue status update", details: err.message });
    }
});


// TRIALS & GIFTS ENDPOINTS
app.post("/api/trials/send", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId, dashboardDurationDays, premiumTrialDurationDays, targetUsers, sendToAll } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const dashboardDays = dashboardDurationDays || 7;
        const premiumDays = premiumTrialDurationDays || 7;

        const createdAt = Date.now();
        const dashboardExpiresAt = createdAt + (dashboardDays * 24 * 60 * 60 * 1000);
        const premiumExpiresAt = createdAt + (premiumDays * 24 * 60 * 60 * 1000);

        let sent = 0;
        let skipped = 0;
        const createdTrials = [];

        const sendTrialToUser = (targetUserId) => {
            const userPrefs = userNotificationPreferences[String(targetUserId)] || { trials: true };
            
            if (userPrefs.trials !== false) {
                // Generate a UNIQUE trial code for each user
                const trialId = `trial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${targetUserId}`;
                
                const trial = {
                    id: trialId,
                    name: `${premiumDays} Day Status Bot Premium Trial`,
                    code: `||${trialId}||`,
                    dashboardDurationDays: dashboardDays,
                    premiumTrialDurationDays: premiumDays,
                    createdAt,
                    dashboardExpiresAt,
                    premiumExpiresAt,
                    claimed: false,
                    claimedAt: null,
                    isGlobal: sendToAll || (targetUsers && targetUsers.length === 0)
                };
                
                if (!notificationsData[String(targetUserId)]) {
                    notificationsData[String(targetUserId)] = { notifications: [], gifts: [] };
                }
                notificationsData[String(targetUserId)].gifts.push({
                    ...trial,
                    userId: String(targetUserId)
                });
                
                const userIdStr = String(targetUserId);
                if (!premiumCache[userIdStr]) {
                    premiumCache[userIdStr] = {
                        active: false,
                        expiry: null
                    };
                }
                premiumCache[userIdStr].active = true;
                premiumCache[userIdStr].expiry = Math.floor(premiumExpiresAt / 1000);
                premiumCache[userIdStr].reason = "Trial";
                premiumCache[userIdStr].source = "trial";
                premiumCache[userIdStr].duration_days = premiumDays;
                
                createdTrials.push(trial);
                sent++;
            } else {
                skipped++;
            }
        };

        if (sendToAll || (targetUsers && targetUsers.length === 0)) {
            const allUserIds = Object.keys(knownUsers);
            if (allUserIds.length === 0) {
                return res.status(400).json({ error: "No users have logged in yet. Send to specific user IDs instead." });
            }
            
            // Send unique trial to each user
            allUserIds.forEach(targetUserId => {
                sendTrialToUser(targetUserId);
            });
            
            saveNotifications();
            savePremiumData(premiumCache);
        } else if (targetUsers && Array.isArray(targetUsers) && targetUsers.length > 0) {
            targetUsers.forEach(targetUserId => {
                sendTrialToUser(targetUserId);
            });
            saveNotifications();
            savePremiumData(premiumCache);
        } else {
            sendTrialToUser(userId);
            saveNotifications();
            savePremiumData(premiumCache);
        }

        res.json({ 
            success: true, 
            message: `Trial sent to ${sent} users (${skipped} skipped due to disabled preferences). Each user received their own unique trial code.`,
            sent,
            skipped,
            total: sent + skipped,
            trialsCreated: createdTrials.length,
            premiumExpiresAt
        });
    } catch (err) {
        console.error('Error creating trial:', err);
        res.status(500).json({ error: "Failed to create trial", details: err.message });
    }
});

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

        let trial = null;
        let isGlobal = false;

        const userNotifications = notificationsData[userId];
        if (userNotifications && userNotifications.gifts) {
            trial = userNotifications.gifts.find(g => g.id === trialId);
        }

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

        trial.claimed = true;
        trial.claimedAt = Date.now();

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

app.get("/api/user/:userId/gifts", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId } = req.params;
        
        trackUser(userId);
        
        const now = Date.now();

        let gifts = [];
        const userNotifications = notificationsData[String(userId)];
        if (userNotifications && userNotifications.gifts) {
            gifts = userNotifications.gifts.filter(gift => {
                const expiryTime = gift.dashboardExpiresAt || gift.expiresAt;
                return expiryTime > now && !gift.claimed;
            });
        }

        const activeGlobalGifts = globalGifts.filter(gift => {
            const expiryTime = gift.dashboardExpiresAt || gift.expiresAt;
            return expiryTime > now && !gift.claimed;
        });
        gifts = gifts.concat(activeGlobalGifts);

        res.json({ gifts });
    } catch (err) {
        console.error('Error fetching gifts:', err);
        res.status(500).json({ error: "Failed to fetch gifts" });
    }
});

app.post("/api/gifts/claim", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId, giftId } = req.body;
        
        if (!userId || !giftId) {
            return res.status(400).json({ error: "userId and giftId are required" });
        }
        
        const userNotifications = notificationsData[String(userId)];
        let gift = null;
        
        // Check user-specific gifts first
        if (userNotifications && userNotifications.gifts) {
            gift = userNotifications.gifts.find(g => g.id === giftId);
            if (gift) {
                gift.claimed = true;
                gift.claimedAt = Date.now();
            }
        }
        
        // If not found, check global gifts
        if (!gift) {
            gift = globalGifts.find(g => g.id === giftId);
            if (gift) {
                gift.claimed = true;
                gift.claimedAt = Date.now();
            }
        }
        
        if (gift) {
            const claimId = `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const expiryTime = Math.floor(Date.now() / 1000) + (gift.premiumTrialDurationDays * 24 * 60 * 60);

            pendingPremiumClaims[claimId] = {
                userId: String(userId),
                giftId: giftId,
                durationDays: gift.premiumTrialDurationDays,
                expiryTime,
                createdAt: Date.now(),
                processed: false,
                processedAt: null
            };
            
            saveNotifications();
            savePendingClaims();
            
            res.json({ 
                success: true, 
                message: "Gift claimed successfully! Premium will be activated shortly.",
                claimId,
                gift 
            });
        } else {
            res.status(404).json({ error: "Gift not found" });
        }
    } catch (err) {
        console.error('Error claiming gift:', err);
        res.status(500).json({ error: "Failed to claim gift", details: err.message });
    }
});


// NOTIFICATIONS ENDPOINTS
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

        const notification = {
            id: notificationId,
            title,
            message,
            type,
            createdAt,
            read: false,
            isGlobal: sendToAll || (targetUsers && targetUsers.length === 0)
        };

        let sent = 0;
        let skipped = 0;
        const typeKey = type.toLowerCase();

        const sendNotificationToUser = (userId) => {
            const userPrefs = userNotificationPreferences[String(userId)] || { 
                updates: true, 
                gifts: true, 
                trials: true, 
                community: true 
            };
            
            if (userPrefs[typeKey] !== false) {
                if (!notificationsData[String(userId)]) {
                    notificationsData[String(userId)] = { notifications: [], gifts: [] };
                }
                notificationsData[String(userId)].notifications.push(notification);
                sent++;
            } else {
                skipped++;
            }
        };

        if (sendToAll || (targetUsers && targetUsers.length === 0)) {
            // Add to global notifications for dev management
            globalNotifications.push(notification);
            saveGlobalData();
            
            const allUserIds = Object.keys(knownUsers);
            allUserIds.forEach(userId => {
                sendNotificationToUser(userId);
            });
            saveNotifications();
        } else if (targetUsers && Array.isArray(targetUsers) && targetUsers.length > 0) {
            targetUsers.forEach(userId => {
                sendNotificationToUser(userId);
            });
            saveNotifications();
        }

        res.json({ 
            success: true, 
            type,
            message: `Notification sent to ${sent} users (${skipped} skipped due to disabled preferences)`,
            sent,
            skipped,
            total: sent + skipped,
            notificationId
        });
    } catch (err) {
        console.error('Error sending notification:', err);
        res.status(500).json({ error: "Failed to send notification", details: err.message });
    }
});

app.post("/api/user/:userId/notifications", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId } = req.params;
        const { updates, gifts, trials, community } = req.body;
        
        trackUser(userId);
        
        userNotificationPreferences[String(userId)] = {
            updates: updates !== false,
            gifts: gifts !== false,
            trials: trials !== false,
            community: community !== false
        };
        
        saveUserPreferences();
        
        res.json({ 
            success: true, 
            message: "Notification preferences saved",
            preferences: userNotificationPreferences[String(userId)]
        });
    } catch (err) {
        console.error('Error saving notification preferences:', err);
        res.status(500).json({ error: "Failed to save preferences", details: err.message });
    }
});

app.get("/api/user/:userId/notifications", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId } = req.params;
        
        trackUser(userId);
        
        const now = Date.now();
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

        let notifications = [];
        const userNotifications = notificationsData[userId];
        if (userNotifications && userNotifications.notifications) {
            // Show all notifications (no expiration)
            notifications = userNotifications.notifications;
        }

        // Show all global notifications (no expiration)
        const activeGlobalNotifications = globalNotifications;
        notifications = notifications.concat(activeGlobalNotifications);

        res.json({ notifications });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});

app.post("/api/user/:userId/notifications/read", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { userId } = req.params;
        
        if (notificationsData[String(userId)] && notificationsData[String(userId)].notifications) {
            notificationsData[String(userId)].notifications.forEach(n => {
                n.read = true;
            });
        }
        
        globalNotifications.forEach(n => {
            if (!n.readBy) n.readBy = [];
            n.readBy.push(String(userId));
        });
        
        saveNotifications();
        
        res.json({ success: true, message: "All notifications marked as read" });
    } catch (err) {
        console.error('Error marking notifications as read:', err);
        res.status(500).json({ error: "Failed to mark notifications as read" });
    }
});

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

// ANNOUNCEMENT MANAGEMENT ENDPOINTS (DEV)
app.get("/api/announcements", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        res.json({ 
            announcements: globalNotifications.map(n => ({
                id: n.id,
                title: n.title,
                message: n.message,
                type: n.type,
                createdAt: n.createdAt,
                createdAtFormatted: new Date(n.createdAt).toLocaleString()
            }))
        });
    } catch (err) {
        console.error('Error fetching announcements:', err);
        res.status(500).json({ error: "Failed to fetch announcements" });
    }
});

app.delete("/api/announcements/:announcementId", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { announcementId } = req.params;
        
        const announcementIndex = globalNotifications.findIndex(n => n.id === announcementId);
        if (announcementIndex === -1) {
            return res.status(404).json({ error: "Announcement not found" });
        }

        const removedAnnouncement = globalNotifications[announcementIndex];
        globalNotifications.splice(announcementIndex, 1);
        saveGlobalData();

        // Also remove from all user notifications
        Object.values(notificationsData).forEach(userData => {
            if (userData.notifications) {
                const userNotifIndex = userData.notifications.findIndex(n => n.id === announcementId);
                if (userNotifIndex !== -1) {
                    userData.notifications.splice(userNotifIndex, 1);
                }
            }
        });
        saveNotifications();

        res.json({ 
            success: true, 
            message: `Announcement "${removedAnnouncement.title}" removed successfully`,
            removedAnnouncement: {
                id: removedAnnouncement.id,
                title: removedAnnouncement.title,
                createdAt: removedAnnouncement.createdAt
            }
        });
    } catch (err) {
        console.error('Error removing announcement:', err);
        res.status(500).json({ error: "Failed to remove announcement" });
    }
});


// DATA MANAGEMENT FUNCTIONS
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
        Object.keys(data).forEach(key => {
            premiumCache[key] = data[key];
        });
    } catch (err) {
        console.error('Error saving premium data:', err);
    }
}

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

let userNotificationPreferences = {};

function loadUserPreferences() {
    try {
        const prefsPath = path.join(__dirname, 'notification_preferences.json');
        if (fs.existsSync(prefsPath)) {
            userNotificationPreferences = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        }
    } catch (err) {
        console.log('User preferences file not found, starting fresh');
        userNotificationPreferences = {};
    }
}

function saveUserPreferences() {
    try {
        const prefsPath = path.join(__dirname, 'notification_preferences.json');
        fs.writeFileSync(prefsPath, JSON.stringify(userNotificationPreferences, null, 4));
    } catch (err) {
        console.error('Error saving user preferences:', err);
    }
}

loadNotifications();
loadUserPreferences();

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

loadPendingClaims();


// USER CREDITS ENDPOINTS
app.get("/api/premium-credits/:userId", (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    
    const userId = req.params.userId;
    if (!userId) {
        return res.status(400).json({ error: "User ID required" });
    }

    const userCredits = premiumCache[userId] || 0;
    
    res.json({ userId, credits: userCredits });
});


// LOGS ENDPOINTS
let allLogs = [];
const MAX_LOGS = 5000;

app.post("/api/logs/add", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const { event_type, description, user_id, guild_id, details } = req.body;
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            event_type,
            description,
            user_id,
            guild_id,
            details: details || {}
        };
        
        allLogs.push(logEntry);
        
        // Keep only last MAX_LOGS entries
        if (allLogs.length > MAX_LOGS) {
            allLogs = allLogs.slice(-MAX_LOGS);
        }
        
        res.json({ success: true, message: "Log saved" });
    } catch (err) {
        res.status(500).json({ error: "Failed to save log", details: err.message });
    }
});

app.get("/api/logs/:guildId", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { guildId } = req.params;
    const limit = req.query.limit || 100;

    try {
        const guildLogs = allLogs
            .filter(log => log.guild_id === guildId)
            .slice(-limit);
        
        res.json({
            guildId,
            count: guildLogs.length,
            logs: guildLogs
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch logs", details: err.message });
    }
});

app.get("/api/logs", (req, res) => {
    const SECRET_KEY = process.env.BOT_STATS_SECRET || "status-bot-stats-secret-key";
    const authHeader = req.headers['authorization'] || '';
    
    if (authHeader !== `Bearer ${SECRET_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = req.query.limit || 100;

    try {
        const paginatedLogs = allLogs.slice(-limit);
        
        res.json({
            count: paginatedLogs.length,
            logs: paginatedLogs
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch logs", details: err.message });
    }
});


// STAFF APPLICATIONS
const FORMS_FILE = path.join(__dirname, 'data', 'staff_forms.json');
const SUBMISSIONS_FILE = path.join(__dirname, 'data', 'staff_submissions.json');

function loadStaffForms() {
    try {
        if (fs.existsSync(FORMS_FILE)) {
            return JSON.parse(fs.readFileSync(FORMS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Error loading staff forms:', err);
    }
    return [];
}

function saveStaffForms(forms) {
    try {
        fs.writeFileSync(FORMS_FILE, JSON.stringify(forms, null, 2));
    } catch (err) {
        console.error('Error saving staff forms:', err);
    }
}

function loadSubmissions() {
    try {
        if (fs.existsSync(SUBMISSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Error loading submissions:', err);
    }
    return [];
}

function saveSubmissions(submissions) {
    try {
        fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
    } catch (err) {
        console.error('Error saving submissions:', err);
    }
}

// Get all staff forms
app.get('/api/staff/forms', (req, res) => {
    const forms = loadStaffForms();
    res.json(forms);
});

// Get active staff forms (for applicants)
app.get('/api/staff/forms/active', (req, res) => {
    const forms = loadStaffForms();
    const activeForms = forms.filter(f => f.active !== false);
    res.json(activeForms);
});

// Create or update a staff form
app.post('/api/staff/forms', (req, res) => {
    try {
        const { id, title, description, questions, requiresApproval, active } = req.body;
        
        if (!title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Invalid form data' });
        }

        const forms = loadStaffForms();
        const existingIndex = forms.findIndex(f => f.id == id);
        
        const formData = {
            id: id || Date.now(),
            title,
            description,
            questions,
            requiresApproval: requiresApproval || false,
            active: active !== false,
            createdAt: existingIndex >= 0 ? forms[existingIndex].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (existingIndex >= 0) {
            forms[existingIndex] = formData;
        } else {
            forms.push(formData);
        }

        saveStaffForms(forms);
        res.json(formData);
    } catch (error) {
        console.error('Error saving form:', error);
        res.status(500).json({ error: 'Failed to save form' });
    }
});

// Update a staff form (PUT endpoint for CORS preflight)
app.put('/api/staff/forms', (req, res) => {
    try {
        const { id, title, description, questions, requiresApproval, active } = req.body;
        
        if (!title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Invalid form data' });
        }

        const forms = loadStaffForms();
        const existingIndex = forms.findIndex(f => f.id == id);
        
        const formData = {
            id: id || Date.now(),
            title,
            description,
            questions,
            requiresApproval: requiresApproval || false,
            active: active !== false,
            createdAt: existingIndex >= 0 ? forms[existingIndex].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (existingIndex >= 0) {
            forms[existingIndex] = formData;
        } else {
            forms.push(formData);
        }

        saveStaffForms(forms);
        res.json(formData);
    } catch (error) {
        console.error('Error saving form:', error);
        res.status(500).json({ error: 'Failed to save form' });
    }
});

// Delete a staff form
app.delete('/api/staff/forms/:formId', (req, res) => {
    try {
        const forms = loadStaffForms();
        const newForms = forms.filter(f => f.id != req.params.formId);
        
        if (newForms.length === forms.length) {
            return res.status(404).json({ error: 'Form not found' });
        }

        saveStaffForms(newForms);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting form:', error);
        res.status(500).json({ error: 'Failed to delete form' });
    }
});

// Submit a staff application
app.post('/api/staff/submissions', (req, res) => {
    try {
        const { formId, formTitle, responses, status } = req.body;

        if (!formId || !responses) {
            return res.status(400).json({ error: 'Invalid submission data' });
        }

        const submissions = loadSubmissions();
        const submission = {
            id: Date.now(),
            formId,
            formTitle,
            responses,
            status: status || 'submitted',
            timestamp: new Date().toISOString(),
            reviewedAt: null,
            rejectionReason: null,
        };

        submissions.push(submission);
        saveSubmissions(submissions);

        // Send webhook notification
        const webhookUrl = process.env.FORM_SUBMISSION_WEBHOOK;
        if (webhookUrl) {
            fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: '@everyone',
                    embeds: [{
                        title: '📝 New Form Submission',
                        description: `A new user has submitted the **${formTitle}** form.`,
                        color: 16711680,
                        timestamp: new Date().toISOString(),
                        footer: { text: 'Staff Applications' }
                    }]
                })
            }).catch(err => console.error('Error sending webhook:', err));
        }

        res.json(submission);
    } catch (error) {
        console.error('Error submitting application:', error);
        res.status(500).json({ error: 'Failed to submit application' });
    }
});

// Get all submissions (for staff review)
app.get('/api/staff/submissions', (req, res) => {
    try {
        const submissions = loadSubmissions();
        res.json(submissions);
    } catch (error) {
        console.error('Error loading submissions:', error);
        res.status(500).json({ error: 'Failed to load submissions' });
    }
});

// Update submission status (approve/reject)
app.patch('/api/staff/submissions/:submissionId', (req, res) => {
    try {
        const { status, rejectionReason } = req.body;
        const submissions = loadSubmissions();
        const submissionIndex = submissions.findIndex(s => s.id == req.params.submissionId);

        if (submissionIndex < 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        submissions[submissionIndex].status = status;
        submissions[submissionIndex].reviewedAt = new Date().toISOString();
        if (rejectionReason) {
            submissions[submissionIndex].rejectionReason = rejectionReason;
        }

        saveSubmissions(submissions);
        res.json(submissions[submissionIndex]);
    } catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).json({ error: 'Failed to update submission' });
    }
});


// INITIALIZATION - LOAD DATA FROM FILES ON STARTUP
function initializeSettingsFromFiles() {
    try {
        // Load leveling settings
        const xpFilePath = path.join(__dirname, 'xp_settings.json');
        if (fs.existsSync(xpFilePath)) {
            global.xpSettings = JSON.parse(fs.readFileSync(xpFilePath, 'utf8'));
        }
    } catch (err) {
        console.log('No leveling settings found to load');
    }

    try {
        // Load economy settings
        const economyFilePath = path.join(__dirname, 'economy_data.json');
        if (fs.existsSync(economyFilePath)) {
            const economyData = JSON.parse(fs.readFileSync(economyFilePath, 'utf8'));
            if (economyData.settings) {
                global.economySettings = economyData.settings;
            }
        }
    } catch (err) {
        console.log('No economy settings found to load');
    }

    try {
        // Load status settings
        const statusFilePath = path.join(__dirname, 'status_data.json');
        if (fs.existsSync(statusFilePath)) {
            const statusData = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
            if (statusData.settings) {
                global.statusSettings = statusData.settings;
            }
        }
    } catch (err) {
        console.log('No status settings found to load');
    }

    try {
        // Load welcome settings
        const welcomeFilePath = path.join(__dirname, 'welcome_data.json');
        if (fs.existsSync(welcomeFilePath)) {
            const welcomeData = JSON.parse(fs.readFileSync(welcomeFilePath, 'utf8'));
            global.welcomeSettings = welcomeData;
        }
    } catch (err) {
        console.log('No welcome settings found to load');
    }

    console.log('✅ Settings initialized from files on startup');
}

initializeSettingsFromFiles();


// SERVER STARTUP
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
