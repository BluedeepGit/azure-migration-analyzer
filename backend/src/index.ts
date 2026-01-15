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

// --- TIPI AVANZATI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info';

interface MigrationIssue {
    severity: Severity;
    message: string;
    impact: string;       // Descrizione del disservizio
    workaround: string;   // Azione correttiva tecnica
    downtimeRisk: boolean; // Se true, l'applicazione smetterà di funzionare durante/dopo il move
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

// --- KNOWLEDGE BASE: REGOLE TENANT-TO-TENANT ---
// Ref: https://learn.microsoft.com/en-us/azure/role-based-access-control/transfer-subscription
const TENANT_RULES: Record<string, (res: any) => MigrationIssue[]> = {
    
    // 1. KEY VAULT (Criticità Massima)
    'microsoft.keyvault/vaults': (res) => {
        return [{
            severity: 'Critical',
            message: 'Associazione Tenant ID persa',
            impact: 'Il Key Vault diventerà INACCESSIBILE immediatamente dopo il trasferimento. Tutte le app che leggono secret/certificati falliranno.',
            workaround: 'Post-migrazione, eseguire immediatamente via CLI/Powershell: "Update-AzKeyVault -VaultName ... -TenantId ...". Ricreare tutte le Access Policies.',
            downtimeRisk: true
        }];
    },

    // 2. APP SERVICE (Web App / Function)
    'microsoft.web/sites': (res) => {
        const issues: MigrationIssue[] = [];
        // Certificati Managed
        issues.push({
            severity: 'Warning',
            message: 'App Service Managed Certificates',
            impact: 'I certificati gestiti da Azure potrebbero perdere il binding se il DNS cambia.',
            workaround: 'Rivalidare i domini personalizzati e rigenerare i certificati gestiti nel nuovo tenant.',
            downtimeRisk: false
        });
        // Auth / App Registration
        if (res.properties && res.properties.siteAuthEnabled) {
            issues.push({
                severity: 'Critical',
                message: 'Authentication / Authorization attivo',
                impact: 'Il login utenti fallirà. La App Registration risiede nel vecchio tenant.',
                workaround: 'Disabilitare Auth prima del move. Creare nuova App Registration nel nuovo tenant e riconfigurare l\'Auth.',
                downtimeRisk: true
            });
        }
        return issues;
    },

    // 3. SQL SERVER & DB
    'microsoft.sql/servers': (res) => {
        return [{
            severity: 'Critical',
            message: 'Azure AD Admin & Authentication',
            impact: 'L\'amministratore AD del DB viene rimosso. Utenti e app che usano "Active Directory Password" o "Integrated" non potranno loggarsi.',
            workaround: 'Reimpostare l\'Admin AD manualmente nel nuovo tenant. Eseguire script SQL per mappare i nuovi utenti del nuovo tenant (SID mismatch).',
            downtimeRisk: true
        }];
    },

    // 4. STORAGE ACCOUNT (ACLs)
    'microsoft.storage/storageaccounts': (res) => {
        // Controllo generico su AD Integration
        return [{
            severity: 'Warning',
            message: 'RBAC Data Plane & ACL',
            impact: 'Se si usano permessi RBAC per l\'accesso ai dati (Blob Data Reader), questi verranno persi.',
            workaround: 'Riassegnare i ruoli RBAC sugli oggetti Storage nel nuovo tenant.',
            downtimeRisk: false
        }];
    },

    // 5. KUBERNETES (AKS)
    'microsoft.containerservice/managedclusters': (res) => {
        return [{
            severity: 'Blocker',
            message: 'Perdita Identità Cluster & SPN',
            impact: 'Il cluster perderà la sua identità (Service Principal o Managed Identity). Integrazioni con ACR, Network e Storage si romperanno.',
            workaround: 'Microsoft sconsiglia il move di AKS. Best Practice: Creare nuovo cluster nel nuovo tenant e rideployare i carichi di lavoro (Disaster Recovery approach).',
            downtimeRisk: true
        }];
    },

    // 6. API MANAGEMENT
    'microsoft.apimanagement/service': (res) => {
        return [{
            severity: 'Blocker',
            message: 'Risorsa non spostabile durante aggiornamenti',
            impact: 'APIM è molto sensibile. Spesso richiede di essere in stato "Activated" puro senza operazioni in corso.',
            workaround: 'Verificare che non ci siano deploy in corso. Backup e Restore su nuova istanza è spesso preferibile al move.',
            downtimeRisk: true
        }];
    }
};

// --- MOTORE DI ANALISI ---
function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: Severity | 'Ready' = 'Ready';

