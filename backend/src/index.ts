import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
// Importiamo la Knowledge Base
import rulesData from './rules.json'; 

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info';

// Definizione della struttura del file JSON
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

// --- ENGINE DI VALIDAZIONE REGOLE ---

// Helper per leggere proprietà annidate (es. "properties.siteAuthEnabled")
function getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// Verifica se una regola si applica a una risorsa
function evaluateRule(res: any, rule: RuleDefinition, scenario: MigrationScenario): boolean {
    // 1. Check Scenario
    if (rule.scenario !== scenario) return false;

    // 2. Check Resource Type (Supporta wildcard *)
    if (rule.resourceType !== '*' && rule.resourceType.toLowerCase() !== res.type.toLowerCase()) return false;

    // 3. Check Condition (Logica Dinamica)
    if (rule.condition) {
        const value = getNestedValue(res, rule.condition.field);
        
        switch (rule.condition.operator) {
            case 'eq':
                return value === rule.condition.value;
            case 'neq':
                return value !== rule.condition.value;
            case 'contains':
                return typeof value === 'string' && value.includes(rule.condition.value);
            case 'notEmpty':
                return Array.isArray(value) && value.length > 0;
            default:
                return false;
        }
    }

    return true; // Se non c'è condizione, la regola si applica per tipo/scenario
}

function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: Severity | 'Ready' = 'Ready';

    // Iteriamo su tutte le regole caricate dal JSON
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
    console.log(`Server avviato su porta ${PORT} con Knowledge Base JSON caricata.`);
});