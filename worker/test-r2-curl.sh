#!/bin/bash

# R2 credentials for post@universi.no
ACCESS_KEY_ID="a46773bb7b4f7a7e0bd93e674cb50a00"
SECRET_ACCESS_KEY="aaecb9693d04a97952b43adb0e5bb438eefb6bb4842dcf15279e310dbd336fdc"
ACCOUNT_ID="e91711ab7a5bf10ef92e1b2a91d52148"
BUCKET_NAME="meeting-recordings"

# R2 endpoint
HOST="${ACCOUNT_ID}.r2.cloudflarestorage.com"
ENDPOINT="https://${HOST}"

# Test basic connectivity with HEAD request
echo "Testing R2 connection with curl..."
echo "Bucket: $BUCKET_NAME"
echo "Account ID: $ACCOUNT_ID"
echo "Endpoint: $ENDPOINT"
echo ""

# Try a basic S3 list operation with AWS Signature V4
# Using curl's built-in capabilities
REGION="auto"
SERVICE="s3"

# Create a simple HEAD bucket request
echo "Attempting HEAD request to bucket..."
RESPONSE=$(curl -s -w "\n%{http_code}" -I \
  --aws-sigv4 "$SERVICE:$REGION" \
  --user "$ACCESS_KEY_ID:$SECRET_ACCESS_KEY" \
  "${ENDPOINT}/${BUCKET_NAME}/")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" == "200" ]; then
  echo "✓ R2 connection successful!"

  # Now try to list objects
  echo ""
  echo "Listing objects with prefix 'recordings/'..."
  curl -s \
    --aws-sigv4 "$SERVICE:$REGION" \
    --user "$ACCESS_KEY_ID:$SECRET_ACCESS_KEY" \
    "${ENDPOINT}/${BUCKET_NAME}/?list-type=2&prefix=recordings/" | xmllint --format - | head -100
else
  echo "✗ R2 connection failed!"
  echo "Response:"
  echo "$BODY"
fi