    // A. CONTROLLI GLOBALI (Validi per tutte le risorse in Tenant Move)
    if (scenario === 'cross-tenant') {
        
        // CHECK 1: Managed Identities (Il killer silenzioso)
        if (res.identity && (res.identity.type === 'SystemAssigned' || res.identity.type.includes('SystemAssigned'))) {
            issues.push({
                severity: 'Critical',
                message: 'System-Assigned Managed Identity',
                impact: 'L\'identità viene eliminata. Accesso a KeyVault, SQL, Storage via MSI fallirà immediatamente.',
                workaround: 'Post-migrazione: Riabilitare Identity "On". Rieseguire script di assegnazione permessi (RBAC) su tutte le risorse target.',
                downtimeRisk: true
            });
        }
        if (res.identity && res.identity.type.includes('UserAssigned')) {
            issues.push({
                severity: 'Warning',
                message: 'User-Assigned Managed Identity',
                impact: 'La risorsa Identity si sposta, ma i permessi RBAC associati nel vecchio tenant sono persi.',
                workaround: 'Ricreare le Role Assignments nel nuovo tenant per la User Assigned Identity.',
                downtimeRisk: false
            });
        }

        // CHECK 2: Role Assignments (RBAC)
        // Nota: Aggiungiamo un warning "generale" se la risorsa non ha problemi specifici, per ricordare l'RBAC.
        if (issues.length === 0) {
            issues.push({
                severity: 'Info',
                message: 'Perdita assegnazioni RBAC (IAM)',
                impact: 'Gli utenti/gruppi che avevano accesso a questa risorsa non lo avranno più.',
                workaround: 'Esportare le Role Assignment attuali e preparare uno script di rimappatura (Vecchio User -> Nuovo User) da lanciare dopo il move.',
                downtimeRisk: false
            });
        }

        // B. CONTROLLI SPECIFICI PER TIPO (Dalla KB definita sopra)
        const specificRules = TENANT_RULES[res.type.toLowerCase()];
        if (specificRules) {
            issues.push(...specificRules(res));
        }
    }

    // SCENARIO: CROSS-SUBSCRIPTION / RESOURCE GROUP (Move API Limitations)
    if (scenario === 'cross-subscription' || scenario === 'cross-resourcegroup') {
        // VNET Peering
        if (res.type.toLowerCase() === 'microsoft.network/virtualnetworks') {
             // Simulazione check peering (nella realtà bisognerebbe guardare properties.virtualNetworkPeerings)
             if (res.properties && res.properties.virtualNetworkPeerings && res.properties.virtualNetworkPeerings.length > 0) {
                issues.push({
                    severity: 'Blocker',
                    message: 'VNET Peering Attivi',
                    impact: 'La validazione del move fallirà.',
                    workaround: 'Rimuovere tutti i peering prima dello spostamento. Ricrearli dopo.',
                    downtimeRisk: true
                });
             }
        }
        // Public IP Standard
        if (res.type.toLowerCase() === 'microsoft.network/publicipaddresses' && res.sku?.name === 'Standard') {
            issues.push({
                severity: 'Warning',
                message: 'Standard Public IP Association',
                impact: 'Potrebbe bloccare il move se non si spostano tutte le risorse associate (VM, NIC) in blocco.',
                workaround: 'Validare il move del Resource Group intero invece che della singola risorsa.',
                downtimeRisk: false
            });
        }
    }

    // CALCOLO SEVERITY FINALE
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

// --- API ROUTES ---
app.get('/api/analyze', async (req, res) => {
    try {
        const scenario = (req.query.scenario as MigrationScenario) || 'cross-tenant';
        const credential = new DefaultAzureCredential();
        const client = new ResourceGraphClient(credential);

        // Query espansa per prendere properties dettagliate (utile per Auth, Peering, ecc)
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
            downtimeRisks: analyzedResources.filter(r => r.issues.some(i => i.downtimeRisk)).length // KPI Nuovo
        };

        res.json({ scenario, summary, details: analyzedResources });

    } catch (error: any) {
        console.error("Errore:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
});