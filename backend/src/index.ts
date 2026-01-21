import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { ResourceManagementClient } from '@azure/arm-resources';
import { analyzeResource, MigrationScenario } from './engine';
import { runIntegrationTest } from './verifyService';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

function getCredential(auth: any) {
    if (auth && auth.tenantId && auth.clientId && auth.clientSecret) {
        return new ClientSecretCredential(auth.tenantId, auth.clientId, auth.clientSecret);
    }
    return new DefaultAzureCredential();
}

// --- API: LOGIN & SUBSCRIPTIONS ---
app.post('/api/login', async (req, res) => {
    try {
        const { auth } = req.body;
        const credential = getCredential(auth);
        const subClient = new SubscriptionClient(credential);
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
        res.status(401).json({ error: "Autenticazione fallita: " + error.message });
    }
});

// --- API: LIST RESOURCE GROUPS ---
app.post('/api/resource-groups', async (req, res) => {
    try {
        const { auth, subscriptions } = req.body;
        if (!subscriptions || subscriptions.length === 0) return res.status(400).json({ error: "No Subscriptions" });

        const credential = getCredential(auth);
        const client = new ResourceGraphClient(credential);
        
        const subsString = subscriptions.join("','");
        const query = `
            ResourceContainers
            | where type == 'microsoft.resources/subscriptions/resourcegroups'
            | where subscriptionId in ('${subsString}')
            | project name, subscriptionId, location, resourceGroup
            | order by name asc
        `;

        const result = await client.resources({ query, subscriptions });
        res.json(result.data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// --- API: LIST REGIONS (Physical Only) ---
app.post('/api/regions', async (req, res) => {
    try {
        const { auth, subscriptionId } = req.body;
        if (!subscriptionId) return res.status(400).json({ error: "Subscription ID richiesto." });

        const credential = getCredential(auth);
        const client = new SubscriptionClient(credential);
        
        const locations: { name: string; displayName: string }[] = [];
        
        for await (const loc of client.subscriptions.listLocations(subscriptionId)) {
            // FIX: Filtriamo solo le regioni FISICHE. Esclude "Logical" (es. Germany Central Stage).
            if (loc.metadata && loc.metadata.regionType === 'Physical') {
                locations.push({
                    name: loc.name || '', 
                    displayName: loc.displayName || loc.name || ''
                });
            }
        }
        
        locations.sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        res.json(locations);
    } catch (error: any) {
        console.error("Region Fetch Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- HELPER: Validazione Region Capabilities ---
async function checkRegionAvailability(credential: any, subscriptionId: string, resources: any[], targetRegion: string) {
    if (!targetRegion) return resources;
    
    const targetClean = targetRegion.toLowerCase().replace(/ /g, '');
    const client = new ResourceManagementClient(credential, subscriptionId);
    
    const providerMap: Record<string, Record<string, string[]>> = {};
    
    // Costruiamo la mappa delle capacità per provider
    for await (const p of client.providers.list()) {
        if (!p.namespace) continue;
        const namespace = p.namespace.toLowerCase();
        providerMap[namespace] = {};
        
        p.resourceTypes?.forEach(rt => {
            if (rt.resourceType && rt.locations) {
                providerMap[namespace][rt.resourceType.toLowerCase()] = rt.locations.map(l => l.toLowerCase().replace(/ /g, ''));
            }
        });
    }

    return resources.map(res => {
        // FIX: Se la risorsa è Globale, ignoriamo il controllo regionale (è sempre disponibile)
        if (res.location && res.location.toLowerCase() === 'global') {
            return res;
        }

        const parts = res.type.split('/');
        if (parts.length < 2) return res;

        const provider = parts[0].toLowerCase();
        const resourceType = parts.slice(1).join('/').toLowerCase();
        
        const supportedLocations = providerMap[provider]?.[resourceType];
        
        if (supportedLocations) {
            if (!supportedLocations.includes(targetClean)) {
                // Errore: Il provider non esiste nella region target
                res.injectedIssue = {
                    severity: 'Blocker',
                    message: `Non disponibile in ${targetRegion}`,
                    impact: `Il Resource Provider '${res.type}' non è supportato nella regione ${targetRegion}.`,
                    workaround: `Selezionare una regione diversa o ridistribuire in una regione supportata.`,
                    downtimeRisk: true
                };
            }
        }
        return res;
    });
}

// --- API: ANALYZE ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { scenario, auth, subscriptions, resourceGroups, targetRegion } = req.body;
        const selectedScenario = (scenario as MigrationScenario) || 'cross-tenant';
        
        if (!subscriptions || !Array.isArray(subscriptions) || subscriptions.length === 0) {
            return res.status(400).json({ error: "Nessuna sottoscrizione selezionata." });
        }

        const credential = getCredential(auth);
        const client = new ResourceGraphClient(credential);

        let whereClause = `where subscriptionId in ('${subscriptions.join("','")}')`;
        if (resourceGroups && resourceGroups.length > 0) {
            whereClause += ` | where resourceGroup in ('${resourceGroups.join("','")}')`;
        }

        const query = `
            Resources
            | ${whereClause}
            | join kind=leftouter (
                ResourceContainers
                | where type == 'microsoft.resources/subscriptions'
                | project subscriptionId, subscriptionName = name
            ) on subscriptionId
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup, subscriptionId, subscriptionName
            | order by subscriptionId asc, resourceGroup asc
        `;

        const result = await client.resources({ query, subscriptions });
        let rawResources = result.data as any[];

        // Check Regionale (se applicabile)
        if (selectedScenario === 'cross-region' && targetRegion) {
            rawResources = await checkRegionAvailability(credential, subscriptions[0], rawResources, targetRegion);
        }

        // Analisi Regole JSON
        const analyzedResources = rawResources.map(r => {
            const analysis = analyzeResource(r, selectedScenario);
            
            // Se checkRegionAvailability ha iniettato un errore, lo mostriamo con priorità
            if (r.injectedIssue) {
                analysis.issues.unshift(r.injectedIssue);
                analysis.migrationStatus = 'Blocker';
            }

            return {
                ...analysis,
                resourceGroup: r.resourceGroup,
                subscriptionId: r.subscriptionId,
                subscriptionName: r.subscriptionName || r.subscriptionId
            };
        });

        const summary = {
            total: analyzedResources.length,
            blockers: analyzedResources.filter(r => r.migrationStatus === 'Blocker').length,
            critical: analyzedResources.filter(r => r.migrationStatus === 'Critical').length,
            warnings: analyzedResources.filter(r => r.migrationStatus === 'Warning').length,
            ready: analyzedResources.filter(r => r.migrationStatus === 'Ready').length,
            downtimeRisks: analyzedResources.filter(r => r.issues.some(i => i.downtimeRisk)).length
        };

        res.json({ scenario: selectedScenario, summary, details: analyzedResources, targetRegion });

    } catch (error: any) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/run-test', (req, res) => {
    try {
        const results = runIntegrationTest();
        res.json(results);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });