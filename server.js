import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const { message } = req.body;

    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({ error: "Missing OpenRouter API key." });
    }

    if (!message) {
        return res.status(400).json({ error: "No message provided." });
    }

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant for Resto Supply Hub's Shopify customers. Provide clear, friendly, and product-specific answers to help users with their orders, product inquiries, and store-related questions.",
                    },
                    {
                        role: "user",
                        content: message,
                    },
                ],
            }),
        });

        const data = await response.json();
        console.log("🧠 OpenRouter Response:", JSON.stringify(data, null, 2));

        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) {
            return res.status(502).json({ reply: "⚠️ OpenRouter returned no reply." });
        }

        res.status(200).json({ reply });
    } catch (err) {
        console.error("🔥 Server error:", err.message);
        res.status(500).json({ error: "Server error", details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Shopify Chatbot running on port ${PORT}`);
});
