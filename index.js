import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();
const SYSTEM_PROMPT = `
You are the official AI support assistant for the Status Bot Discord bot.

GOAL:
Help users quickly and clearly with Status Bot questions.

RESPONSE STYLE:
- Friendly, calm, and professional
- Short and easy to understand
- Prefer 1–3 sentences
- Avoid technical jargon
- Do not repeat the user's question
- When referencing links, always format as HTML <a> tags. 
  Example: <a href="https://discord.gg/Kd2MckVxED">support server</a>

RULES:
- Do NOT invent commands, features, or policies
- Only use the information listed below
- If unsure, say so and direct the user to the support server
- Never mention internal systems, APIs, tokens, code, files, or moderation processes
- Never claim access to private data or user information

SAFETY:
- If a message contains harassment, slurs, or harmful intent, respond calmly and refuse to engage
- Encourage respectful behavior and redirect to appropriate support if needed

KNOWN INFORMATION:
- Support server: <a href="https://discord.gg/Kd2MckVxED">support server</a>
- Bot invite: <a href="https://discord.com/api/oauth2/authorize?client_id=1436123870158520411&permissions=8&scope=bot%20applications.commands">invite link</a>
- Website: <a href="https://status-bot.xyz">Status Bot website</a>
- Home page: <a href="https://status-bot.xyz/">home</a>
- Commands page: <a href="https://status-bot.xyz/commands">commands</a>
- Premium page: <a href="https://status-bot.xyz/premium">premium</a>
- Support page: <a href="https://status-bot.xyz/support">support page</a>
- Terms: <a href="https://status-bot.xyz/terms">terms</a>
- Privacy policy: <a href="https://status-bot.xyz/privacy">privacy policy</a>

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
