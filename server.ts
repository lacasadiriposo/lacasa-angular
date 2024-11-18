import 'zone.js/node';
import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import NodeCache from 'node-cache';
import bootstrap from './src/main.server';
import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import { AdminConfig, CacheData } from './server_interface';

// Configurazione ambiente
const environment = process['env']['NODE_ENV'] || 'development';
dotenv.config({ path: `.env.${environment}` });

// Configurazione Node-Cache senza scadenza
const memoryCache = new NodeCache({
  deleteOnExpire: false,  // Non cancellare mai automaticamente
  checkperiod: 0,         // Disabilita i controlli periodici
  useClones: false        // Ottimizzazione performance
});

// Configurazione Admin
export const getAdminConfig = (): AdminConfig => ({
  leadCollection: process.env['LEAD_COLLECTION']!,
  leadSentCollection: process.env['LEAD_SENT_COLLECTION']!,
  ownersCollection: process.env['OWNERS_COLLECTION']!,
  cardsCollection: process.env['CARDS_COLLECTION']!,
  project_id: process.env['FIREBASE_PROJECT_ID']!,
  projectId: process.env['FIREBASE_PROJECT_ID']!,
  private_key_id: process.env['FIREBASE_PRIVATE_KEY_ID']!,
  private_key: process.env['FIREBASE_PRIVATE_KEY']?.replace(/\\n/g, '\n')!,
  client_email: process.env['FIREBASE_CLIENT_EMAIL']!,
  client_id: process.env['FIREBASE_CLIENT_ID']!,
  auth_uri: process.env['FIREBASE_AUTH_URI']!,
  token_uri: process.env['FIREBASE_TOKEN_URI']!,
  auth_provider_x509_cert_url: process.env['FIREBASE_AUTH_PROVIDER_CERT_URL']!,
  client_x509_cert_url: process.env['FIREBASE_CLIENT_CERT_URL']!
});

const __dirname = dirname(fileURLToPath(import.meta.url));

export function app(): express.Express {
  const server = express();
  const distFolder = join(__dirname, './');
  const indexHtml = join(distFolder, 'src/index.html');
  const commonEngine = new CommonEngine();

  // Inizializza Firebase
  admin.initializeApp({
    credential: admin.credential.cert(getAdminConfig()),
    databaseURL: process.env['FIREBASE_DATABASE_URL']

  });

  const db = admin.firestore();

  server.set('view engine', 'html');
  server.set('views', distFolder);
  server.get('*.*', express.static(distFolder, { maxAge: '1y' }));

  // Sitemap handler
  server.get('/sitemap.xml', (req, res) => {
    const currentTime = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    console.log('sitemap.xml generated at', currentTime);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>https://www.example2.com/</loc>
        <lastmod>2021-07-02</lastmod>
        <changefreq>monthly</changefreq>
        <priority>1.0</priority>
      </url>
      <url>
        <loc>https://www.example.com/about</loc>
        <lastmod>2021-07-01</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
      </url>
    </urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  });

  // Main route handler con cache ibrida
  server.get('*', async (req, res): Promise<void> => {
    try {
      const safeUrl = req.url.replace(/[\/\s]/g, '_');
      
      // 1. Controlla prima la cache in memoria
      const memoryCached = memoryCache.get(safeUrl);
      if (memoryCached) {
        console.log('Memory Cache hit:', req.url);
        res.send(memoryCached);
        return;
      }

      // 2. Se non in memoria, controlla Firestore
      const docRef = db.collection('cache').doc(safeUrl);
      try {
        const cachedDoc = await docRef.get();
        const cachedData = cachedDoc.data() as CacheData | undefined;

        if (cachedDoc.exists && cachedData && typeof cachedData.html === 'string') {
          console.log('Firestore Cache hit:', req.url);
          // Salva in memoria per il futuro
          memoryCache.set(safeUrl, cachedData.html);
          res.send(cachedData.html);
          return;
        }
      } catch (cacheError) {
        console.warn('Cache read error:', cacheError);
      }

      // 3. Se non in cache, renderizza
      const html = await commonEngine.render({
        bootstrap,
        documentFilePath: indexHtml,
        url: req.url,
        providers: [
          { provide: APP_BASE_HREF, useValue: req.baseUrl }
        ]
      });

      // 4. Salva in entrambe le cache
      try {
        // Salva in memoria
        memoryCache.set(safeUrl, html);
        
        // Salva in Firestore
        await docRef.set({
          html,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          url: req.url,
          createdAt: Date.now()
        });
        console.log("Pagina salvata in cache:", req.url);
      } catch (cacheError) {
        console.error('Error saving to cache:', cacheError);
      }

      res.send(html);
      return;

    } catch (error) {
      console.error(`Error processing request for ${req.url}:`, error);
      res.status(500).send('Server Error');
      return;
    }
  });

  // Endpoint per invalidazione manuale della cache
  server.post('/api/cache/invalidate', (req, res) => {
    const { url, pattern } = req.body;

    try {
      if (url) {
        const safeUrl = url.replace(/[\/\s]/g, '_');
        // Invalida memoria
        memoryCache.del(safeUrl);
        // Invalida Firestore
        db.collection('cache').doc(safeUrl).delete();
        console.log(`Cache invalidata per: ${url}`);
      }

      if (pattern) {
        // Invalida memoria per pattern
        const memoryKeys = memoryCache.keys();
        memoryKeys.forEach(key => {
          if (key.includes(pattern)) {
            memoryCache.del(key);
            // Invalida anche su Firestore
            db.collection('cache').doc(key).delete();
            console.log(`Cache invalidata per pattern ${pattern}: ${key}`);
          }
        });
      }

      res.send({ success: true });
    } catch (error) {
      console.error('Errore invalidazione cache:', error);
      res.status(500).send({ error: 'Cache invalidation failed' });
    }
  });

  return server;
}

function run(): void {
  const port = process.env['PORT'] || 4000;
  const server = app();
  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

run();