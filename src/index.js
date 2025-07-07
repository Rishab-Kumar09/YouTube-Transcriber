require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { transcribeVideo } = require('./services/transcriber');
const { validateApiKey } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// API Key validation middleware
app.use(validateApiKey);

// Routes
app.post('/api/transcript', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'YouTube URL is required' 
            });
        }

        const transcript = await transcribeVideo(url);
        res.json({ success: true, transcript });
    } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to transcribe video' 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 