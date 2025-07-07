const { OpenAI } = require('openai');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

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

const getVideoId = (url) => {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const downloadAudio = async (videoUrl, outputPath) => {
    try {
        // Using yt-dlp (more reliable than ytdl-core)
        const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${videoUrl}"`;
        
        console.log('Downloading audio with yt-dlp...');
        const { stdout, stderr } = await execAsync(command, { 
            timeout: 300000, // 5 minute timeout
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        
        console.log('yt-dlp output:', stdout);
        if (stderr) console.log('yt-dlp stderr:', stderr);
        
        return true;
    } catch (error) {
        console.error('yt-dlp failed:', error.message);
        throw new Error(`Failed to download audio: ${error.message}`);
    }
};

const transcribeWithWhisper = async (audioPath) => {
    try {
        console.log('Transcribing with OpenAI Whisper...');
        
        // Read the audio file
        const audioBuffer = fs.readFileSync(audioPath);
        
        // Create a File-like object
        const audioFile = new File([audioBuffer], 'audio.mp3', { type: 'audio/mp3' });
        
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            language: "en",
            response_format: "text"
        });
        
        return transcription;
    } catch (error) {
        console.error('Whisper transcription failed:', error.message);
        throw new Error(`Transcription failed: ${error.message}`);
    }
};

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Create temp file paths
    const tempDir = '/tmp';
    const audioPath = path.join(tempDir, `audio_${Date.now()}.mp3`);

    try {
        const apiKey = event.headers['x-api-key'];
        validateApiKey(apiKey);

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

        const videoId = getVideoId(url);
        if (!videoId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Invalid YouTube URL' 
                })
            };
        }

        if (!process.env.OPENAI_API_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'OpenAI API key not configured' 
                })
            };
        }

        console.log('Processing video:', videoId);
        
        // Step 1: Download audio
        await downloadAudio(url, audioPath);
        
        // Verify file was created
        if (!fs.existsSync(audioPath)) {
            throw new Error('Audio file was not created');
        }
        
        // Step 2: Transcribe with Whisper
        const transcript = await transcribeWithWhisper(audioPath);
        
        // Step 3: Clean up
        await unlink(audioPath);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: transcript,
                videoId: videoId,
                method: 'yt-dlp-whisper'
            })
        };

    } catch (error) {
        console.error('Error:', error);
        
        // Clean up temp file if it exists
        try {
            if (fs.existsSync(audioPath)) {
                await unlink(audioPath);
            }
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }
        
        let errorMessage = 'Failed to process video';
        let statusCode = 500;
        
        if (error.message.includes('API key')) {
            errorMessage = error.message;
            statusCode = 401;
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Processing timed out - video may be too long';
        } else if (error.message.includes('private')) {
            errorMessage = 'Video is private or restricted';
        } else if (error.message.includes('not available')) {
            errorMessage = 'Video is not available';
        } else if (error.message.includes('OpenAI')) {
            errorMessage = 'Transcription service error';
        }

        return {
            statusCode: statusCode,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: errorMessage
            })
        };
    }
}; 