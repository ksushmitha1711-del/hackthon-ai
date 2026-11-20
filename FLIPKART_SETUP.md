# Connect Flipkart products

Snap Store now switches to Flipkart-only product mode and has server-side connectors for Flipkart's official product search, product category feeds, active offers and Deals of the Day. In this mode the sample product grid is hidden. Category browsing, product search, AI recommendations, product promotions and offer links all use Flipkart API data. The Affiliate token is never sent to the browser.

## Enable live search

1. Register for the [Flipkart Affiliate Program](https://affiliate.flipkart.com/registerme) and get API access in the affiliate dashboard.
2. Copy `.env.example` to `.env`.
3. Put your Affiliate Tracking ID in `FLIPKART_AFFILIATE_ID` and your Affiliate API Token in `FLIPKART_AFFILIATE_TOKEN`. Keep `.env` private; `.gitignore` excludes it.
4. From this folder, run `npm start` and open `http://localhost:3000`.
5. Open a category or search for an item. Live API access requires the Affiliate account and token; without them, the site shows a setup message.

The search endpoint returns up to 10 results per request. Category feeds are loaded from Flipkart's signed feed directory and limited to 80 products per category response. Active offers and Deals of the Day refresh every five minutes. The site does not scrape Flipkart pages, invent reviews, or display seller ratings as product ratings. Click-throughs use Flipkart's returned affiliate URLs; on phones, the device may open the Flipkart app if its link handling is enabled, otherwise the listing opens in the browser.

Flipkart's official offer feed supplies offer titles, descriptions, category, validity and retailer links. It does not promise a coupon-code field for every promotion, so Snap Store shows codes only if Flipkart includes them in the returned details.

For a public deployment, keep the Affiliate credentials in the host's secret manager, add production-grade user and IP rate limits, and review Flipkart's latest API rules before launch.
