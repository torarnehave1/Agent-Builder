#!/usr/bin/env python3
import boto3
import sys

# R2 credentials for post@universi.no
access_key_id = 'a46773bb7b4f7a7e0bd93e674cb50a00'
secret_access_key = 'aaecb9693d04a97952b43adb0e5bb438eefb6bb4842dcf15279e310dbd336fdc'
account_id = 'e91711ab7a5bf10ef92e1b2a91d52148'
bucket_name = 'meeting-recordings'

# R2 endpoint URL
endpoint_url = f'https://{account_id}.r2.cloudflarestorage.com'

try:
    # Create S3 client configured for R2
    s3_client = boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name='auto'
    )

    print('Testing R2 connection...')
    print(f'Bucket: {bucket_name}')
    print(f'Account ID: {account_id}')
    print(f'Endpoint: {endpoint_url}')
    print()

    # List objects with prefix
    print('Listing objects with prefix "recordings/"...')
    response = s3_client.list_objects_v2(
        Bucket=bucket_name,
        Prefix='recordings/'
    )

    if 'Contents' in response:
        objects = response['Contents']
        print(f'✓ R2 connection successful!')
        print(f'Objects found: {len(objects)}')

        if objects:
            print('\nFirst few objects:')
            for i, obj in enumerate(objects[:5], 1):
                print(f'  {i}. {obj["Key"]} ({obj["Size"]} bytes)')
            if len(objects) > 5:
                print(f'  ... and {len(objects) - 5} more')
    else:
        print(f'✓ R2 connection successful!')
        print('No objects found with prefix "recordings/"')

except Exception as e:
    print(f'✗ R2 connection failed!')
    print(f'Error: {str(e)}')
    sys.exit(1)
