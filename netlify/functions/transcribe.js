const ytdl = require('ytdl-core');
const { OpenAI } = require('openai');

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
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const getAudioBuffer = async (url) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const stream = ytdl(url, { 
            quality: 'highestaudio',
            filter: 'audioonly',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });
        
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
        
        // Add timeout for long videos
        setTimeout(() => {
            stream.destroy();
            reject(new Error('Audio download timeout - video may be too long'));
        }, 120000); // 2 minute timeout
    });
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
        if (!videoId || !ytdl.validateURL(url)) {
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

        console.log('Getting video info...');
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title;
        const duration = parseInt(info.videoDetails.lengthSeconds);
        
        // Check if video is too long (over 10 minutes)
        if (duration > 600) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Video is too long (over 10 minutes). Please try a shorter video.' 
                })
            };
        }

        console.log('Downloading audio...');
        const audioBuffer = await getAudioBuffer(url);
        
        console.log('Transcribing with OpenAI Whisper...');
        
        // Create a File-like object from buffer
        const audioFile = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
        
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            language: "en",
            response_format: "text"
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: transcription,
                videoId: videoId,
                title: title,
                method: 'openai-whisper'
            })
        };

    } catch (error) {
        console.error('Error:', error);
        
        let errorMessage = 'Failed to transcribe video';
        let statusCode = 500;
        
        if (error.message.includes('API key')) {
            errorMessage = error.message;
            statusCode = 401;
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Video download timed out - video may be too long';
        } else if (error.message.includes('410')) {
            errorMessage = 'Video is not available or has been removed';
        } else if (error.message.includes('private')) {
            errorMessage = 'Video is private or restricted';
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