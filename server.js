// Fichier: server.js
const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Pour parser le corps des requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Fonction pour transformer l'URL d'image en URL de streaming
function transformUrl(imageUrl) {
    // Vérifier si l'URL correspond au format attendu
    if (!imageUrl.includes('cloudfront.net') || !imageUrl.includes('storyboards')) {
        return null;
    }

    // Extraire la partie base de l'URL (avant storyboards)
    const baseUrlPattern = /(https:\/\/[^\/]+\/[^\/]+_[^\/]+_[^\/]+_[^\/]+)/;
    const baseUrlMatch = imageUrl.match(baseUrlPattern);

    if (!baseUrlMatch) return null;

    const baseUrl = baseUrlMatch[1];
    // Construire l'URL de streaming
    return `${baseUrl}/chunked/index-dvr.m3u8`;
}

// Fonction pour modifier le contenu m3u8 afin de proxy les segments .ts
async function modifyM3U8Content(content, baseUrl) {
    // Extraire la dernière partie de l'URL (après le dernier /)
    const folderPath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);

    // Remplacer les références aux fichiers .ts par des références proxy
    let modifiedContent = content.toString();

    // Remplacer les chemins des fichiers .ts par des URL proxy
    modifiedContent = modifiedContent.replace(/^([\d]+\.ts)$/gm, function (match) {
        const tsUrl = folderPath + match;
        return `/proxy?url=${encodeURIComponent(tsUrl)}`;
    });

    return modifiedContent;
}

// Route pour l'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API pour transformer l'URL
app.post('/api/transform-url', (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL requise' });
    }

    const transformedUrl = transformUrl(url);

    if (!transformedUrl) {
        return res.status(400).json({ error: 'Format d\'URL invalide' });
    }

    res.json({ transformedUrl });
});

// Route pour agir comme proxy pour les fichiers m3u8 et ts
app.get('/proxy', async (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).send('URL requise');
    }

    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: url.endsWith('.m3u8') ? 'text' : 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Définir les en-têtes CORS pour permettre l'accès
        res.header('Access-Control-Allow-Origin', '*');

        // Si c'est un fichier m3u8, modifier le contenu pour proxy les segments .ts
        if (url.endsWith('.m3u8')) {
            // Ajouter le bon type MIME pour les fichiers m3u8
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');

            // Modifier le contenu pour proxy les segments .ts
            const modifiedContent = await modifyM3U8Content(response.data, url);
            return res.send(modifiedContent);
        }

        // Pour les fichiers .ts ou autres, transférer le contenu et les en-têtes pertinents
        if (url.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/MP2T');
        }

        // Pour les autres types, copier les en-têtes pertinents
        Object.keys(response.headers).forEach(key => {
            // Ignorer certains en-têtes qui pourraient causer des problèmes
            if (!['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
                res.setHeader(key, response.headers[key]);
            }
        });

        // Pour les streams, pipe directement la réponse
        if (response.data.pipe) {
            response.data.pipe(res);
        } else {
            res.send(response.data);
        }
    } catch (error) {
        console.error('Erreur proxy:', error.message);
        res.status(500).send(`Erreur: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});