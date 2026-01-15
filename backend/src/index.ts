import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// --- DEFINIZIONE TIPI ---
interface MigrationIssue {
    severity: 'Blocker' | 'Critical' | 'Warning' | 'Info';
    message: string;
    remediation: string;
}

interface AnalyzedResource {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    migrationStatus: 'Ready' | 'Warning' | 'Critical' | 'Blocker';
    issues: MigrationIssue[];
}

// --- LOGICA DI ANALISI ---
function analyzeResource(res: any): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: AnalyzedResource['migrationStatus'] = 'Ready';

    // 1. ANALISI IDENTITY (Il problema #1 nelle migrazioni Tenant-to-Tenant)
    if (res.identity && (res.identity.type === 'SystemAssigned' || res.identity.type.includes('SystemAssigned'))) {
        issues.push({
            severity: 'Critical',
            message: 'Managed Identity rilevata (System Assigned).',
            remediation: 'L\'identità verrà eliminata e ricreata con un nuovo Object ID. I permessi su KeyVault/SQL/Storage andranno persi e riassegnati.'
        });
    }
    if (res.identity && res.identity.type.includes('UserAssigned')) {
        issues.push({
            severity: 'Warning',
            message: 'Managed Identity rilevata (User Assigned).',
            remediation: 'La risorsa Identity deve essere spostata prima o insieme alla risorsa padre.'
        });
    }

    // 2. ANALISI SPECIFICA PER TIPO
    switch (res.type.toLowerCase()) {
        case 'microsoft.keyvault/vaults':
            issues.push({
                severity: 'Critical',
                message: 'Key Vault legato al Tenant ID.',
                remediation: 'Dopo la migrazione, il Key Vault sarà inaccessibile. Necessario reimpostare il Tenant ID via CLI e ricreare le Access Policies.'
            });
            break;

        case 'microsoft.network/publicipaddresses':
            if (res.sku && res.sku.name === 'Standard') {
                issues.push({
                    severity: 'Blocker',
                    message: 'Public IP SKU Standard.',
                    remediation: 'I Public IP Standard non possono essere spostati tra sottoscrizioni/tenant se associati a risorse. Spesso richiesto disassociazione o ricreazione.'
                });
            }
            break;
            
        case 'microsoft.compute/virtualmachines':
            if (res.properties && res.properties.osProfile && res.properties.osProfile.linuxConfiguration && res.properties.osProfile.linuxConfiguration.ssh) {
                 // Check generico, le VM di solito si muovono bene ma attenzione alle estensioni
            }
            issues.push({
                severity: 'Info',
                message: 'Virtual Machine.',
                remediation: 'Verificare che non ci siano estensioni crittografate o backup attivi nel vault di recovery.'
            });
            break;

        case 'microsoft.web/sites': // Web Apps
            issues.push({
                severity: 'Warning',
                message: 'App Service Web App.',
                remediation: 'I certificati App Service Managed dovranno essere riconvalidati (dominio). I Custom Domain potrebbero richiedere aggiornamento DNS.'
            });
            break;

        case 'microsoft.sql/servers':
            if (res.identity) {
                 issues.push({
                    severity: 'Critical',
                    message: 'SQL Server con AAD Auth / Identity.',
                    remediation: 'L\'Admin AAD del server SQL verrà invalidato. Va reimpostato post-migrazione.'
                });
            }
            break;
    }

    // Determina lo stato finale basato sulla gravità peggiore trovata
    if (issues.some(i => i.severity === 'Blocker')) status = 'Blocker';
    else if (issues.some(i => i.severity === 'Critical')) status = 'Critical';
    else if (issues.some(i => i.severity === 'Warning')) status = 'Warning';

    return {
        id: res.id,
        name: res.name,
        type: res.type,
        resourceGroup: res.resourceGroup,
        location: res.location,
        migrationStatus: status,
        issues
    };
}

// --- ENDPOINT ---
app.get('/', (req, res) => { res.send('Azure Migration Engine Ready.'); });

app.get('/api/analyze', async (req, res) => {
    try {
        const credential = new DefaultAzureCredential();
        const client = new ResourceGraphClient(credential);

        // Query ottimizzata per estrarre proprietà vitali per l'analisi
        const query = `
            Resources
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup
            | order by resourceGroup asc
        `;

        console.log("Analisi in corso...");
        const result = await client.resources({ query });
        
        // Eseguiamo l'analisi logica su ogni risorsa
        const analyzedResources = (result.data as any[]).map(analyzeResource);

        // Calcolo statistiche
        const summary = {
            total: analyzedResources.length,
            blockers: analyzedResources.filter(r => r.migrationStatus === 'Blocker').length,
            critical: analyzedResources.filter(r => r.migrationStatus === 'Critical').length,
            warnings: analyzedResources.filter(r => r.migrationStatus === 'Warning').length,
            ready: analyzedResources.filter(r => r.migrationStatus === 'Ready').length,
        };

        res.json({
            summary,
            details: analyzedResources
        });

    } catch (error: any) {
        console.error("Errore Analisi:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
});