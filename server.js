/* ------------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot Backend (HTML output)
------------------------------------------------------------------ */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

// ─── ENVIRONMENT ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // e.g. restosupplyhub.myshopify.com

// ─── CACHES ───────────────────────────────────────────────────────
let catalogLines = [];  // Markdown lines; we'll wrap in HTML later
let storeInfo = {};  // Loaded from storeInfo.json

// ─── LOAD STATIC STORE INFO ──────────────────────────────────────
function loadStoreInfo() {
    try {
        storeInfo = JSON.parse(fs.readFileSync("./storeInfo.json", "utf8"));
        console.log("📖 storeInfo.json loaded.");
    } catch {
        console.warn("⚠️ storeInfo.json missing or invalid.");
        storeInfo = {};
    }
}

// ─── FETCH FULL SHOPIFY CATALOG ──────────────────────────────────
async function fetchCatalog() {
    if (!SHOPIFY_TOKEN || !SHOPIFY_DOMAIN) {
        console.warn("Shopify env vars missing; skipping catalog fetch.");
        return;
    }
    console.log("⏳ Fetching full Shopify catalog…");
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
              variants(first:1) { edges { node { price { amount currencyCode } } } }
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
            // keep Markdown link; we'll convert in frontend to HTML <a>
            out.push(`• ${node.title} – $${price} – [View item →](${url})`);
        });

        if (!json.data.products.pageInfo.hasNextPage) break;
        cursor = edges.at(-1).cursor;
    }

    catalogLines = out;
    console.log(`✅ Catalog loaded (${catalogLines.length} items).`);
}

// ─── BUILD STORE INFO SNIPPET ───────────────────────────────────
function storeInfoSnippet() {
    return `
Office hours: ${storeInfo.office_hours || "—"}
Contact: ${storeInfo.phone || ""} • ${storeInfo.email || ""}
Current offer: ${storeInfo.promo || "—"}
Returns: ${storeInfo.returns || "—"}
Shipping: ${storeInfo.shipping || "—"}
Tracking FAQ: ${storeInfo.tracking || "—"}
`.trim();
}

// ─── INITIALIZATION ─────────────────────────────────────────────
loadStoreInfo();
fetchCatalog().catch(console.error);
setInterval(fetchCatalog, 6 * 60 * 60 * 1000); // refresh every 6 hours

// ─── EXPRESS APP ────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── CHAT ENDPOINT ──────────────────────────────────────────────
app.post("/chat", async (req, res) => {
    try {
        const history = req.body.messages;
        if (!Array.isArray(history) || history.length === 0) {
            return res.status(400).json({ error: "messages array required" });
        }
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({ error: "Missing OpenRouter API key" });
        }

        // Build a system prompt that instructs HTML output
        const system = {
            role: "system",
            content: `
You are a helpful assistant for Resto Supply Hub.

We currently stock **${catalogLines.length} products**.

===== Store Info =====
${storeInfoSnippet()}

===== Full Catalog =====
Below is the complete catalog as Markdown with links.
**Your job**: When the user asks to list products or global info:
  1. Convert the Markdown list into an HTML ordered list (<ol><li> … </li></ol>).
  2. Keep the link text exactly as “View item →” and render as an <a> tag.
  3. Surround this HTML snippet with no additional wrapper—return only the HTML.
  4. For non-catalog answers, return plain HTML paragraphs (<p>…</p>).

**Do NOT** output any raw Markdown or plain text for product lists.  Always output valid HTML.
`.trim()
        };

        // Send the raw catalog markdown in its own message role
        const catalogMsg = {
            role: "assistant",
            name: "catalog",
            content: catalogLines.join("\n")
        };

        // Call the model
        const ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct:free",
                messages: [system, catalogMsg, ...history]
            })
        });

        const j = await ai.json();
        const reply = j?.choices?.[0]?.message?.content || "<p>Sorry, no answer.</p>";
        res.json({ reply });

    } catch (err) {
        console.error("🔥 /chat error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ─── START SERVER ───────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Chatbot API listening on port ${PORT}`);
});
