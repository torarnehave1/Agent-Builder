const crypto = require('crypto');

// R2 credentials
const accessKeyId = 'a46773bb7b4f7a7e0bd93e674cb50a00';
const secretAccessKey = 'aaecb9693d04a97952b43adb0e5bb438eefb6bb4842dcf15279e310dbd336fdc';
const accountId = 'e91711ab7a5bf10ef92e1b2a91d52148';

// Test: what signature is the server expecting?
// When we get a SignatureDoesNotMatch error, R2 tells us what StringToSign it calculated

// Example from earlier error:
// StringToSign:
// AWS4-HMAC-SHA256
// 20260504T134853Z
// 20260504/auto/s3/aws4_request
// 641dddf42bb3cbbbcb7f7ec4b07251f6e685d85e61398b58bec134f7d84833e1

// Let's verify if the secret key itself might be wrong.
// Let me try calculating what the signature SHOULD be given what the server calculated

const testDateStamp = '20260504';
const testAmzDate = '20260504T134853Z';
const region = 'auto';
const service = 's3';

// Calculate the signing key the same way
const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(testDateStamp).digest();
const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

console.log('Signing key components:');
console.log('Secret Key:', secretAccessKey);
console.log('');

// Try signing the example StringToSign from the error
const exampleStringToSign = `AWS4-HMAC-SHA256
20260504T134853Z
20260504/auto/s3/aws4_request
641dddf42bb3cbbbcb7f7ec4b07251f6e685d85e61398b58bec134f7d84833e1`;

const calculatedSignature = crypto.createHmac('sha256', kSigning).update(exampleStringToSign).digest('hex');
console.log('If we sign the StringToSign the server calculated:');
console.log('StringToSign:');
console.log(exampleStringToSign);
console.log('');
console.log('Calculated signature:', calculatedSignature);
console.log('');
console.log('This shows us if our secret key is at least correctly formatted.');
console.log('If the signature still doesn\'t match what we sent, the issue is in how');
console.log('we\'re calculating the CanonicalRequest (which produces the hash in StringToSign)');
