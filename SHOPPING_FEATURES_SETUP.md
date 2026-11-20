# Shopping features setup

The storefront keeps its existing layout and local catalog. The new review and feedback UI works in a browser preview and uses Supabase when configured.

## Supabase
1. Run `supabase/schema.sql` in a fresh Supabase project, then run `supabase/reviews_feedback.sql`.
2. In Supabase Auth, create staff accounts and promote the intended operator's `profiles.role` to `admin` using the SQL editor. The staff panel uses Supabase Auth and database RLS.
3. Create a public Storage bucket called `review-photos` and a narrowly scoped upload policy to enable optional review photo uploads. The application limits uploads to 3 MB and image MIME types; without a Storage policy, uploads are rejected. For a public production site, route uploads and submissions through an Edge Function with CAPTCHA/rate limiting, malware checks, and stricter abuse controls.
4. Edit `shop-config.js` with your Supabase project URL and public anon key. The anon key is designed for browser use; never put a service-role key in the page.

Reviews are pending moderation by default, duplicate submissions using the same browser token/product are rejected by a database unique constraint; this is basic duplicate protection, not a substitute for CAPTCHA and server-side rate limiting, verified purchase stays false, and only approved reviews are public. Supabase Auth admin accounts are required for the moderation interface. The feedback form stores shared records only when Supabase is configured; otherwise it clearly says the record is local to that browser.

## Catalog and retailer feeds still required
The current bundled catalog has no confirmed marketplace product URLs, product specifications, warranty data, or official-store evidence. The new UI therefore does not invent retailer links or verified badges. To enable platform price comparisons, populate `product_offers` only with a stable catalog product ID, retailer name, exact product URL, observed price, currency, discount, warranty, timestamp, expiry, and source. The page displays active offers from this table and marks official stores only when an admin confirms them. Integrate retailer affiliate/product APIs or an authorized comparison feed, validate every URL, and refresh prices before expiry. Brand filters only show products present in the actual catalog; the supplied brand directory does not imply endorsement or official-store status.

The existing catalog's fixed prices and ratings were already in the source. Customer rating displays now use approved customer reviews only; a live retailer price-feed service and external review syndication are not yet connected to this static project.
