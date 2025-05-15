/* Fetch ALL products from Storefront API and save compact digest */
import fs from "fs/promises";
import fetch from "node-fetch";

const TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const DOMAIN = process.env.SHOPIFY_DOMAIN;               // restosupplyhub.myshopify.com
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
          title
          handle
          tags
          variants(first: 1) {
            edges { node { price { amount } } }
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }`;
    const vars = { first: PAGE, after: cursor };

    const r = await fetch(`https://${DOMAIN}/api/2024-01/graphql.json`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": TOKEN
        },
        body: JSON.stringify({ query, variables: vars })
    });
    const j = await r.json();
    const edges = j.data.products.edges;
    edges.forEach(e => {
        const v0 = e.node.variants.edges[0]?.node;
        out.push({
            title: e.node.title,
            handle: e.node.handle,
            tags: e.node.tags,
            price: v0?.price?.amount ?? "NA"
        });
    });

    if (!j.data.products.pageInfo.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
}

await fs.writeFile("./catalog.json", JSON.stringify(out, null, 2));
console.log(`✅  Saved ${out.length} products to catalog.json`);
