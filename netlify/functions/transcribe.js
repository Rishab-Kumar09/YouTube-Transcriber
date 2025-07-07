const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const getVideoId = (url) => {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const getVideoDetails = async (videoId, apiKey) => {
    try {
        console.log('Fetching video details for:', videoId);
        
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet,contentDetails`
        );

        if (!response.ok) {
            throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Video API response received');

        if (!data.items || data.items.length === 0) {
            throw new Error('Video not found or not accessible');
        }

        const video = data.items[0];
        return {
            title: video.snippet.title,
            description: video.snippet.description,
            duration: video.contentDetails.duration,
            channelTitle: video.snippet.channelTitle
        };

    } catch (error) {
        console.error('Failed to get video details:', error.message);
        throw error;
    }
};

const getTranscriptFromYouTube = async (videoId) => {
    try {
        console.log('Fetching transcript directly from YouTube for:', videoId);
        
        // Try to get transcript from YouTube's public endpoint
        const transcriptUrl = `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}&fmt=json3`;
        
        const response = await fetch(transcriptUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `https://www.youtube.com/watch?v=${videoId}`
            }
        });

        console.log('Transcript response status:', response.status);

        if (!response.ok) {
            // Try alternative approach - get from video page
            return await getTranscriptFromVideoPage(videoId);
        }

        const data = await response.json();
        console.log('Transcript data received');

        if (data.events && Array.isArray(data.events)) {
            const transcript = data.events
                .filter(event => event.segs)
                .map(event => 
                    event.segs
                        .map(seg => seg.utf8)
                        .join('')
                )
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            return {
                transcript: transcript,
                method: 'youtube-timedtext-api',
                segmentCount: data.events.length
            };
        } else {
            throw new Error('No transcript segments found');
        }

    } catch (error) {
        console.error('Failed to get transcript from YouTube API:', error.message);
        // Fallback to video page parsing
        return await getTranscriptFromVideoPage(videoId);
    }
};

const getTranscriptFromVideoPage = async (videoId) => {
    try {
        console.log('Attempting to extract transcript from video page:', videoId);
        
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch video page: ${response.status}`);
        }

        const html = await response.text();
        console.log('Video page HTML received, length:', html.length);

        // Look for transcript data in the page
        const captionTracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
        
        if (!captionTracksMatch) {
            throw new Error('No caption tracks found in video page');
        }

        const captionTracks = JSON.parse(captionTracksMatch[1]);
        console.log('Found caption tracks:', captionTracks.length);

        // Find English captions
        const englishTrack = captionTracks.find(track => 
            track.languageCode === 'en' || track.languageCode.startsWith('en')
        ) || captionTracks[0];

        if (!englishTrack || !englishTrack.baseUrl) {
            throw new Error('No suitable caption track found');
        }

        console.log('Selected caption track:', englishTrack.name?.simpleText || 'auto-generated');

        // Fetch the caption content
        const captionResponse = await fetch(englishTrack.baseUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!captionResponse.ok) {
            throw new Error(`Failed to fetch caption content: ${captionResponse.status}`);
        }

        const captionXml = await captionResponse.text();
        console.log('Caption XML received, length:', captionXml.length);

        // Parse XML and extract text
        const textMatches = captionXml.match(/<text[^>]*>(.*?)<\/text>/g);
        
        if (!textMatches) {
            throw new Error('No text content found in captions');
        }

        const transcript = textMatches
            .map(match => {
                // Remove XML tags and decode HTML entities
                return match
                    .replace(/<[^>]*>/g, '')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .trim();
            })
            .filter(text => text.length > 0)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            transcript: transcript,
            method: 'video-page-extraction',
            segmentCount: textMatches.length,
            trackType: englishTrack.kind || 'unknown'
        };

    } catch (error) {
        console.error('Failed to extract transcript from video page:', error.message);
        throw error;
    }
};

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
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

        console.log('Processing video:', videoId);
        
        // Get video details (still using API for this)
        const apiKey = process.env.YOUTUBE_API_KEY;
        let videoDetails = null;
        
        if (apiKey) {
            try {
                videoDetails = await getVideoDetails(videoId, apiKey);
                console.log('Video details retrieved:', videoDetails.title);
            } catch (error) {
                console.log('Could not get video details from API, continuing without them');
            }
        }
        
        // Get transcript using direct YouTube access
        const transcriptData = await getTranscriptFromYouTube(videoId);
        console.log('Transcript extracted successfully using method:', transcriptData.method);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transcript: transcriptData.transcript,
                videoId: videoId,
                title: videoDetails?.title || 'Unknown',
                channelTitle: videoDetails?.channelTitle || 'Unknown',
                method: transcriptData.method,
                segmentCount: transcriptData.segmentCount,
                transcriptLength: transcriptData.transcript.length
            })
        };

    } catch (error) {
        console.error('Error:', error);
        
        let errorMessage = 'Failed to get transcript';
        let statusCode = 500;
        
        if (error.message.includes('not found')) {
            errorMessage = 'Video not found or not accessible';
            statusCode = 404;
        } else if (error.message.includes('No caption') || error.message.includes('No transcript')) {
            errorMessage = 'No captions/transcripts available for this video';
            statusCode = 404;
        } else if (error.message.includes('Failed to fetch video page')) {
            errorMessage = 'Could not access video page - video may be private or restricted';
            statusCode = 403;
        }

        return {
            statusCode: statusCode,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: errorMessage,
                details: error.message
            })
        };
    }
}; 