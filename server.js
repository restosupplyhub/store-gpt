// server.js
/* ------------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot Backend (DeepSeek only + full HTML list)
------------------------------------------------------------------ */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

/* ─── ENV ─────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // e.g. restosupplyhub.myshopify.com

/* ─── CACHES ─────────────────────────────────────────────────── */
let catalogHtml = "";  // "<ol>…</ol>"
let storeInfo = {};  // loaded from storeInfo.json

/* ─── Load storeInfo.json once ───────────────────────────────── */
function loadStoreInfo() {
    try {
        storeInfo = JSON.parse(fs.readFileSync("./storeInfo.json", "utf8"));
        console.log("📖 storeInfo.json loaded.");
    } catch {
        console.warn("⚠️ storeInfo.json missing or invalid.");
        storeInfo = {};
    }
}

/* ─── Fetch full catalog & build HTML list ───────────────────── */
async function buildCatalogHtml() {
    if (!SHOPIFY_TOKEN || !SHOPIFY_DOMAIN) {
        console.warn("Shopify env vars missing; skipping catalog build.");
        return;
    }

    console.log("⏳ Fetching full catalog…");
    const lines = [];
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
        const vars = { first: PAGE, after: cursor };

        const res = await fetch(`https://${SHOPIFY_DOMAIN}/api/2024-01/graphql.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN
            },
            body: JSON.stringify({ query, variables: vars })
        });
        const json = await res.json();
        const edges = json.data.products.edges;

        edges.forEach(({ node }) => {
            const v0 = node.variants.edges[0]?.node;
            const price = v0 ? `${v0.price.amount} ${v0.price.currencyCode}` : "—";
            const url = `https://${SHOPIFY_DOMAIN}/products/${node.handle}`;
            lines.push(
                `<li><a href="${url}" target="_blank" rel="noopener">${node.title}</a> — $${price}</li>`
            );
        });

        if (!json.data.products.pageInfo.hasNextPage) break;
        cursor = edges.at(-1).cursor;
    }

    catalogHtml = `<ol>\n${lines.join("\n")}\n</ol>`;
    console.log(`✅ Built HTML catalog with ${lines.length} items.`);
}

/* ─── Build store-info snippet ───────────────────────────────── */
const storeInfoHtml = () => `
<p><strong>Office hours:</strong> ${storeInfo.office_hours || "—"}</p>
<p><strong>Contact:</strong> ${storeInfo.phone || ""} • ${storeInfo.email || ""}</p>
<p><strong>Promo:</strong> ${storeInfo.promo || "—"}</p>
<p><strong>Returns:</strong> ${storeInfo.returns || "—"}</p>
<p><strong>Shipping:</strong> ${storeInfo.shipping || "—"}</p>
<p><strong>Tracking:</strong> ${storeInfo.tracking || "—"}</p>
`.trim();

/* ─── Initialize caches ───────────────────────────────────────── */
loadStoreInfo();
buildCatalogHtml().catch(console.error);
setInterval(buildCatalogHtml, 6 * 60 * 60 * 1000);  // refresh every 6h

/* ─── Express setup ─────────────────────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json());

/* ─── /chat endpoint (DeepSeek only) ─────────────────────────── */
app.post("/chat", async (req, res) => {
    try {
        const history = req.body.messages;
        if (!Array.isArray(history) || !history.length) {
            return res.status(400).json({ error: "messages array required" });
        }
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({ error: "Missing OpenRouter API key" });
        }

        /* Build system prompt */
        const system = {
            role: "system",
            content: `
You are the RSH AI assistant for Resto Supply Hub.

We have ${catalogHtml
                    .match(/<li/g)?.length || 0} products in our catalog.

===== Store Info =====
${storeInfoHtml()}

===== Catalog HTML =====
Here is our complete catalog as HTML. When asked for products, use this list exactly:
${catalogHtml}

===== Instructions =====
• If the user greets you (“hi”, “hello”), reply with a friendly <p>…</p>.  
• If asked “Office Hours”, reply with <p>Our office hours are ${storeInfo.office_hours}.</p>.  
• For product requests, respond by referencing or transforming the above <ol>…</ol> HTML.  
• For other queries, answer in <p>…</p> paragraphs.  
• Always return valid HTML and do NOT wrap it in markdown fences.
`.trim()
        };

        /* Call DeepSeek only */
        const rr = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "deepseek/deepseek-prover-v2",
                messages: [system, ...history]
            })
        });
        const jr = await rr.json();

        /* Surface errors */
        if (jr.error) {
            console.error("OpenRouter error:", jr.error);
            return res.json({ reply: `<p>AI error: ${jr.error.message}</p>` });
        }

        /* Extract reply */
        const reply = jr.choices?.[0]?.message?.content
            || "<p>Sorry, no answer right now.</p>";

        res.json({ reply });
    } catch (e) {
        console.error("🔥 /chat error:", e);
        res.status(500).json({ error: "Server error" });
    }
});

/* ─── Launch ──────────────────────────────────────────────────── */
app.listen(PORT, () => {
    console.log(`🚀 Chatbot API listening on ${PORT}`);
});
