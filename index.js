import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();

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
            temperature: 0.6,
            messages: [
                {
                    role: "system",
                    content:
                        "You are the official AI support assistant for the Status Bot Discord bot. " +
                        "Help with commands, features, premium, errors. If unsure, direct users to the support Discord."
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
