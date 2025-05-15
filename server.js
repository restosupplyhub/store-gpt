// server.js
/* ------------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot Backend
   • Loads storeInfo.json (hours, promos, etc.)
   • Fetches full Shopify catalog at boot & every 6 h
   • Sends store-info + catalog + general-chat system prompt
   • Accepts full chat history; returns HTML reply
------------------------------------------------------------------ */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

/* ENV */
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // e.g. restosupplyhub.myshopify.com

/* CACHES */
let catalogLines = [];  // Markdown bullets with masked links
let storeInfo = {};  // from storeInfo.json

/* Load static store info */
function loadStoreInfo() {
    try {
        storeInfo = JSON.parse(fs.readFileSync("./storeInfo.json", "utf8"));
        console.log("📖 storeInfo.json loaded.");
    } catch {
        console.warn("⚠️ storeInfo.json missing or invalid.");
        storeInfo = {};
    }
}

/* Fetch full Shopify catalog (runs at boot + every 6 h) */
async function fetchCatalog() {
    if (!SHOPIFY_TOKEN || !SHOPIFY_DOMAIN) {
        console.warn("Shopify env vars missing; catalog fetch skipped.");
        return;
    }
    console.log("⏳ Fetching full catalog…");
    const out = [];
    const PAGE = 250;
    let cursor = null;

    while (true) {
        const query = `
      query($first:Int!,$after:String) {
        products(first:$first, after:$after) {
          edges {
            cursor
            node {
              title handle
              variants(first:1) {
                edges { node { price { amount currencyCode } } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }`;
        const variables = { first: PAGE, after: cursor };

        const res = await fetch(`https://${SHOPIFY_DOMAIN}/api/2024-01/graphql.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN
            },
            body: JSON.stringify({ query, variables })
        });
        const json = await res.json();
        const edges = json.data.products.edges;

        edges.forEach(({ node }) => {
            const v0 = node.variants.edges[0]?.node;
            const price = v0 ? `${v0.price.amount} ${v0.price.currencyCode}` : "—";
            const url = `https://${SHOPIFY_DOMAIN}/products/${node.handle}`;
            out.push(`• ${node.title} – $${price} – [View item →](${url})`);
        });

        if (!json.data.products.pageInfo.hasNextPage) break;
        cursor = edges.at(-1).cursor;
    }

    catalogLines = out;
    console.log(`✅ Catalog loaded (${catalogLines.length} items).`);
}

/* Build store-info snippet */
function storeInfoSnippet() {
    return `
Office hours: ${storeInfo.office_hours || "—"}
Contact: ${storeInfo.phone || ""} • ${storeInfo.email || ""}
Current offer: ${storeInfo.promo || "—"}
Returns: ${storeInfo.returns || "—"}
Shipping: ${storeInfo.shipping || "—"}
Tracking: ${storeInfo.tracking || "—"}
`.trim();
}

/* Boot tasks */
loadStoreInfo();
fetchCatalog().catch(console.error);
setInterval(fetchCatalog, 6 * 60 * 60 * 1000);

/* Express setup */
const app = express();
app.use(cors());
app.use(express.json());

/* Chat endpoint */
app.post("/chat", async (req, res) => {
    try {
        const history = req.body.messages;
        if (!Array.isArray(history) || !history.length)
            return res.status(400).json({ error: "messages array required" });
        if (!OPENROUTER_API_KEY)
            return res.status(500).json({ error: "Missing OpenRouter API key" });

        const system = {
            role: "system",
            content: `
You are a friendly AI assistant for Resto Supply Hub.

We stock **${catalogLines.length} products**.

===== Store Info =====
${storeInfoSnippet()}

===== Catalog =====
Below is the full catalog (Markdown). Reference any line verbatim; do NOT expose raw URLs.
${catalogLines.join("\n")}

===== Conversational Guidelines =====
1. For greetings (“hi”, “hello”), reply with a friendly HTML paragraph (<p>…</p>).
2. For product requests, convert the Markdown bullets into an HTML ordered list (<ol><li>…</li></ol>).
3. For store info (hours, tracking, returns, promos), use the store-info above, wrapped in <p>…</p>.
4. Always output valid HTML: <p>, <ol>, <li>, <a>.
`.trim()
        };

        const catalogMsg = {
            role: "assistant",
            name: "catalog",
            content: catalogLines.join("\n")
        };

        const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: [system, catalogMsg, ...history]
            })
        });

        const apiJson = await apiRes.json();
        const reply = apiJson?.choices?.[0]?.message?.content
            || "<p>Sorry, I couldn’t generate a response right now.</p>";
        res.json({ reply });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

/* Start */
app.listen(PORT, () => console.log(`🚀 Chatbot API on port ${PORT}`));
