const { YoutubeTranscript } = require('youtube-transcript');

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

        console.log('Getting transcript for video:', videoId);
        
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        
        if (!transcript || transcript.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'No transcript available for this video' 
                })
            };
        }

        // Combine all transcript text
        const fullTranscript = transcript.map(item => item.text).join(' ');

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: fullTranscript,
                videoId: videoId
            })
        };

    } catch (error) {
        console.error('Error:', error);
        
        let errorMessage = 'Failed to get transcript';
        if (error.message.includes('API key')) {
            errorMessage = error.message;
        } else if (error.message.includes('Transcript is disabled')) {
            errorMessage = 'Transcript is disabled for this video';
        } else if (error.message.includes('No transcript found')) {
            errorMessage = 'No transcript available for this video';
        }

        return {
            statusCode: error.message.includes('API key') ? 401 : 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: errorMessage
            })
        };
    }
}; 