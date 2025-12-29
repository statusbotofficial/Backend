import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();

app.use(cors({
    origin: "https://status-bot.xyz"
}));
app.use(express.json());

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

app.post("/api/support/ai", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || message.length > 500) {
            return res.status(400).json({
                reply: "Please enter a valid message under 500 characters."
            });
        }

        const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content:
                        "You are an official AI support assistant for the Status Bot Discord bot. " +
                        "Help users with commands, features, premium, errors, and direct them to the support Discord if needed."
                },
                {
                    role: "user",
                    content: message
                }
            ],
            temperature: 0.6
        });

        res.json({
            reply: completion.choices[0].message.content
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            reply: "Something went wrong. Please try again or join the support Discord."
        });
    }
});

app.get("/", (req, res) => {
    res.send("Status Bot Support API is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
