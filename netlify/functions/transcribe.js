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

const getYouTubeTranscript = async (videoId) => {
    try {
        // First, get the video page to extract transcript data
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        
        // Extract the initial data from the page
        const match = html.match(/"captions":(\{.*?\}),"videoDetails"/);
        if (!match) {
            throw new Error('No captions data found in video page');
        }

        const captionsData = JSON.parse(match[1]);
        const captionTracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (!captionTracks || captionTracks.length === 0) {
            throw new Error('No caption tracks available');
        }

        // Find English captions first, or use the first available
        let selectedTrack = captionTracks.find(track => 
            track.languageCode === 'en' || track.languageCode === 'en-US'
        ) || captionTracks[0];

        if (!selectedTrack?.baseUrl) {
            throw new Error('No valid caption track found');
        }

        // Fetch the transcript XML
        const transcriptResponse = await fetch(selectedTrack.baseUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!transcriptResponse.ok) {
            throw new Error(`Failed to fetch transcript: ${transcriptResponse.status}`);
        }

        const transcriptXml = await transcriptResponse.text();
        
        // Parse the XML to extract text
        const textMatches = transcriptXml.match(/<text[^>]*>([^<]*)<\/text>/g);
        if (!textMatches || textMatches.length === 0) {
            throw new Error('No transcript text found in XML');
        }

        // Clean and combine the text
        const transcript = textMatches
            .map(match => {
                // Extract text content and decode HTML entities
                const text = match.replace(/<[^>]*>/g, '').trim();
                return text
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
            })
            .filter(text => text.length > 0)
            .join(' ');

        if (!transcript || transcript.length < 10) {
            throw new Error('Transcript too short or empty');
        }

        return transcript;

    } catch (error) {
        console.error('YouTube transcript extraction failed:', error.message);
        throw error;
    }
};

const getVideoTitle = async (videoId) => {
    try {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = await response.text();
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
            return titleMatch[1].replace(' - YouTube', '').trim();
        }
        return 'Unknown Title';
    } catch (error) {
        return 'Unknown Title';
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

        console.log('Extracting transcript for video:', videoId);
        
        // Get transcript and title in parallel
        const [transcript, title] = await Promise.all([
            getYouTubeTranscript(videoId),
            getVideoTitle(videoId)
        ]);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: transcript,
                videoId: videoId,
                title: title,
                method: 'youtube-captions'
            })
        };

    } catch (error) {
        console.error('Error:', error);
        
        let errorMessage = 'Failed to extract transcript';
        let statusCode = 500;
        
        if (error.message.includes('API key')) {
            errorMessage = error.message;
            statusCode = 401;
        } else if (error.message.includes('No captions data found')) {
            errorMessage = 'No captions available for this video';
            statusCode = 404;
        } else if (error.message.includes('No caption tracks available')) {
            errorMessage = 'Captions are disabled for this video';
            statusCode = 404;
        } else if (error.message.includes('HTTP 404')) {
            errorMessage = 'Video not found or is private';
            statusCode = 404;
        } else if (error.message.includes('HTTP 403')) {
            errorMessage = 'Access denied - video may be restricted';
            statusCode = 403;
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