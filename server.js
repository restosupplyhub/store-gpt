const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const { message } = req.body;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    { role: "system", content: "You are a helpful assistant for Resto Supply Hub customers." },
                    { role: "user", content: message },
                ],
            }),
        });

        const data = await response.json();
        res.status(200).json({ reply: data.choices?.[0]?.message?.content || "No response from GPT." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error." });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
