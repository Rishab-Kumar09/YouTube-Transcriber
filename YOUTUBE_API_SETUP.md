# YouTube API Setup Guide

## Step 1: Get YouTube Data API v3 Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **YouTube Data API v3**:
   - Go to "APIs & Services" > "Library"
   - Search for "YouTube Data API v3"
   - Click on it and press "Enable"

4. Create API credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy your API key

## Step 2: Configure in Netlify

1. Go to your Netlify dashboard
2. Select your site
3. Go to "Site settings" > "Environment variables"
4. Add a new variable:
   - **Key**: `YOUTUBE_API_KEY`
   - **Value**: Your API key from step 1

## Step 3: Test

Your application will now use the official YouTube Data API to:
- Get video details
- List available captions
- Download transcript text
- Convert to readable format

## API Limits

- **Free tier**: 10,000 quota units per day
- **Typical usage**: ~5 units per transcript request
- **Estimate**: ~2,000 transcripts per day (free)

## What This Gets You

✅ **Official API** - No risk of being blocked  
✅ **Reliable** - Google's infrastructure  
✅ **Free tier** - 10,000 requests/day  
✅ **Multiple languages** - Auto-detects available captions  
✅ **Both types** - Manual and auto-generated transcripts  

## Troubleshooting

- **"No captions available"**: Video doesn't have captions/transcripts
- **"API key not configured"**: Check your Netlify environment variables
- **"Quota exceeded"**: You've hit the daily limit (resets at midnight PT) 