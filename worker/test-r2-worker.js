/**
 * Test R2 connection for post@universi.no credentials
 * This can be deployed as a temporary worker to test R2 access
 *
 * Usage: wrangler deploy --name test-r2-worker test-r2-worker.js
 * Then: curl https://test-r2-worker.<your-subdomain>.workers.dev
 */

export default {
  async fetch(request, env, ctx) {
    try {
      // Test R2 credentials for post@universi.no
      const accessKeyId = 'a46773bb7b4f7a7e0bd93e674cb50a00';
      const secretAccessKey = 'aaecb9693d04a97952b43adb0e5bb438eefb6bb4842dcf15279e310dbd336fdc';
      const accountId = 'e91711ab7a5bf10ef92e1b2a91d52148';
      const bucketName = 'meeting-recordings';

      // Create R2 client with the credentials
      // Note: R2 in Cloudflare Workers uses S3-compatible API
      const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

      const response = await fetch(`${endpoint}/${bucketName}/?list-type=2&prefix=recordings/`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${btoa(`${accessKeyId}:${secretAccessKey}`)}`,
          'Host': `${accountId}.r2.cloudflarestorage.com`
        }
      });

      const text = await response.text();

      return new Response(JSON.stringify({
        status: response.status,
        statusText: response.statusMessage,
        contentType: response.headers.get('content-type'),
        body: text.substring(0, 500)
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
