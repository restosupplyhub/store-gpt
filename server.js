// server.js
/* ------------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot Backend   (with model fallbacks)
------------------------------------------------------------------ */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

/* ── ENV ───────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // e.g. restosupplyhub.myshopify.com

/* ── CACHES ────────────────────────────────────────────────────── */
let catalogLines = [];  // Markdown bullets (masked links)
let storeInfo = {};  // office hours, promos, etc.

/* ── Load static store info ───────────────────────────────────── */
function loadStoreInfo() {
    try {
        storeInfo = JSON.parse(fs.readFileSync("./storeInfo.json", "utf8"));
        console.log("📖 storeInfo.json loaded.");
    } catch {
        console.warn("⚠️ storeInfo.json missing or invalid.");
        storeInfo = {};
    }
}

/* ── Fetch full Shopify catalog (runs at boot + every 6 h) ────── */
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
      query($f:Int!,$a:String) {
        products(first:$f, after:$a) {
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

        edges.forEach(({ node }) => {
            const v0 = node.variants.edges[0]?.node;
            const price = v0 ? `${v0.price.amount} ${v0.price.currencyCode}` : "—";
            const url = `https://www.restosupplyhub.com/products/${node.handle}`;
            out.push(`• ${node.title} | $${price} | ${url}`);
        });

        if (!j.data.products.pageInfo.hasNextPage) break;
        cursor = edges.at(-1).cursor;
    }

    catalogLines = out;
    console.log(`✅ Catalog loaded (${catalogLines.length} items).`);
}

/* ── Helper: store-info snippet ───────────────────────────────── */
const storeInfoSnippet = () => `
Office hours: ${storeInfo.office_hours || "—"}
Contact: ${storeInfo.phone || ""} • ${storeInfo.email || ""}
Current offer: ${storeInfo.promo || "—"}
Returns: ${storeInfo.returns || "—"}
Shipping: ${storeInfo.shipping || "—"}
Tracking: ${storeInfo.tracking || "—"}
`.trim();

/* ── Bootstrap ───────────────────────────────────────────────── */
loadStoreInfo();
fetchCatalog().catch(console.error);
setInterval(fetchCatalog, 6 * 60 * 60 * 1000); // every 6 h

/* ── Express setup ───────────────────────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json());

/* ── Chat endpoint with model fallback list ───────────────────── */
app.post("/chat", async (req, res) => {
    try {
        const history = req.body.messages;
        if (!Array.isArray(history) || !history.length)
            return res.status(400).json({ error: "messages array required" });
        if (!OPENROUTER_API_KEY)
            return res.status(500).json({ error: "Missing OpenRouter API key" });

        /* Build system prompt */
        const system = {
            role: "system",
            content: `
You are a friendly AI assistant for Resto Supply Hub. Your name is RSH assistant.

We currently have ${catalogLines.length} products.

===== Store Info =====
${storeInfoSnippet()}

===== Instructions =====
• If greeted (“hi”, “hello”), reply with a friendly <p>Hello …</p>.
• If user asks “Office Hours”, respond with: <p>Our office hours are ${storeInfo.office_hours}.</p>
• For product queries, turn catalog bullets into an HTML <ol><li>…</li></ol>.
• Answer other questions in HTML <p>…</p> paragraphs.
• Always output valid HTML; never raw Markdown.

`.trim()
        };

        /* Catalog slice (first 200 lines ≈ 2-3k tokens) */
        const catalogMsg = {
            role: "assistant",
            name: "catalog",
            content: catalogLines.slice(0, 200).join("\n")
        };

        /* Model fallback list */
        const MODELS = [
            "deepseek/deepseek-prover-v2:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "nousresearch/deephermes-3-mistral-24b-preview:free",
            "opengvlab/internvl3-14b:free",

        ];

        let replyHtml = null;
        let lastError = null;

        for (const model of MODELS) {
            const openrouterResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model,
                    messages: [system, catalogMsg, ...history]
                })
            }).then(r => r.json());

            if (openrouterResp.error) {
                lastError = openrouterResp.error;
                const msg = openrouterResp.error.message || "";
                const quotaHit = msg.includes("free-models-per-day") || openrouterResp.error.code === "insufficient_quota";
                if (quotaHit) {
                    console.warn(`Model ${model} quota exhausted → trying next.`);
                    continue; // try next model
                }
                console.error(`Model ${model} returned error:`, openrouterResp.error);
                break;      // break on non-quota error
            }

            const candidate = openrouterResp.choices?.[0]?.message?.content;
            if (candidate) {
                replyHtml = candidate;
                break;      // success
            }
        }

        if (!replyHtml) {
            console.error("All fallback models failed:", lastError);
            replyHtml = `<p>AI error: ${lastError?.message || "Unknown error"}</p>`;
        }

        res.json({ reply: replyHtml });

    } catch (err) {
        console.error("🔥 /chat error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ── Start HTTP server ───────────────────────────────────────── */
app.listen(PORT, () => console.log(`🚀 Chatbot API listening on :${PORT}`));
