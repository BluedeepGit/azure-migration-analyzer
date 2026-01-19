import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { analyzeResource, MigrationScenario } from './engine'; // Importa Engine
import { runIntegrationTest } from './verifyService';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

// Endpoint per lanciare il Self-Test
app.get('/api/admin/run-test', (req, res) => {
    try {
        console.log("Avvio Integration Test su richiesta utente...");
        const results = runIntegrationTest();
        res.json(results);
    } catch (error: any) {
        console.error("Errore durante il test:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/analyze', async (req, res) => {
    try {
        const scenario = (req.query.scenario as MigrationScenario) || 'cross-tenant';
        const credential = new DefaultAzureCredential();
        const client = new ResourceGraphClient(credential);

        const query = `
            Resources
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup
            | order by resourceGroup asc
        `;

        const result = await client.resources({ query });
        
        // Usa il motore importato
        const analyzedResources = (result.data as any[]).map(r => analyzeResource(r, scenario));

        const summary = {
            total: analyzedResources.length,
            blockers: analyzedResources.filter(r => r.migrationStatus === 'Blocker').length,
            critical: analyzedResources.filter(r => r.migrationStatus === 'Critical').length,
            warnings: analyzedResources.filter(r => r.migrationStatus === 'Warning').length,
            ready: analyzedResources.filter(r => r.migrationStatus === 'Ready').length,
            downtimeRisks: analyzedResources.filter(r => r.issues.some(i => i.downtimeRisk)).length
        };

        res.json({ scenario, summary, details: analyzedResources });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
});