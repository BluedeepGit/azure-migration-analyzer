import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// --- 1. IMPORTIAMO TUTTE LE KNOWLEDGE BASE ---
import tenantRules from './rules.json';       // Cross-Tenant Rules
import moveRules from './rules-move.json';    // Cross-Subscription Rules
import regionRules from './rules-region.json'; // Cross-Region Rules

// Uniamo tutto in un unico array master
// IMPORTANTE: TypeScript potrebbe lamentarsi se i JSON non hanno "as const", 
// forziamo il tipo a any[] per flessibilità nel merge
const rulesData: any[] = [...tenantRules, ...moveRules, ...regionRules];

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info';

interface RuleDefinition {
    id: string;
    resourceType: string;
    scenario: string;
    condition?: {
        field: string;
        operator: 'eq' | 'neq' | 'contains' | 'notEmpty';
        value?: any;
    };
    severity: Severity;
    message: string;
    impact: string;
    workaround: string;
    downtimeRisk: boolean;
    refLink?: string;
}

interface MigrationIssue {
    ruleId: string;
    severity: Severity;
    message: string;
    impact: string;
    workaround: string;
    downtimeRisk: boolean;
    refLink?: string;
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

// --- HELPER ---
function getNestedValue(obj: any, path: string): any {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
}

// --- ENGINE DI VALIDAZIONE (CORE) ---
function evaluateRule(res: any, rule: RuleDefinition, scenario: MigrationScenario): boolean {
    
    // 1. FILTRO SCENARIO (Con Logica di Ereditarietà)
    let scenarioMatch = false;

    if (rule.scenario === scenario) {
        // Match esatto (es. cross-region == cross-region)
        scenarioMatch = true;
    } else if (scenario === 'cross-resourcegroup' && rule.scenario === 'cross-subscription') {
        // FIX CRITICO: Se sto spostando tra Resource Group, applico anche le regole 
        // di Subscription Move, perché i blocchi sono quasi sempre gli stessi.
        scenarioMatch = true;
    }

    if (!scenarioMatch) return false;

    // 2. MATCHING RESOURCE TYPE (Wildcard & Case Insensitive)
    const resType = res.type.toLowerCase();
    const ruleType = rule.resourceType.toLowerCase();
    let typeMatches = false;

    if (ruleType === '*' || ruleType === resType) {
        typeMatches = true;
    } 
    else if (ruleType.endsWith('/*')) {
        const prefix = ruleType.slice(0, -2); // Rimuove '/*'
        // Verifica che il prefisso coincida E che sia seguito da '/' o sia la fine della stringa
        // Esempio: 'microsoft.sql' NON deve matchare 'microsoft.sqlvirtualmachine'
        if (resType.startsWith(prefix)) {
            if (resType.length === prefix.length || resType[prefix.length] === '/') {
                typeMatches = true;
            }
        }
    }

    if (!typeMatches) return false;

    // 3. VERIFICA CONDIZIONI LOGICHE (SKU, Properties, ecc.)
    if (rule.condition) {
        const value = getNestedValue(res, rule.condition.field);
        
        // Se il campo richiesto dalla condizione non esiste sulla risorsa, la regola non si applica
        if (value === undefined || value === null) return false;

        const ruleValue = String(rule.condition.value).toLowerCase();
        const actualValue = String(value).toLowerCase();

        switch (rule.condition.operator) {
            case 'eq':
                return actualValue === ruleValue;
            case 'neq':
                return actualValue !== ruleValue;
            case 'contains':
                return actualValue.includes(ruleValue);
            case 'notEmpty':
                return Array.isArray(value) && value.length > 0;
            default:
                return false;
        }
    }

    // Se siamo arrivati qui, la regola si applica
    return true;
}

function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: Severity | 'Ready' = 'Ready';

    const rules = rulesData as RuleDefinition[];

    rules.forEach(rule => {
        if (evaluateRule(res, rule, scenario)) {
            issues.push({
                ruleId: rule.id,
                severity: rule.severity,
                message: rule.message,
                impact: rule.impact,
                workaround: rule.workaround,
                downtimeRisk: rule.downtimeRisk,
                refLink: rule.refLink
            });
        }
    });

    // Calcolo Severity Finale (Priorità: Blocker > Critical > Warning > Info)
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

        // Query estesa per prendere tutte le properties necessarie alle condizioni
        const query = `
            Resources
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup
            | order by resourceGroup asc
        `;

        console.log(`Analisi avviata. Scenario: ${scenario}. Regole caricate: ${rulesData.length}`);
        
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
        console.error("Errore Backend:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
    console.log(`Knowledge Base Stats: 
        - Tenant Rules: ${tenantRules.length}
        - Move Rules: ${moveRules.length}
        - Region Rules: ${regionRules.length}
    `);
});