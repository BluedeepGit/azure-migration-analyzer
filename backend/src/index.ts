import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info';

interface MigrationIssue {
    severity: Severity;
    message: string;
    impact: string;       
    workaround: string;   
    downtimeRisk: boolean; 
}

interface AnalyzedResource {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    migrationStatus: Severity | 'Ready';
    issues: MigrationIssue[];
}

// --- HELPER PER GARANTIRE STRUTTURA DATI ---
const createIssue = (
    severity: Severity, 
    message: string, 
    impact: string, 
    workaround: string, 
    downtimeRisk: boolean = false
): MigrationIssue => ({ severity, message, impact, workaround, downtimeRisk });

// --- KNOWLEDGE BASE: REGOLE TENANT-TO-TENANT ---
const TENANT_RULES: Record<string, (res: any) => MigrationIssue[]> = {
    
    // 1. KEY VAULT
    'microsoft.keyvault/vaults': (res) => [
        createIssue(
            'Critical',
            'Associazione Tenant ID persa',
            'Il Key Vault diventerà INACCESSIBILE. Le app non potranno leggere i secret.',
            'Eseguire post-migrazione: "Update-AzKeyVault -VaultName X -TenantId Y". Ricreare Access Policies.',
            true
        )
    ],

    // 2. APP SERVICE (Web App)
    'microsoft.web/sites': (res) => {
        const issues: MigrationIssue[] = [];
        
        // Controllo generico sempre presente per Web App
        issues.push(createIssue(
            'Warning',
            'App Service Custom Domains & Certs',
            'I domini custom e i certificati SSL gestiti potrebbero sganciarsi durante il cambio tenant.',
            'Rivalidare i record DNS (TXT) dei domini e rigenerare i certificati nel nuovo tenant.',
            false
        ));

        // Auth Check
        if (res.properties && res.properties.siteAuthEnabled) {
            issues.push(createIssue(
                'Critical',
                'Authentication attivo (App Registration)',
                'Il login utenti fallirà perché la App Registration è nel vecchio tenant.',
                'Disabilitare Auth prima del move. Creare nuova App Registration nel nuovo tenant e riconfigurare.',
                true
            ));
        }
        return issues;
    },

    // 3. SQL SERVER
    'microsoft.sql/servers': (res) => [
        createIssue(
            'Critical',
            'Azure AD Admin & Auth',
            'L\'admin AD del DB viene rimosso. Gli utenti AAD non potranno loggarsi.',
            'Reimpostare l\'Admin AD manualmente nel nuovo tenant. Rimappare utenti DB con nuovi SID.',
            true
        )
    ],

    // 4. AKS / VM SCALE SETS (Il caso che vedevi vuoto)
    'microsoft.compute/virtualmachinescalesets': (res) => [
        createIssue(
            'Warning',
            'VM Scale Set (AKS Node Pool o Standalone)',
            'Se parte di AKS, il cluster perderà l\'identità. Se standalone, verificare dipendenze LB.',
            'Per AKS: Si consiglia redeploy del cluster. Per VMSS puro: verificare Load Balancer e VNET.',
            true
        )
    ],

    // 5. STORAGE ACCOUNT
    'microsoft.storage/storageaccounts': (res) => [
        createIssue(
            'Info',
            'Storage Account Check',
            'I dati rimangono intatti, ma le regole RBAC sui dati (Blob Reader) vengono perse.',
            'Riassegnare i ruoli RBAC (IAM) agli utenti nel nuovo tenant.',
            false
        )
    ]
};

// --- MOTORE DI ANALISI ---
function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: Severity | 'Ready' = 'Ready';

    // SCENARIO CROSS-TENANT
    if (scenario === 'cross-tenant') {
        
        // CHECK 1: Managed Identities (Global Check)
        if (res.identity && (res.identity.type === 'SystemAssigned' || res.identity.type.includes('SystemAssigned'))) {
            issues.push(createIssue(
                'Critical',
                'System-Assigned Managed Identity',
                'L\'identità viene ELIMINATA. Accesso a risorse protette fallirà.',
                'Riabilitare Identity "On" dopo il move. Rieseguire script permessi RBAC.',
                true
            ));
        }
        if (res.identity && res.identity.type.includes('UserAssigned')) {
            issues.push(createIssue(
                'Warning',
                'User-Assigned Managed Identity',
                'La risorsa Identity si sposta, ma i permessi RBAC associati nel vecchio tenant sono persi.',
                'Ricreare le Role Assignments nel nuovo tenant per la User Assigned Identity.',
                false
            ));
        }

        // CHECK 2: Specifiche Risorse
        const specificRules = TENANT_RULES[res.type.toLowerCase()];
        if (specificRules) {
            issues.push(...specificRules(res));
        }
    }

    // SCENARI ALTRI (Semplificati per brevità, ma usano createIssue)
    if (scenario === 'cross-region') {
        // ... Logica esistente adattata ...
        if (res.type.toLowerCase() === 'microsoft.compute/virtualmachines') {
            issues.push(createIssue('Info', 'Supportato da Resource Mover', 'Spostabile tra region.', 'Usare Azure Resource Mover.', false));
        }
    }

    // CALCOLO SEVERITY
    if (issues.some(i => i.severity === 'Blocker')) status = 'Blocker';
    else if (issues.some(i => i.severity === 'Critical')) status = 'Critical';
    else if (issues.some(i => i.severity === 'Warning')) status = 'Warning';
    else if (issues.some(i => i.severity === 'Info')) status = 'Info';

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

// --- API ---
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