/* ---------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot
   • Loads storeInfo.json + full catalog (6 h refresh)
   • Injects masked product links  [View item →](https://...)
   • Keeps full user/assistant history from browser
---------------------------------------------------------------- */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

/* ── ENV ─────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;           // e.g. restosupplyhub.myshopify.com

/* ── In-memory caches ────────────────────────────────────────── */
let catalog = [];                 // all products
let storeInfo = {};                 // office hours, promos, etc.

/* Load storeInfo.json once */
function loadStoreInfo() {
    try {
        storeInfo = JSON.parse(fs.readFileSync("./storeInfo.json", "utf8"));
        console.log("📖 storeInfo.json loaded.");
    } catch {
        console.warn("⚠️ storeInfo.json missing or invalid.");
    }
}

/* Fetch complete catalog (runs at boot + every 6 h) */
async function fetchCatalog() {
    if (!SHOPIFY_TOKEN || !SHOPIFY_DOMAIN) {
        console.warn("Shopify env vars missing — catalog fetch skipped.");
        return;
    }
    console.log("⏳ Fetching product catalog …");
    const out = [];
    const PAGE = 250;
    let cursor = null;

    while (true) {
        const query = `
      query($f:Int!, $a:String) {
        products(first:$f, after:$a) {
          edges {
            cursor
            node {
              title handle tags
              variants(first:1) { edges { node { price { amount currencyCode } } } }
            }
          }
          pageInfo { hasNextPage }
        }
      }`;
        const variables = { f: PAGE, a: cursor };

        const r = await fetch(`https://${SHOPIFY_DOMAIN}/api/2024-01/graphql.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN
            },
            body: JSON.stringify({ query, variables })
        });
        const j = await r.json();
        const edges = j.data.products.edges;

        edges.forEach(e => {
            const v0 = e.node.variants.edges[0]?.node;
            out.push({
                title: e.node.title,
                handle: e.node.handle,
                tags: e.node.tags,
                price: v0 ? `${v0.price.amount} ${v0.price.currencyCode}` : "—"
            });
        });

        if (!j.data.products.pageInfo.hasNextPage) break;
        cursor = edges.at(-1).cursor;
    }

    catalog = out;
    console.log(`✅ Catalog ready (${catalog.length} products).`);
}

/* Helper: tiny store-info block */
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

/* Helper: build up-to-8 product lines with masked links */
function productMatches(keyword, max = 8) {
    const kw = keyword.toLowerCase();
    return catalog
        .filter(
            p =>
                p.title.toLowerCase().includes(kw) ||
                p.tags.some(t => t.toLowerCase().includes(kw))
        )
        .slice(0, max)
        .map(p => {
            const url = `https://${SHOPIFY_DOMAIN}/products/${p.handle}`;
            return `• ${p.title} – $${p.price} – [View item →](${url})`;
        })
        .join("\n");
}

/* ── Initialisation ──────────────────────────────────────────── */
loadStoreInfo();
fetchCatalog().catch(console.error);
setInterval(fetchCatalog, 6 * 60 * 60 * 1000);   // every 6 h

/* ── Express app ─────────────────────────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
    try {
        const history = req.body.messages;
        if (!Array.isArray(history) || !history.length)
            return res.status(400).json({ error: "messages array required" });

        if (!OPENROUTER_API_KEY)
            return res.status(500).json({ error: "Missing OpenRouter key" });

        const lastUser = history.slice().reverse().find(m => m.role === "user")?.content || "";
        const products = productMatches(lastUser);

        const system = {
            role: "system",
            content: `
You are a helpful agent for Resto Supply Hub.

===== Store Info =====
${storeInfoSnippet()}

===== Matching Products =====
${products || "— no relevant products —"}

If you mention a product, reference it with the phrase **“View item →”** (already included).
Do not reveal raw URLs.
`.trim()
        };

        const ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: [system, ...history]
            })
        });

        const j = await ai.json();
        const reply = j?.choices?.[0]?.message?.content || "Sorry, no answer.";
        res.json({ reply });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(PORT, () => console.log(`🚀 Chatbot API on :${PORT}`));
