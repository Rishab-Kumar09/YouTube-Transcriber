const validateApiKey = (req, res, next) => {
    // Skip API key validation for health check
    if (req.path === '/health') {
        return next();
    }

    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: 'API key is required'
        });
    }

    if (apiKey !== process.env.API_KEY) {
        return res.status(403).json({
            success: false,
            error: 'Invalid API key'
        });
    }

    next();
};

module.exports = {
    validateApiKey
}; 