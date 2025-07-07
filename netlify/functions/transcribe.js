const ytdl = require('ytdl-core');
const { OpenAI } = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

// Set FFmpeg path for the function environment
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

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

// Function to get video info
const getVideoInfo = async (url) => {
    try {
        const info = await ytdl.getInfo(url);
        return {
            title: info.videoDetails.title,
            lengthSeconds: parseInt(info.videoDetails.lengthSeconds),
            format: ytdl.chooseFormat(info.formats, { 
                quality: 'highestaudio',
                filter: 'audioonly' 
            })
        };
    } catch (error) {
        throw new Error(`Failed to get video info: ${error.message}`);
    }
};

// Function to download audio in chunks
const downloadAudio = async (url, format) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        ytdl(url, { format })
            .on('data', chunk => chunks.push(chunk))
            .on('end', () => resolve(Buffer.concat(chunks)))
            .on('error', reject);
    });
};

// Function to process audio using FFmpeg
const processAudio = async (inputBuffer, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(inputBuffer)
            .inputFormat('webm')
            .toFormat('mp3')
            .audioBitrate('128k')
            .on('error', reject)
            .on('end', resolve)
            .save(outputPath);
    });
};

// Function to split audio if it's too long
const splitAudio = async (inputPath, maxDurationSecs = 1800) => {
    const outputPaths = [];
    
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err);
            
            const duration = metadata.format.duration;
            const numParts = Math.ceil(duration / maxDurationSecs);
            
            if (numParts === 1) {
                resolve([inputPath]);
                return;
            }
            
            let completed = 0;
            for (let i = 0; i < numParts; i++) {
                const start = i * maxDurationSecs;
                const outputPath = inputPath.replace('.mp3', `-part${i + 1}.mp3`);
                outputPaths.push(outputPath);
                
                ffmpeg(inputPath)
                    .setStartTime(start)
                    .setDuration(Math.min(maxDurationSecs, duration - start))
                    .output(outputPath)
                    .on('end', () => {
                        completed++;
                        if (completed === numParts) {
                            resolve(outputPaths);
                        }
                    })
                    .on('error', reject)
                    .run();
            }
        });
    });
};

// Function to transcribe audio file
const transcribeAudio = async (audioPath) => {
    const audioFile = fs.createReadStream(audioPath);
    const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: "en",
        response_format: "text"
    });
    return transcription;
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

    const tmpDir = '/tmp';
    const mainAudioPath = path.join(tmpDir, `audio-${Date.now()}.mp3`);
    let audioParts = [];

    try {
        const apiKey = event.headers['x-api-key'];
        validateApiKey(apiKey);

        const { url } = JSON.parse(event.body);
        if (!url || !ytdl.validateURL(url)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Invalid YouTube URL' 
                })
            };
        }

        console.log('Getting video info...');
        const videoInfo = await getVideoInfo(url);

        console.log('Downloading audio...');
        const audioBuffer = await downloadAudio(url, videoInfo.format);

        console.log('Processing audio...');
        await processAudio(audioBuffer, mainAudioPath);

        console.log('Splitting audio if needed...');
        audioParts = await splitAudio(mainAudioPath);

        console.log('Transcribing audio...');
        let fullTranscript = '';
        for (const partPath of audioParts) {
            const partTranscript = await transcribeAudio(partPath);
            fullTranscript += partTranscript + ' ';
        }

        // Clean up files
        await Promise.all([
            unlink(mainAudioPath),
            ...audioParts.filter(p => p !== mainAudioPath).map(p => unlink(p))
        ]);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                title: videoInfo.title,
                transcript: fullTranscript.trim()
            })
        };
    } catch (error) {
        console.error('Error:', error);
        
        // Clean up files if they exist
        try {
            await Promise.all([
                fs.existsSync(mainAudioPath) ? unlink(mainAudioPath) : Promise.resolve(),
                ...audioParts.filter(p => p !== mainAudioPath && fs.existsSync(p)).map(p => unlink(p))
            ]);
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }

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