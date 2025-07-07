const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

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

const getYouTubeVideoData = async (videoId) => {
    try {
        // Get the video page
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Video not accessible`);
        }

        const html = await response.text();
        
        // Extract the ytInitialPlayerResponse data
        const match = html.match(/var ytInitialPlayerResponse = ({.+?});/);
        if (!match) {
            throw new Error('Could not find video data');
        }

        const playerResponse = JSON.parse(match[1]);
        
        if (playerResponse.playabilityStatus?.status !== 'OK') {
            throw new Error(`Video not playable: ${playerResponse.playabilityStatus?.reason || 'Unknown reason'}`);
        }

        const formats = playerResponse.streamingData?.adaptiveFormats || [];
        
        // Find the best audio format (usually webm or mp4)
        const audioFormats = formats.filter(format => 
            format.mimeType && format.mimeType.startsWith('audio/')
        );

        if (audioFormats.length === 0) {
            throw new Error('No audio formats found');
        }

        // Prefer webm audio, then mp4
        const bestAudio = audioFormats.find(f => f.mimeType.includes('webm')) || 
                         audioFormats.find(f => f.mimeType.includes('mp4')) || 
                         audioFormats[0];

        return {
            title: playerResponse.videoDetails?.title || 'Unknown',
            audioUrl: bestAudio.url,
            mimeType: bestAudio.mimeType
        };

    } catch (error) {
        console.error('Failed to get video data:', error.message);
        throw error;
    }
};

const downloadAudio = async (audioUrl, outputPath) => {
    try {
        console.log('Downloading audio...');
        
        const response = await fetch(audioUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download audio: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        await writeFile(outputPath, buffer);
        
        console.log(`Audio downloaded: ${buffer.length} bytes`);
        return true;

    } catch (error) {
        console.error('Audio download failed:', error.message);
        throw error;
    }
};

const transcribeWithWhisper = async (audioPath) => {
    try {
        console.log('Transcribing with OpenAI Whisper...');
        
        // Read the audio file
        const audioBuffer = fs.readFileSync(audioPath);
        
        // Create a File-like object
        const audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
        
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
    const audioPath = path.join(tempDir, `audio_${Date.now()}.webm`);

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
        
        // Step 1: Get video data and audio URL
        const videoData = await getYouTubeVideoData(videoId);
        
        // Step 2: Download audio
        await downloadAudio(videoData.audioUrl, audioPath);
        
        // Verify file was created
        if (!fs.existsSync(audioPath)) {
            throw new Error('Audio file was not created');
        }
        
        // Step 3: Transcribe with Whisper
        const transcript = await transcribeWithWhisper(audioPath);
        
        // Step 4: Clean up
        await unlink(audioPath);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: transcript,
                videoId: videoId,
                title: videoData.title,
                method: 'custom-extraction-whisper'
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
        } else if (error.message.includes('not accessible')) {
            errorMessage = 'Video is not accessible or may be private';
            statusCode = 404;
        } else if (error.message.includes('not playable')) {
            errorMessage = 'Video is not playable or restricted';
            statusCode = 403;
        } else if (error.message.includes('No audio formats')) {
            errorMessage = 'No audio available for this video';
            statusCode = 400;
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