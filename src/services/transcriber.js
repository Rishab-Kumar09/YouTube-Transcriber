const ytdl = require('ytdl-core');
const { Model } = require('vosk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Initialize Vosk model
const model = new Model(path.join(__dirname, '../../models/vosk-model-small-en-us-0.15'));

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
        const audioPath = path.join(tempDir, `${videoId}.wav`);

        // Download audio only
        await new Promise((resolve, reject) => {
            ytdl(url, { quality: 'highestaudio' })
                .pipe(fs.createWriteStream(audioPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        // Convert to required format for Vosk
        const ffmpeg = spawn('ffmpeg', [
            '-i', audioPath,
            '-ar', '16000',
            '-ac', '1',
            '-f', 'wav',
            path.join(tempDir, `${videoId}_converted.wav`)
        ]);

        await new Promise((resolve, reject) => {
            ffmpeg.on('close', resolve);
            ffmpeg.on('error', reject);
        });

        // Read and transcribe the audio
        const audioBuffer = fs.readFileSync(path.join(tempDir, `${videoId}_converted.wav`));
        const recognizer = new vosk.Recognizer({ model: model, sampleRate: 16000 });
        
        recognizer.acceptWaveform(audioBuffer);
        const result = recognizer.finalResult();

        // Cleanup temp files
        fs.unlinkSync(audioPath);
        fs.unlinkSync(path.join(tempDir, `${videoId}_converted.wav`));

        return result.text;
    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
};

module.exports = {
    transcribeVideo
}; 