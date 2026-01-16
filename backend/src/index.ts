import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// --- IMPORTIAMO TUTTE LE KNOWLEDGE BASE ---
import tenantRules from './rules.json';       // Cross-Tenant
import moveRules from './rules-move.json';    // Cross-Sub / Cross-RG
import regionRules from './rules-region.json'; // Cross-Region (NUOVO)

// Uniamo le regole in un unico array
const rulesData = [...tenantRules, ...moveRules];

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

// --- ENGINE DI VALIDAZIONE ---

function getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function evaluateRule(res: any, rule: RuleDefinition, scenario: MigrationScenario): boolean {
    // 1. Filtro Scenario
    if (rule.scenario !== scenario) return false;

    // Normalizzazione
    const resType = res.type.toLowerCase();
    const ruleType = rule.resourceType.toLowerCase();
    let typeMatches = false;

    // 2. Matching Resource Type (Corretto)
    if (ruleType === '*' || ruleType === resType) {
        typeMatches = true;
    } 
    else if (ruleType.endsWith('/*')) {
        const prefix = ruleType.slice(0, -2);
        // FIX CRITICO: Controlliamo che il prefisso sia seguito da '/' o sia la stringa esatta.
        // Questo evita che 'Microsoft.Sql' matchi 'Microsoft.SqlVirtualMachine'
        if (resType.startsWith(prefix)) {
            if (resType.length === prefix.length || resType[prefix.length] === '/') {
                typeMatches = true;
            }
        }
    }

    // Se il tipo non corrisponde, usciamo subito
    if (!typeMatches) return false;

    // 3. Verifica Condizioni (FIX: Ora viene eseguita!)
    if (rule.condition) {
        const value = getNestedValue(res, rule.condition.field);
        
        // Se il campo non esiste, la condizione non è soddisfatta (o valutiamo false per sicurezza)
        if (value === undefined || value === null) return false;

        switch (rule.condition.operator) {
            case 'eq':
                return String(value).toLowerCase() === String(rule.condition.value).toLowerCase();
            case 'neq':
                return String(value).toLowerCase() !== String(rule.condition.value).toLowerCase();
            case 'contains':
                return String(value).toLowerCase().includes(String(rule.condition.value).toLowerCase());
            case 'notEmpty':
                return Array.isArray(value) && value.length > 0;
            default:
                return false;
        }
    }

    // Se il tipo matcha e non ci sono condizioni (o sono soddisfatte), la regola si applica
    return true;
}

function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: Severity | 'Ready' = 'Ready';

    const rules = rulesData as RuleDefinition[];

    // Applichiamo le regole
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

    // --- LOGICA DI FALLBACK PER LO SPOSTAMENTO ---
    // Se siamo in scenario "cross-subscription" o "cross-resourcegroup" e non abbiamo trovato 
    // nessuna regola specifica (né Blocker né Warning), assumiamo che la risorsa sia "Ready".
    // Tuttavia, se è una risorsa molto esotica non in lista, potremmo voler dare un Info.
    // Per ora, lasciamo "Ready" come default (silenzio assenso).

    // Calcolo Severity Finale
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

        // Aggiungiamo 'sku' e 'properties' alla query per supportare le condizioni complesse
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
        console.error("Errore Backend:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}. Regole caricate: ${rulesData.length}`);
});