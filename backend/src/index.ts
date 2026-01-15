import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// 1. CONFIGURAZIONE FRONTEND: Serve i file statici della cartella 'public' (dove copieremo React)
app.use(express.static(path.join(__dirname, '../public')));

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

// --- LOGICA DI ANALISI (IL MOTORE) ---
function analyzeResource(res: any): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: AnalyzedResource['migrationStatus'] = 'Ready';

    // A. Analisi Identity
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

    // B. Analisi specifica per Tipo di Risorsa
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
            issues.push({
                severity: 'Info',
                message: 'Virtual Machine.',
                remediation: 'Verificare che non ci siano estensioni crittografate o backup attivi nel vault di recovery.'
            });
            break;

        case 'microsoft.web/sites':
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

    // C. Calcolo dello stato finale in base alla gravità peggiore
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

// --- ENDPOINT API ---

// Endpoint principale per l'analisi
app.get('/api/analyze', async (req, res) => {
    try {
        const credential = new DefaultAzureCredential();
        const client = new ResourceGraphClient(credential);

        // Query Azure Graph per estrarre tutti i dettagli necessari
        const query = `
            Resources
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup
            | order by resourceGroup asc
        `;

        console.log("Inizio scansione e analisi delle risorse su Azure Graph...");
        const result = await client.resources({ query });
        
        // Applichiamo la logica riga per riga
        const analyzedResources = (result.data as any[]).map(analyzeResource);

        // Calcolo statistiche per la dashboard
        const summary = {
            total: analyzedResources.length,
            blockers: analyzedResources.filter(r => r.migrationStatus === 'Blocker').length,
            critical: analyzedResources.filter(r => r.migrationStatus === 'Critical').length,
            warnings: analyzedResources.filter(r => r.migrationStatus === 'Warning').length,
            ready: analyzedResources.filter(r => r.migrationStatus === 'Ready').length,
        };

        // Ritorno JSON al frontend
        res.json({
            summary,
            details: analyzedResources
        });

    } catch (error: any) {
        console.error("Errore Analisi:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. CONFIGURAZIONE FRONTEND (Fallback): Tutte le richieste che NON sono /api mandano a React
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// --- AVVIO SERVER ---
app.listen(PORT, () => {
    console.log(`Azure Migration Engine avviato su porta ${PORT}`);
});