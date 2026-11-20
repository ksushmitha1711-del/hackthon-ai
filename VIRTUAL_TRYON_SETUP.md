# Kling Virtual Try-On Setup

Snap Store uses Kling's virtual try-on API to render a clothing item on the selected camera photo or uploaded person photo.

1. Create a Kling Developer API key in the [Kling Developer Console](https://kling.ai/dev/api-key). Add image-generation API credits/resources to the Kling account.
2. In the project `.env`, set `KLING_API_KEY=your_key`. Keep the key private; the server sends it to Kling.
3. Deploy Snap Store to a public HTTPS URL and set `PUBLIC_BASE_URL=https://your-store-domain`. Kling must be able to fetch the short-lived person-photo URL; `localhost` is not accessible to Kling.
4. Restart the server. On a clothing product, choose **See it on you**, use the camera or upload a clear JPG/PNG/WebP photo, then press **Generate my try-on**.

The server keeps the uploaded image in memory and serves it under a random temporary URL for up to 10 minutes while Kling processes the task. It does not save the photo to disk. A user photo is sent only after they press Generate. Kling's virtual try-on API requires one public product image and one public person image; generated output links expire after 30 days. See the [Kling Virtual Try-On API docs](https://kling.ai/document-api/api/ecommerce-replication/virtual-try-on) and [API setup guide](https://kling.ai/document-api/guides/get-started/quick-start).
