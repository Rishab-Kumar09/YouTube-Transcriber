# YouTube Transcriber API

A simple API service that converts YouTube videos to text transcripts. Built with Node.js and Express, deployable on Netlify.

## Features

- Convert YouTube videos to text transcripts
- API Key authentication
- Easy deployment to Netlify
- No external API dependencies
- Perfect for n8n integration

## Tech Stack

- Node.js
- Express
- YouTube-DL (for video processing)
- FFmpeg (for audio extraction)
- Vosk (for speech-to-text)

## Setup

1. Clone the repository
```bash
git clone https://github.com/Rishab-Kumar09/YouTube-Transcriber.git
cd YouTube-Transcriber
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
```

4. Start the development server
```bash
npm run dev
```

## API Documentation

### Authentication
All API endpoints require an API key passed in the headers:
```
X-API-KEY: your_api_key_here
```

### Endpoints

#### POST /api/transcript
Get transcript for a YouTube video

Request body:
```json
{
    "url": "https://www.youtube.com/watch?v=video_id"
}
```

Response:
```json
{
    "success": true,
    "transcript": "Video transcript text..."
}
```

## License

MIT 