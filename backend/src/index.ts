import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { analyzeResource, MigrationScenario } from './engine';
import { runIntegrationTest } from './verifyService';

// --- IMPORTIAMO TUTTE LE KNOWLEDGE BASE (Per i log) ---
import tenantRules from './rules.json';
import rgRules from './rules-rg.json';
import subRules from './rules-sub.json';
import regionRules from './rules-region.json';

// Uniamo tutto in un unico array per i log (l'engine lo fa internamente, ma qui serve per debug)
const rulesData: any[] = [...tenantRules, ...rgRules, ...subRules, ...regionRules];

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

// --- HELPER PER LE CREDENZIALI ---
function getCredential(auth: any) {
    if (auth && auth.tenantId && auth.clientId && auth.clientSecret) {
        return new ClientSecretCredential(auth.tenantId, auth.clientId, auth.clientSecret);
    }
    return new DefaultAzureCredential();
}

// --- API: LOGIN & LIST SUBSCRIPTIONS ---
app.post('/api/login', async (req, res) => {
    try {
        const { auth } = req.body;
        const credential = getCredential(auth);
        
        const subClient = new SubscriptionClient(credential);
        
        // FIX: Definiamo esplicitamente il tipo dell'array
        const subsList: any[] = [];
        
        for await (const sub of subClient.subscriptions.list()) {
            subsList.push({
                subscriptionId: sub.subscriptionId,
                displayName: sub.displayName,
                tenantId: sub.tenantId
            });
        }

        res.json({ count: subsList.length, subscriptions: subsList });
    } catch (error: any) {
        console.error("Login Error:", error.message);
        res.status(401).json({ error: "Autenticazione fallita: " + error.message });
    }
});

// --- API: ANALYZE ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { scenario, auth, subscriptions } = req.body;
        const selectedScenario = (scenario as MigrationScenario) || 'cross-tenant';
        
        if (!subscriptions || !Array.isArray(subscriptions) || subscriptions.length === 0) {
            return res.status(400).json({ error: "Nessuna sottoscrizione selezionata." });
        }

        const credential = getCredential(auth);
        const client = new ResourceGraphClient(credential);

        // Costruiamo la lista di subscription ID formattata per la query
        const subsString = subscriptions.join("','");

        const query = `
            Resources
            | where subscriptionId in ('${subsString}')
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup, subscriptionId
            | order by subscriptionId asc, resourceGroup asc
        `;

        console.log(`Analisi: ${selectedScenario}. Subs target: ${subscriptions.length}`);

        const result = await client.resources({ 
            query, 
            subscriptions: subscriptions 
        });
        
        const analyzedResources = (result.data as any[]).map(r => analyzeResource(r, selectedScenario));

        const summary = {
            total: analyzedResources.length,
            blockers: analyzedResources.filter(r => r.migrationStatus === 'Blocker').length,
            critical: analyzedResources.filter(r => r.migrationStatus === 'Critical').length,
            warnings: analyzedResources.filter(r => r.migrationStatus === 'Warning').length,
            ready: analyzedResources.filter(r => r.migrationStatus === 'Ready').length,
            downtimeRisks: analyzedResources.filter(r => r.issues.some(i => i.downtimeRisk)).length
        };

        res.json({ scenario: selectedScenario, summary, details: analyzedResources });

    } catch (error: any) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- API: DIAGNOSTICA ---
app.get('/api/admin/run-test', (req, res) => {
    try {
        const results = runIntegrationTest();
        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
    console.log(`Knowledge Base Stats: ${rulesData.length} rules loaded.`);
});