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

const getYouTubeVideoData = async (videoId) => {
    try {
        console.log('Fetching video page for:', videoId);
        
        // Get the video page
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        });

        console.log('Response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Video not accessible`);
        }

        const html = await response.text();
        console.log('HTML length:', html.length);
        
        // Try multiple patterns to find video data
        let playerResponse = null;
        
        // Pattern 1: var ytInitialPlayerResponse
        let match = html.match(/var ytInitialPlayerResponse = ({.+?});/);
        if (match) {
            console.log('Found ytInitialPlayerResponse');
            playerResponse = JSON.parse(match[1]);
        }
        
        // Pattern 2: "ytInitialPlayerResponse":
        if (!playerResponse) {
            match = html.match(/"ytInitialPlayerResponse":({.+?}),"ytInitialData"/);
            if (match) {
                console.log('Found ytInitialPlayerResponse in JSON');
                playerResponse = JSON.parse(match[1]);
            }
        }
        
        if (!playerResponse) {
            throw new Error('Could not find video data in page');
        }

        console.log('Player response status:', playerResponse.playabilityStatus?.status);
        console.log('Player response reason:', playerResponse.playabilityStatus?.reason);
        
        if (playerResponse.playabilityStatus?.status !== 'OK') {
            throw new Error(`Video not playable: ${playerResponse.playabilityStatus?.reason || 'Unknown reason'}`);
        }

        const formats = playerResponse.streamingData?.adaptiveFormats || [];
        console.log('Total formats found:', formats.length);
        
        // Find the best audio format
        const audioFormats = formats.filter(format => 
            format.mimeType && format.mimeType.startsWith('audio/')
        );

        console.log('Audio formats found:', audioFormats.length);
        audioFormats.forEach((format, i) => {
            console.log(`Audio ${i}:`, format.mimeType, format.bitrate);
        });

        if (audioFormats.length === 0) {
            throw new Error('No audio formats found');
        }

        // Prefer webm audio, then mp4
        const bestAudio = audioFormats.find(f => f.mimeType.includes('webm')) || 
                         audioFormats.find(f => f.mimeType.includes('mp4')) || 
                         audioFormats[0];

        console.log('Selected audio format:', bestAudio.mimeType);

        return {
            title: playerResponse.videoDetails?.title || 'Unknown',
            audioUrl: bestAudio.url,
            mimeType: bestAudio.mimeType,
            bitrate: bestAudio.bitrate
        };

    } catch (error) {
        console.error('Failed to get video data:', error.message);
        throw error;
    }
};

const downloadAudio = async (audioUrl, outputPath) => {
    try {
        console.log('Starting audio download...');
        console.log('Audio URL length:', audioUrl.length);
        
        const response = await fetch(audioUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        });

        console.log('Audio download response status:', response.status);

        if (!response.ok) {
            throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        console.log('Content length:', contentLength);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        await writeFile(outputPath, buffer);
        
        console.log(`Audio downloaded successfully: ${buffer.length} bytes`);
        return {
            size: buffer.length,
            path: outputPath
        };

    } catch (error) {
        console.error('Audio download failed:', error.message);
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

    // Create temp file paths
    const tempDir = '/tmp';
    const audioPath = path.join(tempDir, `audio_${Date.now()}.webm`);

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
        
        // Step 1: Get video data and audio URL
        const videoData = await getYouTubeVideoData(videoId);
        console.log('Video data retrieved:', videoData.title);
        
        // Step 2: Download audio
        const downloadResult = await downloadAudio(videoData.audioUrl, audioPath);
        console.log('Download completed:', downloadResult.size, 'bytes');
        
        // Verify file exists
        const fileExists = fs.existsSync(audioPath);
        console.log('File exists:', fileExists);
        
        // Clean up for now
        if (fileExists) {
            await unlink(audioPath);
            console.log('Temp file cleaned up');
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Audio downloaded successfully',
                videoId: videoId,
                title: videoData.title,
                audioFormat: videoData.mimeType,
                bitrate: videoData.bitrate,
                fileSize: downloadResult.size,
                step: 'audio-download-only'
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
        
        if (error.message.includes('not accessible')) {
            errorMessage = 'Video is not accessible or may be private';
            statusCode = 404;
        } else if (error.message.includes('not playable')) {
            errorMessage = `Video is not playable: ${error.message}`;
            statusCode = 403;
        } else if (error.message.includes('No audio formats')) {
            errorMessage = 'No audio available for this video';
            statusCode = 400;
        } else if (error.message.includes('Could not find video data')) {
            errorMessage = 'Could not extract video data from YouTube page';
            statusCode = 500;
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