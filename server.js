import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const { message } = req.body;

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: "Missing OpenAI API Key." });
    }

    if (!message) {
        return res.status(400).json({ error: "Missing user message." });
    }

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo", // use a faster/lighter model for now
                messages: [
                    { role: "system", content: "You are a helpful assistant for Resto Supply Hub customers." },
                    { role: "user", content: message },
                ],
            }),
        });

        const data = await response.json();
        console.log("🔍 OpenAI API Response:", JSON.stringify(data, null, 2));

        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) {
            console.error("❌ GPT returned no content.");
            return res.status(500).json({ reply: "GPT response missing." });
        }

        res.status(200).json({ reply });
    } catch (err) {
        console.error("🔥 Caught server error:", err.message);
        res.status(500).json({ error: "Server error", details: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 GPT Chatbot running on port ${PORT}`));
