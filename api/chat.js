export default async function handler(req, res) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Only POST allowed' });
    }

    try {
        const { message } = req.body;

        const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant for Resto Supply Hub customers.' },
                    { role: 'user', content: message }
                ]
            })
        });

        const data = await apiRes.json();
        res.status(200).json({ reply: data.choices?.[0]?.message?.content || 'Sorry, something went wrong.' });

    } catch (err) {
        console.error('OpenAI error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
}
