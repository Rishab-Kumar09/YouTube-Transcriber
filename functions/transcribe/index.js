const ytdl = require('ytdl-core');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const validateApiKey = (apiKey) => {
    if (!apiKey) {
        throw new Error('API key is required');
    }
    if (apiKey !== process.env.API_KEY) {
        throw new Error('Invalid API key');
    }
};

exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle OPTIONS request (CORS preflight)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Validate API key
        const apiKey = event.headers['x-api-key'];
        validateApiKey(apiKey);

        // Parse request body
        const { url } = JSON.parse(event.body);
        
        if (!url) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'YouTube URL is required' 
                })
            };
        }

        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Invalid YouTube URL' 
                })
            };
        }

        // Use system temp directory
        const tempDir = os.tmpdir();
        const videoId = ytdl.getVideoID(url);
        const audioPath = path.join(tempDir, `${videoId}.mp3`);

        // Download audio
        await new Promise((resolve, reject) => {
            ytdl(url, { 
                quality: 'highestaudio',
                filter: 'audioonly' 
            })
            .pipe(fs.createWriteStream(audioPath))
            .on('finish', resolve)
            .on('error', reject);
        });

        // Transcribe using Whisper API
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            language: "en",
            response_format: "text"
        });

        // Cleanup
        fs.unlinkSync(audioPath);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: transcription
            })
        };
    } catch (error) {
        console.error('Transcription error:', error);
        return {
            statusCode: error.message.includes('API key') ? 401 : 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: error.message || 'Failed to transcribe video' 
            })
        };
    }
}; 