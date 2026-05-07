const https = require('https');
const crypto = require('crypto');

// R2 credentials for post@universi.no
const accessKeyId = 'a46773bb7b4f7a7e0bd93e674cb50a00';
const secretAccessKey = 'aaecb9693d04a97952b43adb0e5bb438eefb6bb4842dcf15279e310dbd336fdc';
const accountId = 'e91711ab7a5bf10ef92e1b2a91d52148';
const bucketName = 'meeting-recordings';

// S3-compatible R2 endpoint
const host = `${accountId}.r2.cloudflarestorage.com`;

function createAuthHeaders(method, path, queryString = '') {
  // Get current timestamp
  const now = new Date();
  const amzdate = now.toISOString().replace(/[:-]|\.000Z$/g, '') + 'Z';
  const datestamp = amzdate.slice(0, 8);

  const service = 's3';
  const region = 'auto';
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;

  // Payload hash (empty for GET)
  const payloadHash = crypto
    .createHash('sha256')
    .update('')
    .digest('hex');

  // Canonical request
  const canonicalUri = path;
  const canonicalQuerystring = queryString;

  // Sort headers
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzdate}\n`;

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    `${method}\n` +
    `${canonicalUri}\n` +
    `${canonicalQuerystring}\n` +
    `${canonicalHeaders}\n` +
    `${signedHeaders}\n` +
    `${payloadHash}`;

  // String to sign
  const canonicalRequestHash = crypto
    .createHash('sha256')
    .update(canonicalRequest)
    .digest('hex');

  const stringToSign =
    `${algorithm}\n` +
    `${amzdate}\n` +
    `${credentialScope}\n` +
    `${canonicalRequestHash}`;

  // Calculate signature
  const kDate = crypto
    .createHmac('sha256', `AWS4${secretAccessKey}`)
    .update(datestamp)
    .digest();

  const kRegion = crypto
    .createHmac('sha256', kDate)
    .update(region)
    .digest();

  const kService = crypto
    .createHmac('sha256', kRegion)
    .update(service)
    .digest();

  const kSigning = crypto
    .createHmac('sha256', kService)
    .update('aws4_request')
    .digest();

  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  const authorizationHeader =
    `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Authorization': authorizationHeader,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzdate,
    'Host': host
  };
}

function listBucketObjects() {
  return new Promise((resolve, reject) => {
    const path = `/${bucketName}/`;
    const queryString = 'list-type=2&prefix=recordings/';
    const fullPath = `${path}?${queryString}`;

    const headers = createAuthHeaders('GET', path, queryString);

    const options = {
      hostname: host,
      port: 443,
      path: fullPath,
      method: 'GET',
      headers: headers
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          body: data,
          headers: res.headers
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function main() {
  try {
    console.log('Testing R2 connection...');
    console.log(`Bucket: ${bucketName}`);
    console.log(`Account ID: ${accountId}`);
    console.log(`Access Key ID: ${accessKeyId.substring(0, 8)}...`);
    console.log('');

    const response = await listBucketObjects();

    console.log(`Status: ${response.statusCode} ${response.statusMessage}`);
    console.log('');

    if (response.statusCode === 200) {
      console.log('✓ R2 connection successful!');

      // Parse XML response to count objects
      const objectMatches = response.body.match(/<Key>/g);
      const objectCount = objectMatches ? objectMatches.length : 0;

      console.log(`Objects found with prefix "recordings/": ${objectCount}`);

      if (objectCount > 0) {
        console.log('\nFirst few objects:');
        const keyMatches = response.body.match(/<Key>([^<]+)<\/Key>/g);
        keyMatches?.slice(0, 5).forEach((match, idx) => {
          const key = match.replace(/<Key>|<\/Key>/g, '');
          console.log(`  ${idx + 1}. ${key}`);
        });
        if (objectCount > 5) {
          console.log(`  ... and ${objectCount - 5} more`);
        }
      }
    } else {
      console.log('✗ R2 connection failed!');
      console.log('Response body:', response.body.substring(0, 500));
    }
  } catch (error) {
    console.error('Error testing R2 connection:', error.message);
    process.exit(1);
  }
}

main();
