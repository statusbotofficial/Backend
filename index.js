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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
