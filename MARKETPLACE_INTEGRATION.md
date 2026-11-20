# Marketplace product and rating integration

Snap Store's Supabase schema now has `marketplace_listings`. It keeps each retailer's product ID, URL, price, source attribution, timestamps, and separate fields for a **product rating** and a **seller rating**. Ratings remain empty unless an authorized integration supplies them. Customer-written marketplace reviews should link to the retailer's review page unless that marketplace explicitly licenses their redistribution.

## Provider access needed

- **Amazon India:** use the current Creators API through an eligible Amazon Associates account. Amazon says access requires Associates enrollment, 10 qualifying sales in the previous 30 days, API registration, and credentials. The old PA-API 5 has a deprecation notice. Store the Creators API credentials server-side; never put them in browser JavaScript.
- **Flipkart:** its Affiliate API requires affiliate enrollment plus an Affiliate ID and API token. Product feeds include product price and seller rating fields; a seller rating must not be displayed as a product rating. Use a retailer review link for review details unless the approved API response explicitly supplies a permitted product-rating field.
- **Meesho:** Meesho's creator program provides creator/affiliate links, but an official public product-catalog API was not found in its official material. Connect a catalog only through a Meesho-approved partner/API or seller-authorized data feed. Do not scrape app data or present scraped reviews as licensed content.

## Display rules

1. Match retailer listings to a Snap Store product using a verified identifier (such as GTIN/MPN), not just similar names.
2. Show each marketplace's price and rating with the marketplace name and last-checked time.
3. Keep product ratings and seller ratings separate. Keep rating count and source attribution beside the score.
4. Link out to the retailer's listing/reviews for customer-written reviews. Store/display review text only when the provider terms explicitly permit it.
5. Refresh volatile prices at the provider's permitted rate and never invent an offer when a provider is unavailable.

## Integration status

Flipkart now has server-side Affiliate API product search, category-feed and offer routes, and the storefront runs in Flipkart-only mode. Follow [FLIPKART_SETUP.md](FLIPKART_SETUP.md) and add your affiliate credentials to the local `.env` file to enable live data. The credentials are never exposed to browser code. Amazon and Meesho are not part of this Flipkart-only configuration. The Supabase marketplace listing schema is a storage foundation and is not populated by a scheduled sync.
