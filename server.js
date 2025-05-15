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
                model: "gpt-4", // Optionally test with "gpt-3.5-turbo" too
                messages: [
                    { role: "system", content: "You are a helpful assistant for Resto Supply Hub customers." },
                    { role: "user", content: message },
                ],
            }),
        });

        const data = await response.json();
        console.log("🔎 OpenAI raw response:", JSON.stringify(data, null, 2)); // ADD THIS
        const reply = data?.choices?.[0]?.message?.content;

        res.status(200).json({ reply: reply || "⚠️ OpenAI returned no message." });
    } catch (err) {
        console.error("🔥 OpenAI error:", err);
        res.status(500).json({ error: "OpenAI request failed.", details: err.message });
    }
});
