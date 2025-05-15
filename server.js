/* ------------------------------------------------------------------
   Resto Supply Hub • GPT Chatbot  (v2)
   • Loads storeInfo.json
   • Fetches full Shopify catalog at boot + every 6 h
   • Sends first 200 catalog lines (masked links) to stay in context
   • Surfaces OpenRouter errors to user & logs
------------------------------------------------------------------ */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

/* ── ENV ───────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SHOPIFY_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // restosupplyhub.myshopify.com

/* ── CACHES ────────────────────────────────────────────────────── */
let catalogLines = [];     // All products (Markdown bullets)
let storeInfo = {};     // office hours, promos, etc.

/* ── Load storeInfo.json ──────────────────────────────────────── */
function loadStoreInfo() {
    try {
        storeInfo = JSON.parse(fs.readFileSync("./storeInfo.json", "utf8"));
        console.log("📖 storeInfo.json loaded.");
    } catch {
        console.warn("⚠️  storeInfo.json missing or invalid.");
        storeInfo = {};
    }
}

/* ── Fetch full Shopify catalog ───────────────────────────────── */
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
            const url = `https://${SHOPIFY_DOMAIN}/products/${node.handle}`;
            out.push(`• ${node.title} – $${price} – [View item →](${url})`);
        });

        if (!j.data.products.pageInfo.hasNextPage) break;
        cursor = edges.at(-1).cursor;
    }

    catalogLines = out;
    console.log(`✅ Catalog loaded (${catalogLines.length} items).`);
}

/* ── Helper: store info block ─────────────────────────────────── */
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
setInterval(fetchCatalog, 6 * 60 * 60 * 1000);  // every 6 h

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
            return res.status(500).json({ error: "Missing OpenRouter API key" });

        /* ---- System prompt ------------------------------------------------ */
        const system = {
            role: "system",
            content: `
You are a friendly AI assistant for Resto Supply Hub (https://www.restosupplyhub.com).

We stock ${catalogLines.length} packaging products.

===== Store Info =====
${storeInfoSnippet()}

===== Instructions =====
• If the user greets you (“hi”, “hello”), respond with a short friendly HTML paragraph.
• If they ask “Office Hours”, answer with: <p>Our office hours are ${storeInfo.office_hours}.</p>
• For product queries, convert the catalog bullets into an HTML ordered list (<ol><li>…</li></ol>).
• If asked about returns, shipping, tracking or promo, answer in <p>…</p> paragraphs using Store Info.
• Always reply in valid HTML (<p>, <ol>, <li>, <a>). Never expose raw Markdown or URLs.
`.trim()
        };

        /* ---- Catalog slice (first 200 items) to stay within context ------- */
        const catalogMsg = {
            role: "assistant",
            name: "catalog",
            content: catalogLines.slice(0, 200).join("\n")
        };

        /* ---- Call model --------------------------------------------------- */
        const ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

        const j = await ai.json();

        /* ---- Surface errors to user & log -------------------------------- */
        if (j.error) {
            console.error("OpenRouter error:", j.error);
            return res.json({ reply: `<p>AI error: ${j.error.message}</p>` });
        }

        const reply = j?.choices?.[0]?.message?.content
            || "<p>Sorry, I couldn’t generate a response right now.</p>";

        res.json({ reply });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(PORT, () => console.log(`🚀 Chatbot API listening on :${PORT}`));
