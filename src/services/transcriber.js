const ytdl = require('ytdl-core');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const transcribeVideo = async (url) => {
    try {
        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }

        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        // Generate unique filename
        const videoId = ytdl.getVideoID(url);
        const audioPath = path.join(tempDir, `${videoId}.mp3`);

        // Download audio only
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
            language: "en", // can be changed based on video language
            response_format: "text"
        });

        // Cleanup temp files
        fs.unlinkSync(audioPath);

        return transcription;
    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
};

module.exports = {
    transcribeVideo
}; 