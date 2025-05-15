/* ---------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot
   • Fetches the entire product catalog at boot
   • Caches in memory, refreshes every 6 h
---------------------------------------------------------------- */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

/* ────── ENV ────── */
const PORT = process.env.PORT || 3000;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;           // restosupplyhub.myshopify.com

/* ────── App setup ────── */
const app = express();
app.use(cors());
app.use(express.json());

/* ────── In-memory catalog cache ────── */
let catalog = [];          // { title, handle, price, tags[] }

async function fetchWholeCatalog() {
    if (!SHOPIFY_TOKEN || !SHOPIFY_DOMAIN) {
        console.error("❌ Missing SHOPIFY env vars — catalog fetch skipped.");
        return;
    }

    console.log("⏳ Fetching full catalog from Shopify …");
    const PAGE = 250;
    let cursor = null;
    const out = [];

    while (true) {
        const query = `
      query ($first:Int!, $after:String) {
        products(first:$first, after:$after) {
          edges {
            cursor
            node {
              title handle tags
              variants(first: 1) { edges { node { price { amount currencyCode } } } }
            }
          }
          pageInfo { hasNextPage }
        }
      }`;
        const vars = { first: PAGE, after: cursor };

        const r = await fetch(`https://${SHOPIFY_DOMAIN}/api/2024-01/graphql.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN
            },
            body: JSON.stringify({ query, variables: vars })
        });
        const j = await r.json();
        if (j.errors) throw new Error(JSON.stringify(j.errors));

        const edges = j.data.products.edges;
        edges.forEach(e => {
            const v0 = e.node.variants.edges[0]?.node;
            out.push({
                title: e.node.title,
                handle: e.node.handle,
                tags: e.node.tags,
                price: v0 ? `${v0.price.amount} ${v0.price.currencyCode}` : "N/A"
            });
        });

        if (!j.data.products.pageInfo.hasNextPage) break;
        cursor = edges[edges.length - 1].cursor;
    }

    catalog = out;
    console.log(`✅ Catalog loaded (${catalog.length} products).`);
}

/* kick off once at boot */
fetchWholeCatalog()
    .catch(err => console.error("Catalog fetch failed:", err))
    .finally(() => {
        /* schedule automatic refresh every 6 h */
        setInterval(fetchWholeCatalog, 6 * 60 * 60 * 1000);
    });

/* ────── Helper: search catalog quickly ────── */
function searchCatalog(keyword, max = 8) {
    if (!keyword) return "";
    const kw = keyword.toLowerCase();
    return catalog
        .filter(p => p.title.toLowerCase().includes(kw) || p.tags.some(t => t.toLowerCase().includes(kw)))
        .slice(0, max)
        .map(p => `• ${p.title} – $${p.price} – https://${SHOPIFY_DOMAIN}/products/${p.handle}`)
        .join("\n");
}

/* ────── Chat endpoint ────── */
app.post("/chat", async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: "No message" });
        if (!OPENROUTER_API_KEY) return res.status(500).json({ error: "Missing OpenRouter key" });

        /* crude keyword extraction = last 3 words */
        const keyword = message.split(/\s+/).slice(-3).join(" ");
        const miniCatalog = searchCatalog(keyword);

        const prompt = `
You are a helpful assistant for customers of Resto Supply Hub (https://www.restosupplyhub.com).
Below are live catalog items that matched the user's keywords. Mention them if useful.
${miniCatalog || "— no direct matches —"}
    `.trim();

        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: message }
                ]
            })
        });

        const j = await aiRes.json();
        const reply = j?.choices?.[0]?.message?.content
            || "Sorry, I couldn't get an answer right now.";
        res.json({ reply });

    } catch (err) {
        console.error("🔥 /chat error:", err);
        res.status(500).json({ error: "Server error", details: err.message });
    }
});

/* ────── Start server ASAP (catalog will fill when ready) ────── */
app.listen(PORT, () => console.log(`🚀 GPT chatbot listening on :${PORT}`));
