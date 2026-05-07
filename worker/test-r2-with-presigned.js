const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

// R2 credentials for post@universi.no
const accessKeyId = 'a46773bb7b4f7a7e0bd93e674cb50a00';
const secretAccessKey = 'aaecb9693d04a97952b43adb0e5bb438eefb6bb4842dcf15279e310dbd336fdc';
const accountId = 'e91711ab7a5bf10ef92e1b2a91d52148';
const bucketName = 'meeting-recordings';

// S3-compatible R2 endpoint
const host = `${accountId}.r2.cloudflarestorage.com`;

// Use a presigned URL approach to validate credentials
function generatePresignedUrl() {
  const now = new Date();

  // Use a longer expiration time for testing (1 hour)
  const expiresIn = 3600;

  const amzDate = now.toISOString().replace(/[:-]|\.000Z$/g, '') + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const service = 's3';
  const region = 'auto';
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  // Query parameters
  const params = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn,
    'X-Amz-SignedHeaders': 'host'
  };

  // Canonical request
  const canonicalUri = `/${bucketName}/`;
  const canonicalQuerystring = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    '',
    signedHeaders,
    payloadHash
  ].join('\n');

  const canonicalRequestHash = crypto
    .createHash('sha256')
    .update(canonicalRequest)
    .digest('hex');

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n');

  // Calculate signature
  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const presignedUrl = `https://${host}${canonicalUri}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
  return presignedUrl;
}

async function testPresignedUrl() {
  try {
    const presignedUrl = generatePresignedUrl();
    console.log('Testing R2 with presigned URL...');
    console.log(`Bucket: ${bucketName}`);
    console.log(`Account ID: ${accountId}`);
    console.log('');

    console.log('Presigned URL (first 150 chars):');
    console.log(presignedUrl.substring(0, 150) + '...');
    console.log('');

    const url = new URL(presignedUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Host': url.hostname
      }
    };

    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
          console.log('');

          if (res.statusCode === 200) {
            console.log('✓ R2 presigned URL test successful!');

            // Parse XML response
            const objectMatches = data.match(/<Key>/g);
            const objectCount = objectMatches ? objectMatches.length : 0;
            console.log(`Objects in bucket: ${objectCount}`);

            if (objectCount > 0) {
              console.log('\nFirst few objects:');
              const keyMatches = data.match(/<Key>([^<]+)<\/Key>/g);
              keyMatches?.slice(0, 5).forEach((match, idx) => {
                const key = match.replace(/<Key>|<\/Key>/g, '');
                console.log(`  ${idx + 1}. ${key}`);
              });
              if (objectCount > 5) {
                console.log(`  ... and ${objectCount - 5} more`);
              }
            }
          } else {
            console.log('✗ R2 presigned URL test failed!');
            console.log('Response (first 500 chars):');
            console.log(data.substring(0, 500));
          }

          resolve();
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testPresignedUrl();
