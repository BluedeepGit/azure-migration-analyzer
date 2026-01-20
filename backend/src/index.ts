import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { SubscriptionClient } from '@azure/arm-resources-subscriptions';
import { ResourceManagementClient } from '@azure/arm-resources';
import { analyzeResource, MigrationScenario } from './engine';
import { runIntegrationTest } from './verifyService';

// Import KB
import tenantRules from './rules.json';
import rgRules from './rules-rg.json';
import subRules from './rules-sub.json';
import regionRules from './rules-region.json';

const rulesData: any[] = [...tenantRules, ...rgRules, ...subRules, ...regionRules];

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

// --- API: LOGIN ---
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

// --- API: LIST RESOURCE GROUPS (NUOVO) ---
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

// --- API: LIST REGIONS (NUOVO - Semplificato) ---
app.get('/api/regions', (req, res) => {
    // Lista statica delle region principali per la UI (o si può fare dynamic fetch)
    const regions = [
        "westeurope", "northeurope", "italynorth", "germanywestcentral", "francecentral", "uksouth",
        "eastus", "eastus2", "westus", "westus2", "centralus", "southeastasia", "japaneast"
    ];
    res.json(regions.sort());
});

// --- HELPER: Validazione Region Capabilities ---
async function checkRegionAvailability(credential: any, subscriptionId: string, resources: any[], targetRegion: string) {
    if (!targetRegion) return resources;

    const client = new ResourceManagementClient(credential, subscriptionId);
    const providers = await client.providers.list();
    
    // Mappa Provider -> ResourceTypes -> Locations[]
    const providerMap: Record<string, Record<string, string[]>> = {};
    
    for await (const p of providers) {
        if (!p.namespace) continue;
        providerMap[p.namespace.toLowerCase()] = {};
        p.resourceTypes?.forEach(rt => {
            if (rt.resourceType && rt.locations) {
                providerMap[p.namespace!.toLowerCase()][rt.resourceType.toLowerCase()] = rt.locations.map(l => l.toLowerCase().replace(/ /g, ''));
            }
        });
    }

    // Applica controllo
    return resources.map(res => {
        const [provider, ...typeParts] = res.type.split('/');
        const resourceType = typeParts.join('/');
        
        // Cerca se il provider supporta la region target
        const supportedLocations = providerMap[provider.toLowerCase()]?.[resourceType.toLowerCase()];
        
        // Normalizza target region
        const targetClean = targetRegion.toLowerCase().replace(/ /g, '');

        if (supportedLocations && !supportedLocations.includes(targetClean)) {
            // INIETTA ERRORE CRITICO
            res.injectedIssue = {
                severity: 'Blocker',
                message: `Non disponibile in ${targetRegion}`,
                impact: `Il tipo di risorsa '${res.type}' non è disponibile nella regione di destinazione.`,
                workaround: `Scegliere una regione diversa o un servizio alternativo.`,
                downtimeRisk: true
            };
        }
        return res;
    });
}


// --- API: ANALYZE ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { scenario, auth, subscriptions, resourceGroups, targetRegion } = req.body;
        const selectedScenario = (scenario as MigrationScenario) || 'cross-tenant';
        
        if (!subscriptions || subscriptions.length === 0) return res.status(400).json({ error: "Nessuna sottoscrizione." });

        const credential = getCredential(auth);
        const client = new ResourceGraphClient(credential);

        // Costruzione Query Dinamica
        let whereClause = `where subscriptionId in ('${subscriptions.join("','")}')`;
        
        // Filtro Resource Group (Se presente)
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

        console.log(`Analisi: ${selectedScenario}. RGs: ${resourceGroups?.length || 'ALL'}. Region: ${targetRegion || 'N/A'}`);

        const result = await client.resources({ query, subscriptions });
        let rawResources = result.data as any[];

        // --- REGION CAPABILITY CHECK (Solo se scenario Region) ---
        if (selectedScenario === 'cross-region' && targetRegion) {
            // Usiamo la prima sottoscrizione per scaricare la mappa dei provider (assumiamo siano uguali)
            rawResources = await checkRegionAvailability(credential, subscriptions[0], rawResources, targetRegion);
        }

        // --- ANALISI MOTORE ---
        const analyzedResources = rawResources.map(r => {
            const analysis = analyzeResource(r, selectedScenario);
            
            // Se c'è un errore iniettato dalla validazione regionale, aggiungilo
            if (r.injectedIssue) {
                analysis.issues.unshift(r.injectedIssue); // Mettilo in cima
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

// ... (Diagnostica e Listen rimangono uguali) ...
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